import type { ReflectionProgress, ReflectionRun, ReflectionRunEvent, ReflectionRunStore, SystemPort } from "./ports.js";

export const isReflectionRunActive = (run: Pick<ReflectionRun, "status">) => run.status === "running" || run.status === "cancelling";
export interface ReflectionExecution {
  signal: AbortSignal;
  onProgress(event: ReflectionProgress): void;
  /** Once final persistence begins, completion wins over a concurrent stop. */
  commit(): void;
}

const publicError = (error: unknown): string => {
  const code = error instanceof Error ? error.message : "";
  return [
    "ReflectionEvidenceMismatch", "ReflectionAttributionRequired", "ReflectionLensRequired",
    "InvalidReflectionProposal", "InvalidApiSuggestion", "ReflectionAgentNotConfigured",
    "ForgeModelNotConfigured", "ForgeModelNotFound", "ReflectionAgentReturnedNoText",
  ].includes(code) ? code : "ReflectionExecutionFailed";
};

/** Owns one process's execution and Proposal mutation exclusion, not HTTP connections. */
export class ReflectionRuns {
  private readonly locks = new Set<string>();
  private readonly active = new Map<string, { controller: AbortController; committing: boolean; done: Promise<void> }>();
  private readonly accepting = new Map<string, { message: string; promise: Promise<{ run: ReflectionRun; created: boolean }> }>();
  private readonly listeners = new Map<string, Set<(event: ReflectionRunEvent) => void>>();

  constructor(private readonly store: ReflectionRunStore, private readonly system: SystemPort) {}

  current(reflectionId: string) { return this.store.currentReflectionRun(reflectionId); }
  get(reflectionId: string, runId: string) {
    const run = this.store.reflectionRun(runId);
    if (!run || run.reflectionId !== reflectionId) throw new Error("ReflectionRunNotFound");
    return run;
  }
  forRequest(reflectionId: string, requestId: string, message: string) {
    const run = this.store.reflectionRunForRequest(reflectionId, requestId);
    if (run && run.message !== message.trim()) throw new Error("ReflectionRequestConflict");
    return run;
  }
  busy(reflectionId: string) {
    const run = this.current(reflectionId);
    return this.locks.has(reflectionId) || Boolean(run && isReflectionRunActive(run));
  }

  async startPrepared(input: { reflectionId: string; ownerUserId: string; requestId: string; message: string }, prepare: () => Promise<void>, execute: (context: ReflectionExecution) => Promise<string | undefined>) {
    const existing = this.forRequest(input.reflectionId, input.requestId, input.message);
    if (existing) return { run: existing, created: false };
    const key = `${input.reflectionId}:${input.requestId}`;
    const pending = this.accepting.get(key);
    if (pending) {
      if (pending.message !== input.message.trim()) throw new Error("ReflectionRequestConflict");
      return { run: (await pending.promise).run, created: false };
    }
    if (this.busy(input.reflectionId)) throw new Error("ReflectionAlreadyRunning");
    this.locks.add(input.reflectionId);
    const promise = Promise.resolve().then(async () => {
      try {
        await prepare();
        return this.startLocked(input, execute);
      } catch (error) { this.locks.delete(input.reflectionId); throw error; }
      finally { this.accepting.delete(key); }
    });
    this.accepting.set(key, { message: input.message.trim(), promise });
    return promise;
  }

  start(input: { reflectionId: string; ownerUserId: string; requestId: string; message: string }, execute: (context: ReflectionExecution) => Promise<string | undefined>) {
    const existing = this.forRequest(input.reflectionId, input.requestId, input.message);
    if (existing) return { run: existing, created: false };
    if (this.busy(input.reflectionId)) throw new Error("ReflectionAlreadyRunning");
    this.locks.add(input.reflectionId);
    return this.startLocked(input, execute);
  }

  private startLocked(input: { reflectionId: string; ownerUserId: string; requestId: string; message: string }, execute: (context: ReflectionExecution) => Promise<string | undefined>) {
    let run: ReflectionRun;
    try {
      const now = this.system.now();
      run = this.store.createReflectionRun({ ...input, message: input.message.trim(), id: this.system.id("rrn"), status: "running", sequence: 0, text: "", tools: [], createdAt: now, updatedAt: now });
    } catch (error) { this.locks.delete(input.reflectionId); throw error; }
    const control = { controller: new AbortController(), committing: false, done: Promise.resolve() };
    this.active.set(run.id, control);
    // Attach both success and failure handlers before starting; a disconnected client
    // cannot leave an unhandled rejection or release the execution lock.
    control.done = Promise.resolve().then(async () => {
      const agentMessageId = await execute({
        signal: control.controller.signal,
        onProgress: (progress) => {
          const current = this.get(input.reflectionId, run.id);
          if (!isReflectionRunActive(current) || control.controller.signal.aborted) return;
          if (progress.type === "text.delta") current.text = (current.text + progress.text).slice(0, 100_000);
          if (progress.type === "text.replace") current.text = progress.text.slice(0, 100_000);
          if (progress.type === "tool.status") {
            const index = current.tools.findIndex((tool) => tool.id === progress.tool.id);
            if (index >= 0) current.tools[index] = progress.tool;
            else if (current.tools.length < 256) current.tools.push(progress.tool);
          }
          if (progress.type === "proposal.updated") current.proposalId = progress.proposalId;
          this.publish(current, progress.type);
        },
        commit: () => { control.controller.signal.throwIfAborted(); control.committing = true; },
      });
      const current = this.get(input.reflectionId, run.id);
      current.status = control.controller.signal.aborted && !control.committing ? "cancelled" : "completed";
      current.agentMessageId = agentMessageId;
      this.publish(current, current.status);
    }).catch((error: unknown) => {
      const current = this.get(input.reflectionId, run.id);
      current.status = control.controller.signal.aborted && !control.committing ? "cancelled" : "failed";
      if (current.status === "failed") current.error = publicError(error);
      this.publish(current, current.status);
    }).finally(() => {
      this.active.delete(run.id);
      this.locks.delete(input.reflectionId);
    });
    // wait() may observe a storage failure; background callers still must not
    // create an unhandled rejection when no HTTP connection remains.
    void control.done.catch(() => {});
    return { run, created: true };
  }

  async wait(reflectionId: string, runId: string) {
    await this.active.get(runId)?.done;
    return this.get(reflectionId, runId);
  }

  cancel(reflectionId: string, runId: string) {
    const run = this.get(reflectionId, runId);
    const control = this.active.get(runId);
    if (run.status !== "running" || !control || control.committing) return run;
    run.status = "cancelling";
    this.publish(run, "run.status");
    control.controller.abort(new Error("ReflectionCancelled"));
    return this.get(reflectionId, runId);
  }

  /** Subscribe and snapshot synchronously so no progress falls between them. */
  subscribe(reflectionId: string, runId: string, listener: (event: ReflectionRunEvent) => void) {
    const run = this.get(reflectionId, runId);
    const listeners = this.listeners.get(runId) ?? new Set();
    listeners.add(listener);
    this.listeners.set(runId, listeners);
    try { listener({ version: 1, runId, sequence: run.sequence, type: "snapshot", run }); }
    catch (error) { listeners.delete(listener); if (!listeners.size) this.listeners.delete(runId); throw error; }
    return () => { listeners.delete(listener); if (!listeners.size) this.listeners.delete(runId); };
  }

  async mutateProposal<T>(reflectionId: string | undefined, mutation: () => Promise<T>) {
    if (!reflectionId) return mutation();
    if (this.busy(reflectionId)) throw new Error("ReflectionAlreadyRunning");
    this.locks.add(reflectionId);
    try { return await mutation(); }
    finally { this.locks.delete(reflectionId); }
  }

  async close() {
    for (const [id] of this.active) {
      const run = this.store.reflectionRun(id)!;
      this.cancel(run.reflectionId, id);
    }
    await Promise.all([...this.active.values()].map((control) => control.done));
  }

  private publish(run: ReflectionRun, type: ReflectionRunEvent["type"]) {
    run.sequence++;
    run.updatedAt = this.system.now();
    this.store.saveReflectionRun(run);
    const event: ReflectionRunEvent = { version: 1, runId: run.id, sequence: run.sequence, type, run };
    for (const listener of this.listeners.get(run.id) ?? []) {
      try { listener(event); } catch { /* An observer must never terminate execution. */ }
    }
  }
}
