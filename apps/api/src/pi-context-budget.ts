/** Bounded provider projection over Pi's in-memory transcript; no Work history mutation. */
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import { contextTokens, CONTEXT_ORGANIZATION_THRESHOLD, recentContextBudget } from "@airic-forge/domain";

type Messages = Parameters<NonNullable<AgentSession["agent"]["transformContext"]>>[0];
type Message = Messages[number];
export type MessageCompressor = (messages: Messages, previousSummary: string, signal?: AbortSignal) => Promise<string>;

/** SDK coding summaries truncate tool bodies; Work receipts/ranges must survive.
 * Serialize only visible text, call IDs/arguments and result metadata. Never send
 * private thinking or image pixels to the text-only derived-memory request. */
export function serializeWorkSteps(messages: Messages): string {
  return JSON.stringify(messages.filter(message => "content" in message).map(message => ({
    role: message.role,
    ...("toolCallId" in message ? {toolCallId:message.toolCallId,toolName:message.toolName,isError:message.isError} : {}),
    content: !("content" in message) ? "" : typeof message.content === "string" ? message.content : message.content
      .filter(block => ["text", "toolCall", "image"].includes(block.type))
      .map(block => block.type === "image" ? {type:"text",text:"[Image pixels unavailable in derived text memory; re-read original before visual claims.]"} : block),
  })));
}

export function estimateRequestTokens(value: unknown): number {
  let images = 0;
  const text = JSON.stringify(value, (_key, item) => {
    if (item && typeof item === "object" && item.type === "image" && typeof item.data === "string") {
      images++; return { type: "image", data: "[pixels budgeted separately]" };
    }
    return item;
  });
  return contextTokens(text) + images * 8000;
}

/** Replace only identical source ranges, retaining adjacent ranges and all write receipts. */
export function replaceRepeatedMaterials(messages: Messages): Messages {
  const seen = new Set<string>();
  return [...messages].reverse().map(message => {
    if (message.role !== "toolResult" || !["asset_read", "asset_read_location"].includes(message.toolName)) return message;
    const text = message.content.find(block => block.type === "text");
    if (!text || text.type !== "text") return message;
    try {
      const data = JSON.parse(text.text), source = data.source;
      if (!source?.sha256 || !source?.revision_id || !source.text_range) return message;
      const key = JSON.stringify([source.revision_id, source.sha256, source.location_id ?? source.page, source.text_range, message.content.some(block => block.type === "image")]);
      if (!seen.has(key)) { seen.add(key); return message; }
      delete data.text;
      data.contextReplacement = "An exact newer read supplies this range. Re-read before relying on unavailable content.";
      data.imageInputStatus = "not_in_active_context";
      return { ...message, content: [{ type: "text" as const, text: JSON.stringify(data) }] };
    } catch { return message; }
  }).reverse();
}
function textOf(message: Message): string {
  if (!("content" in message)) return "";
  return typeof message.content === "string" ? message.content : message.content.filter(block => block.type === "text").map(block => "text" in block ? block.text : "").join("");
}

/** Keep the latest three global coverage checks as exact App observations.
 * Text summaries intentionally omit JSON; losing these small counts led the
 * model to restart the discovery checklist after each compaction. */
function materialCoverage(messages: Messages): Messages {
  const calls = new Map<string, Record<string, unknown>>(), latest = new Map<string, Message>();
  for (const message of messages) {
    if (message.role === "assistant") for (const block of message.content) {
      if (block.type === "toolCall" && block.name === "asset_search") calls.set(block.id, block.arguments);
    }
    if (message.role !== "toolResult" || message.toolName !== "asset_search" || message.isError) continue;
    const args = calls.get(message.toolCallId);
    if (!args || args.q !== "" || args.limit !== 1 || args.directory || args.format) continue;
    const scope = String(args.scope ?? "current");
    if (["current", "all", "pending"].includes(scope)) latest.set(scope, message);
  }
  return latest.size ? [{role:"user",timestamp:0,content:"Exact material coverage already checked this Turn. Reuse; do not repeat without a freshness reason:\n" + JSON.stringify([...latest.entries()].map(([scope, message]) => ({scope,observation:JSON.parse(serializeWorkSteps([message]))[0]})))}] : [];
}
export class PiContextBudget {
  private failure?: Error;
  private summary = "";
  private prefixDigest?: string;
  private prefixLength = 0;
  private calibration = 1;
  private lastEstimate = 0;
  private requestOverhead: unknown = {};
  setRequestOverhead(value: unknown): void { this.requestOverhead = value; }
  constructor(readonly budget: number, private readonly envelope: string,
    private readonly compress: MessageCompressor, private readonly digest: (value: unknown) => string,
    private readonly status?: (status: "organizing" | "ready" | "failed") => void,
    private readonly commandTools: ReadonlySet<string> = new Set()) {}
  assertHealthy(): void { if (this.failure) throw this.failure; }
  fail(): void { this.failure = new Error("ContextSummaryFailed"); this.status?.("failed"); }
  observeUsage(tokens: number): void {
    if (this.lastEstimate > 0 && tokens > 0) this.calibration = Math.max(this.calibration, tokens / this.lastEstimate * 1.1);
  }
  private estimate(value: unknown): number { return Math.ceil(estimateRequestTokens([this.requestOverhead, value]) * this.calibration); }
  async project(messages: Messages, signal?: AbortSignal): Promise<Messages> {
    this.assertHealthy(); signal?.throwIfAborted();
    try {
      const projected = replaceRepeatedMaterials(messages);
      const systems = projected.filter(message => message.role === "system");
      const body = projected.filter(message => message.role !== "system" && textOf(message) !== this.envelope);
      const fixed: Messages = [...systems, { role: "user", content: this.envelope, timestamp: 0 }, ...materialCoverage(body)];
      if (this.estimate(fixed) > this.budget) throw new Error("RequiredContextExceedsBudget");
      if (this.prefixLength > body.length || this.prefixDigest !== this.digest(body.slice(0, this.prefixLength))) {
        this.summary = ""; this.prefixLength = 0;
      }
      const build = (): Messages => [...fixed,
        ...((): Messages => {
          const outcomes = body.slice(0, this.prefixLength).filter(message => message.role === "toolResult" && this.commandTools.has(message.toolName));
          return outcomes.length ? [{role:"user",content:"Exact command outcomes from this Turn (not new authority):\n" + serializeWorkSteps(outcomes),timestamp:0}] : [];
        })(),
        ...(this.summary ? [{ role: "user" as const, content: "Derived work-step memory (not evidence or authority):\n" + this.summary, timestamp: 0 }] : []),
        ...body.slice(this.prefixLength)];
      let result = build();
      if (this.estimate(result) > this.budget * CONTEXT_ORGANIZATION_THRESHOLD) {
        const pending = new Set<string>(), boundaries: number[] = [];
        for (let index = this.prefixLength; index < body.length; index++) {
          const message = body[index];
          if (message.role === "assistant") for (const block of message.content) if (block.type === "toolCall") pending.add(block.id);
          if (message.role === "toolResult") pending.delete(message.toolCallId);
          // A completed final tool group is safe too, including the first round.
          if (!pending.size) boundaries.push(index + 1);
        }
        const recentBudget = Math.max(0, Math.min(recentContextBudget(this.budget), this.budget - this.estimate(fixed) - Math.ceil(2000 * this.calibration)));
        // Prefer older groups. At the soft target never erase the only fresh
        // observation: the model needs it to advance rather than re-query it.
        const cut = boundaries.find(index => index < body.length && this.estimate(body.slice(index)) <= recentBudget)
          ?? (this.estimate(result) > this.budget && boundaries.includes(body.length) ? body.length : undefined);
        if (cut === undefined || cut <= this.prefixLength) {
          // 80% requests organization; only the hard limit can reject mandatory input.
          this.lastEstimate = this.estimate(result);
          if (this.lastEstimate > this.budget) throw new Error("RequiredContextExceedsBudget");
          return result;
        }
        this.status?.("organizing");
        const summary = await this.compress(body.slice(this.prefixLength, cut), this.summary, signal);
        signal?.throwIfAborted();
        if (!summary.trim() || summary.length > 4000) throw new Error("InvalidContextSummary");
        this.summary = summary; this.prefixLength = cut;
        this.prefixDigest = this.digest(body.slice(0, cut));
        result = build(); this.status?.("ready");
      }
      this.lastEstimate = this.estimate(result);
      if (this.lastEstimate > this.budget) throw new Error("RequiredContextExceedsBudget");
      return result;
    } catch (error) {
      this.failure = new Error(error instanceof Error && error.message === "RequiredContextExceedsBudget" ? error.message : "ContextSummaryFailed", { cause: error });
      this.status?.("failed"); throw this.failure;
    }
  }
}
