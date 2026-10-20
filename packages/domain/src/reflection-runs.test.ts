import assert from "node:assert/strict";
import test from "node:test";
import type { ReflectionRun, ReflectionRunStore, SystemPort } from "./ports.js";
import { ReflectionRuns } from "./reflection-runs.js";

function fixture() {
  const records = new Map<string, ReflectionRun>();
  let counter = 0;
  const system: SystemPort = { id: (prefix) => `${prefix}-${++counter}`, now: () => "now", digest: () => "" };
  const store: ReflectionRunStore = {
    reflectionRun: (id) => structuredClone(records.get(id)),
    reflectionRunForRequest: (id, request) => structuredClone([...records.values()].find((run) => run.reflectionId === id && run.requestId === request)),
    currentReflectionRun: (id) => structuredClone([...records.values()].filter((run) => run.reflectionId === id).at(-1)),
    createReflectionRun: (input) => {
      const run: ReflectionRun = { ...input, userMessage: { id: `message-${++counter}`, reflectionId: input.reflectionId, role: "user", content: input.message, at: "now" } };
      records.set(run.id, structuredClone(run));
      return run;
    },
    saveReflectionRun: (run) => { records.set(run.id, structuredClone(run)); },
    interruptReflectionRuns: () => {},
  };
  return { runs: new ReflectionRuns(store, system), records };
}
const input = { reflectionId: "reflection", ownerUserId: "owner", requestId: "request-1", message: "Discuss" };
function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release };
}

test("runs survive losing subscribers, deduplicate acceptance and resume with a snapshot", async () => {
  const { runs, records } = fixture();
  const barrier = gate();
  let calls = 0;
  const { run } = runs.start(input, async (context) => {
    calls++;
    context.onProgress({ type: "text.delta", text: "中文" });
    await barrier.promise;
    context.commit();
    context.onProgress({ type: "text.replace", text: "中文回答" });
    return "agent-message";
  });
  const events: string[] = [];
  const off = runs.subscribe(input.reflectionId, run.id, (event) => events.push(event.type));
  await Promise.resolve();
  off();
  assert.equal(runs.current(input.reflectionId)?.text, "中文");
  assert.equal(runs.start(input, async () => { throw new Error("Must not rerun"); }).created, false);
  assert.throws(() => runs.start({ ...input, message: "Changed" }, async () => undefined), /ReflectionRequestConflict/);
  assert.throws(() => runs.start({ ...input, requestId: "request-2" }, async () => undefined), /ReflectionAlreadyRunning/);
  assert.equal(records.size, 1);
  let snapshot = "";
  const offAgain = runs.subscribe(input.reflectionId, run.id, (event) => { snapshot = event.run.text; });
  assert.equal(snapshot, "中文");
  barrier.release();
  assert.equal((await runs.wait(input.reflectionId, run.id)).status, "completed");
  assert.equal(snapshot, "中文回答");
  assert.deepEqual(events, ["snapshot", "text.delta"]);
  assert.equal(calls, 1);
  offAgain();
});

test("cancellation waits for an in-flight operation, preserves partial text and releases the lock", async () => {
  const { runs } = fixture();
  const barrier = gate();
  const { run } = runs.start(input, async (context) => {
    context.onProgress({ type: "text.delta", text: "Partial" });
    await barrier.promise;
    context.commit();
    return undefined;
  });
  await Promise.resolve();
  assert.equal(runs.cancel(input.reflectionId, run.id).status, "cancelling");
  assert.equal(runs.cancel(input.reflectionId, run.id).status, "cancelling");
  await assert.rejects(() => runs.mutateDraft(input.reflectionId, async () => undefined), /ReflectionAlreadyRunning/);
  barrier.release();
  const settled = await runs.wait(input.reflectionId, run.id);
  assert.equal(settled.status, "cancelled");
  assert.equal(settled.text, "Partial");
  assert.equal(settled.agentMessageId, undefined);
  await runs.mutateDraft(input.reflectionId, async () => undefined);
});

test("Proposal mutation excludes starting a run, completion wins after the commit boundary", async () => {
  const { runs } = fixture();
  const barrier = gate();
  const mutation = runs.mutateDraft(input.reflectionId, async () => barrier.promise);
  assert.throws(() => runs.start(input, async () => undefined), /ReflectionAlreadyRunning/);
  barrier.release();
  await mutation;
  const committed = gate();
  const { run } = runs.start(input, async (context) => {
    context.commit();
    await committed.promise;
    return "final";
  });
  await Promise.resolve();
  assert.equal(runs.cancel(input.reflectionId, run.id).status, "running");
  committed.release();
  assert.equal((await runs.wait(input.reflectionId, run.id)).status, "completed");
  assert.equal(runs.cancel(input.reflectionId, run.id).status, "completed");
});

test("execution errors are safe, and subscriber errors cannot kill execution", async () => {
  const { runs } = fixture();
  const { run } = runs.start(input, async (context) => {
    context.onProgress({ type: "text.delta", text: "Partial" });
    throw new Error("Provider credential or private document");
  });
  let first = true;
  runs.subscribe(input.reflectionId, run.id, () => {
    if (!first) throw new Error("Disconnected observer");
    first = false;
  });
  const result = await runs.wait(input.reflectionId, run.id);
  assert.equal(result.status, "failed");
  assert.equal(result.error, "ReflectionExecutionFailed");
  assert.equal(runs.busy(input.reflectionId), false);
});

test("acceptance holds the mutation lock, deduplicates concurrent requests, and saves nothing on failed validation", async () => {
  const { runs, records } = fixture();
  const barrier = gate();
  const first = runs.startPrepared(input, async () => barrier.promise, async () => "agent");
  const second = runs.startPrepared(input, async () => { throw new Error("Must not validate twice"); }, async () => "agent");
  await assert.rejects(() => runs.mutateDraft(input.reflectionId, async () => undefined), /ReflectionAlreadyRunning/);
  assert.equal(records.size, 0);
  barrier.release();
  const accepted = await first;
  assert.equal((await second).run.id, accepted.run.id);
  assert.equal((await second).created, false);
  await runs.wait(input.reflectionId, accepted.run.id);
  await assert.rejects(() => runs.startPrepared({ ...input, requestId: "failed-validation" }, async () => { throw new Error("ReflectionClosed"); }, async () => undefined), /ReflectionClosed/);
  assert.equal(records.size, 1);
  assert.equal(runs.busy(input.reflectionId), false);
});
