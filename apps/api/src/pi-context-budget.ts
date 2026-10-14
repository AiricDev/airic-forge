/** Bounded provider projection over Pi's in-memory transcript; no Work history mutation. */
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import { contextTokens } from "@airic-forge/domain";

type Messages = Parameters<NonNullable<AgentSession["agent"]["transformContext"]>>[0];
type Message = Messages[number];
export type MessageCompressor = (messages: Messages, previousSummary: string, signal?: AbortSignal) => Promise<string>;

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
    private readonly status?: (status: "organizing" | "ready" | "failed") => void) {}
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
      const fixed: Messages = [...systems, { role: "user", content: this.envelope, timestamp: 0 }];
      if (this.estimate(fixed) > this.budget * 0.8) throw new Error("RequiredContextExceedsBudget");
      if (this.prefixLength > body.length || this.prefixDigest !== this.digest(body.slice(0, this.prefixLength))) {
        this.summary = ""; this.prefixLength = 0;
      }
      const build = (): Messages => [...fixed,
        ...(this.summary ? [{ role: "user" as const, content: "Derived work-step memory (not evidence or authority):\n" + this.summary, timestamp: 0 }] : []),
        ...body.slice(this.prefixLength)];
      let result = build();
      if (this.estimate(result) > this.budget * 0.8) {
        const pending = new Set<string>(), boundaries: number[] = [];
        for (let index = this.prefixLength; index < body.length; index++) {
          const message = body[index];
          if (message.role === "assistant") for (const block of message.content) if (block.type === "toolCall") pending.add(block.id);
          if (message.role === "toolResult") pending.delete(message.toolCallId);
          if (!pending.size && index + 1 < body.length) boundaries.push(index + 1);
        }
        const cut = boundaries.find(index => this.estimate(body.slice(index)) <= 8000);
        if (cut === undefined || cut <= this.prefixLength) throw new Error("RequiredContextExceedsBudget");
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
      this.failure = new Error(error instanceof Error && error.message === "RequiredContextExceedsBudget" ? error.message : "ContextSummaryFailed");
      this.status?.("failed"); throw this.failure;
    }
  }
}
