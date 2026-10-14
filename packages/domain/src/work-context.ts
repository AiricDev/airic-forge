/** Work-owned memory and budgets. No model SDK, database or filesystem types. */
import type { TrajectoryEvent } from "./ports.js";

export const CONTEXT_POLICY_VERSION = "work-context-v1";
export const DEFAULT_INPUT_TOKENS = 32_000;
export const DEFAULT_OUTPUT_TOKENS = 8_000;
export const MAX_SUMMARY_CHARACTERS = 4_000;
export interface ContextMessage { eventId: string; turnId?: string; role: "user" | "agent"; text: string; textRange?: { offset: number; end: number; total: number } }
export interface SummaryScope { organizationId: string; ownerId: string; workId: string; omRevision: string; catalogDigest: string; policyVersion: string; modelFingerprint: string }
export interface ContextSummary { scope: SummaryScope; coveredCount: number; sourceDigest: string; firstEventId: string; lastEventId: string; text: string }
export interface ContextSummaryPort {
  readonly modelFingerprint: string;
  summarize(input: { messages: ContextMessage[]; previousSummary: string; signal?: AbortSignal }): Promise<string>;
}
export interface ContextSummaryStore {
  read(key: string): Promise<ContextSummary | undefined>;
  write(key: string, summary: ContextSummary): Promise<void>;
}
export interface WorkContextPorts {
  summarizer: ContextSummaryPort;
  summaries: ContextSummaryStore;
  inputTokens?: number;
  outputTokens?: number;
}

/** Conservative cold-start text estimate; actual model usage remains the adapter's authority. */
export function contextTokens(value: unknown): number {
  return Math.ceil(new TextEncoder().encode(typeof value === "string" ? value : JSON.stringify(value)).length / 2);
}
export function inputBudget(window: number, configured = DEFAULT_INPUT_TOKENS, output = DEFAULT_OUTPUT_TOKENS): number {
  const budget = Math.min(configured, Math.floor(window * 0.9) - output);
  if (!Number.isSafeInteger(budget) || budget < 1_024) throw new Error("ContextWindowTooSmall");
  return budget;
}
export function conversationMessages(events: TrajectoryEvent[], excludedTurnId?: string): ContextMessage[] {
  return events.filter(e => e.turnId !== excludedTurnId && ["turn.started", "turn.completed"].includes(e.type)).flatMap(e => {
    const points = Array.from(String(e.type === "turn.started" ? e.payload.userMessage ?? "" : e.payload.text ?? ""));
    const chunks: ContextMessage[] = [];
    for (let offset = 0; offset < Math.max(1, points.length); offset += 3000) chunks.push({
      eventId: e.id, turnId: e.turnId, role: e.type === "turn.started" ? "user" : "agent",
      text: points.slice(offset, offset + 3000).join(""),
      ...(points.length > 3000 ? { textRange: { offset, end: Math.min(points.length, offset + 3000), total: points.length } } : {}),
    });
    return chunks;
  });
}

/** These facts never depend on a probabilistic summary or replace current App state. */
export function pinnedWorkFacts(events: TrajectoryEvent[]) {
  const corrections = events.filter(e => e.type === "work.feedback" && ["correct", "redo", "method", "knowledge"].includes(String(e.payload.kind)))
    .map(e => ({ eventId: e.id, checkpointId: e.payload.checkpointId, kind: e.payload.kind, note: e.payload.note }));
  const actions = new Map<string, TrajectoryEvent>();
  for (const e of events) if (e.type === "action" && typeof e.payload.commandId === "string") actions.set(e.payload.commandId, e);
  const unresolved = [...actions.values()].filter(e => ["pending", "unknown"].includes(String(e.payload.status))).map(e => ({ eventId: e.id, commandId: e.payload.commandId, capabilityId: e.payload.capabilityId, status: e.payload.status, locator: e.payload.locator }));
  const receipts = [...actions.values()].filter(e => e.payload.status === "committed").slice(-20).map(e => ({ eventId: e.id, commandId: e.payload.commandId, capabilityId: e.payload.capabilityId, locator: e.payload.locator, status: "committed" }));
  const sources = events.filter(e => e.type === "observation" && ["asset.read", "asset.read-location"].includes(String(e.payload.capabilityId))).slice(-20).map(e => ({ eventId: e.id, source: (e.payload.result as Record<string, unknown> | undefined)?.source }));
  return { corrections, unresolved, receipts, sources, olderEventsAvailable: true };
}

export async function assembleWorkMemory(input: {
  scope: Omit<SummaryScope, "policyVersion" | "modelFingerprint">;
  events: TrajectoryEvent[]; excludedTurnId?: string; mandatory: unknown;
  ports?: WorkContextPorts; digest(value: unknown): string; signal?: AbortSignal;
}) {
  const budget = input.ports?.inputTokens ?? DEFAULT_INPUT_TOKENS;
  if (contextTokens(input.mandatory) > budget * 0.8) throw new Error("RequiredContextExceedsBudget");
  const all = conversationMessages(input.events, input.excludedTurnId);
  const recentTurns = new Set(all.map(m => m.turnId ?? m.eventId).filter((v, i, a) => a.indexOf(v) === i).slice(-4));
  let cut = all.findIndex(m => recentTurns.has(m.turnId ?? m.eventId));
  if (cut < 0) cut = 0;
  // A single huge assistant reply may itself need summarization. Never truncate messages.
  while (cut < all.length && contextTokens(all.slice(cut)) > 8_000) {
    const turn = all[cut].turnId ?? all[cut].eventId;
    while (cut < all.length && (all[cut].turnId ?? all[cut].eventId) === turn) cut++;
  }
  const pressure = contextTokens([input.mandatory, all]) > budget * 0.8 || contextTokens(all) > 8_000;
  if (!pressure) return { conversation: all, memory: undefined, estimatedTokens: contextTokens([input.mandatory, all]) };
  if (!cut || !input.ports) throw new Error("ContextSummaryRequired");
  const scope: SummaryScope = { ...input.scope, policyVersion: CONTEXT_POLICY_VERSION, modelFingerprint: input.ports.summarizer.modelFingerprint };
  const key = input.digest(scope);
  const older = all.slice(0, cut);
  const cached = await input.ports.summaries.read(key);
  let covered = 0, summary = "";
  if (cached && input.digest(cached.scope) === input.digest(scope)
    && Number.isSafeInteger(cached.coveredCount) && cached.coveredCount > 0 && cached.coveredCount <= cut
    && cached.sourceDigest === input.digest(older.slice(0, cached.coveredCount))
    && cached.firstEventId === older[0].eventId && cached.lastEventId === older[cached.coveredCount - 1].eventId
    && typeof cached.text === "string" && cached.text.trim() && cached.text.length <= MAX_SUMMARY_CHARACTERS) {
    covered = cached.coveredCount; summary = cached.text;
  }
  while (covered < cut) {
    input.signal?.throwIfAborted();
    const batch: ContextMessage[] = [];
    let size = contextTokens(summary);
    while (covered + batch.length < cut) {
      const message = older[covered + batch.length];
      const cost = contextTokens(message);
      if (size + cost > 12_000) break;
      batch.push(message); size += cost;
    }
    if (!batch.length) throw new Error("HistoryMessageExceedsSummaryBudget");
    const next = await input.ports.summarizer.summarize({ messages: batch, previousSummary: summary, signal: input.signal });
    if (typeof next !== "string" || !next.trim() || next.length > MAX_SUMMARY_CHARACTERS) throw new Error("InvalidContextSummary");
    summary = next; covered += batch.length;
  }
  input.signal?.throwIfAborted();
  const record: ContextSummary = { scope, coveredCount: covered, sourceDigest: input.digest(older), firstEventId: older[0].eventId, lastEventId: older[older.length - 1].eventId, text: summary };
  const memory = { summary, sourceDigest: record.sourceDigest, firstEventId: record.firstEventId, lastEventId: record.lastEventId, coveredMessages: covered, limitations: "Derived discussion summary, never authorization, original evidence or current Business State." };
  const conversation = all.slice(cut);
  const estimatedTokens = contextTokens([input.mandatory, memory, conversation]);
  if (estimatedTokens > budget * 0.8) throw new Error("RequiredContextExceedsBudget");
  // Publish only a complete, validated summary. Failures leave the previous cache intact.
  await input.ports.summaries.write(key, record);
  return { conversation, memory, estimatedTokens };
}
