import type { DocumentProvenance } from "./model.js";

export type WorkStatus = "active" | "completed";
export type TurnStatus = "running" | "completed" | "failed";
export type ActionStatus = "pending" | "succeeded" | "rejected" | "unknown";

export interface WorkKey {
  ownerUserId: string;
  appId: "certreporter";
  workType: "report-authoring";
  entityId: string;
}

export interface Work extends WorkKey {
  id: string;
  status: WorkStatus;
  createdAt: string;
  updatedAt: string;
}

export interface Turn {
  id: string;
  workId: string;
  sequence: number;
  status: TurnStatus;
  omRevision: string;
  catalogDigest: string;
  contextDigest: string;
  documents: DocumentProvenance[];
  startedAt: string;
  completedAt?: string;
}

export interface ActionReceipt {
  commandId: string;
  status: "succeeded" | "rejected";
  message: string;
  resultVersion?: string;
}

export interface Action {
  id: string;
  workId: string;
  turnId: string;
  capabilityId: string;
  commandId: string;
  status: ActionStatus;
  receipt?: ActionReceipt;
}
