/** Exact Work handoff, independent of Pi's native conversation storage. */
import type { TrajectoryEvent } from "./ports.js";
export interface ContextMessage { eventId:string;turnId?:string;role:"user"|"agent";text:string;textRange?:{offset:number;end:number;total:number}; }
export const CONTEXT_POLICY_VERSION = "pi-native-v1";
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
