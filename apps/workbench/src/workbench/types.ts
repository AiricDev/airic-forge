export type LiveWorkDefinition = {
  schemaVersion: number;
  id: string;
  title: string;
  description: string;
  documents: Array<{
    id: string;
    path: string;
    title: string;
    role: string;
    load: string;
  }>;
  knowledge: {
    bootstrap: string[];
    available: string[];
  };
  completion: {
    mode?: string;
  };
};
export type User = {
  id: string;
  email: string;
  role: "user" | "admin";
  status: "active" | "draining" | "disabled";
  version: number;
  passwordConfigured: boolean;
  activeBranch: string;
};
export type TestIdentitySwitch = { originalUserId: string; users: User[] };
export type AuthResult = {
  user: User;
  testIdentitySwitch?: TestIdentitySwitch;
};
export type InstanceSettings = {
  operatingModel: {
    repositoryPath: string;
    dataPath: string;
    personalWorktreesPath: string;
  };
  integration: {
    appId: string;
    organizationId: string;
    baseUrl: string;
    mcpUrl: string;
    transport: "streamable-http";
  };
};
export type OmSnapshot = {
  owner?: { id: string; email: string };
  branch: string;
  activeRevision: string;
  revision: string;
  files: string[];
  syncAvailable?: boolean;
};
export type OmCommit = { revision: string; subject: string; at: string };
export type OmFile = { path: string; revision: string; content: string };
export type OmManifest = {
  path: string;
  revision: string;
  definition: LiveWorkDefinition;
};
export type OmDraft = {
  ownerUserId: string;
  path: string;
  baseRevision: string;
  content: string;
  updatedAt: string;
};
export type Work = {
  id: string;
  ownerUserId: string;
  workType: string;
  entityId: string;
  entityTitle?: string;
  status: string;
  updatedAt: string;
};
export type WorkPage = {
  works: Work[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};
export type Turn = {
  id: string;
  sequence: number;
  status: string;
  omRevision: string;
  catalogDigest: string;
  contextDigest: string;
  startedAt: string;
};
export type TrajectoryEvent = {
  id: string;
  turnId?: string;
  type: string;
  at: string;
  payload: Record<string, unknown>;
};
export type WorkHistory = {
  work: Work;
  turns: Turn[];
  events: TrajectoryEvent[];
};
export type WorkFeedbackKind =
  | "required-human-decision"
  | "avoidable-correction"
  | "knowledge-helpful"
  | "work-outcome-correct"
  | "work-outcome-incorrect";
export type WorkFeedback = {
  id: string;
  kind: WorkFeedbackKind;
  note: string;
  at: string;
};
export type Baseline = {
  activity: Record<string, number | null>;
  feedback: Record<WorkFeedbackKind, number>;
  interpretation: string;
};
export type Contribution = {
  id: string;
  authorUserId: string;
  authorEmail?: string;
  sourceRevision: string;
  baseMainRevision: string;
  reason: string;
  evidence: string;
  status: "open" | "accepted";
  selectedPaths: string[];
  reviewedRevision?: string;
  selectionRevision?: string;
  acceptedRevision?: string;
};
export type Comparison = {
  author: { id: string; email: string };
  sourceRevision: string;
  mainRevision: string;
  baseRevision: string;
  changedPaths: string[];
  diff: string;
};
export type ContributionDetail = {
  record: Contribution;
  authorEmail: string;
  baseRevision: string;
  changedPaths: string[];
  diff: string;
  candidateDiff?: string;
};
export type ReflectionLens = {
  id: "domain-knowledge" | "delegation-gap" | "api-suggestion";
  version: number;
  enabled: boolean;
  prompt: string;
};
export type Reflection = {
  id: string;
  workId?: string;
  lensId: string;
  lensVersion: number;
  question: string;
  evidenceEventIds: string[];
  omRevision: string;
  status: string;
  outcome?: string;
  analysis?: string;
  attribution?: string;
  suggestionMarkdown?: string;
};
export type ReflectionMessage = {
  id: string;
  role: "user" | "agent";
  content: string;
  at: string;
  lensId?: string;
  lensVersion?: number;
  citedEventIds?: string[];
};
export type ReflectionDetail = {
  reflection: Reflection;
  messages: ReflectionMessage[];
  draft?: import("./OmDraftReview").OmWorkspace;
};

export type ReflectionRun = {
  id: string;
  reflectionId: string;
  requestId: string;
  message: string;
  userMessage: ReflectionMessage;
  status:
    | "running"
    | "cancelling"
    | "completed"
    | "failed"
    | "cancelled"
    | "interrupted";
  sequence: number;
  text: string;
  tools: Array<{
    id: string;
    name: string;
    status: "running" | "completed" | "failed";
  }>;
  agentMessageId?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
};
