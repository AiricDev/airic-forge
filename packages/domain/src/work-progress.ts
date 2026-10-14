import type { TrajectoryEvent } from "./ports.js";

export interface WorkCheckpoint {
  summary: string;
  eventIds: string[];
  selfCheck: string;
  uncertainties: string[];
  nextStep: string;
  remainingWork: string[];
  waitFor: "feedback" | "external" | "human";
  resumeCondition: string;
}
export interface CheckpointFeedback {
  checkpointId: string;
  kind: "approve" | "correct" | "redo" | "knowledge" | "method" | "resume";
  note: string;
  checkAt?: "step" | "phase";
}

/** Waiting is a projection of immutable Work events, not a second business status. */
export function workProgress(events: TrajectoryEvent[]) {
  const checkpoint = events.findLast((event) => event.type === "work.checkpoint");
  const feedback = checkpoint ? events.filter((event) =>
    event.type === "work.feedback" && event.payload.checkpointId === checkpoint.id) : [];
  const arrangement = events.findLast((event) => event.type === "work.feedback"
    && ["step", "phase"].includes(String(event.payload.checkAt)));
  return { checkpoint, feedback, waiting: !!checkpoint && !feedback.length,
    checkAt: arrangement?.payload.checkAt ?? "step" };
}

export function validateCheckpoint(input: WorkCheckpoint, events: TrajectoryEvent[]): void {
  const text = (value: unknown) => typeof value === "string" && !!value.trim() && value.length <= 4000;
  const list = (value: unknown) => Array.isArray(value) && value.length <= 50 && value.every(text);
  if (!input || ![input.summary, input.selfCheck, input.nextStep, input.resumeCondition].every(text)
    || !list(input.uncertainties) || !list(input.remainingWork) || !list(input.eventIds)
    || Object.keys(input).some((key) => !["summary", "eventIds", "selfCheck", "uncertainties", "nextStep", "remainingWork", "waitFor", "resumeCondition"].includes(key))
    || !["feedback", "external", "human"].includes(input.waitFor)) throw new Error("InvalidWorkCheckpoint");
  const facts = new Set(events.filter((event) => ["observation", "context.document-loaded", "context.assembled"].includes(event.type)
    || (event.type === "action" && ["committed", "rejected", "unknown"].includes(String(event.payload.status))))
    .map((event) => event.id));
  if (input.eventIds.some((id) => !facts.has(id))) throw new Error("CheckpointEvidenceNotFound");
}
