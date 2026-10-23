import type { UserAdministrationPort } from "./user-administration.js";
import type { AppIdentity, AppToolSnapshot, AppToolDefinition, ForgeUser } from "./model.js";
import type { ValidationIssue, WorkDefinition } from "./operating-model.js";
import type { Work } from "./work.js";
import type { WorkCheckpoint } from "./work-progress.js";

/** A port is written in the language of a Forge use case, never an SDK or SQL API. */
export type MaybePromise<T> = T | Promise<T>;

/** Explicitly public-to-administrators configuration, never the full runtime config. */
export interface InstanceSettings {
  operatingModel: { repositoryPath: string; dataPath: string; personalWorktreesPath: string };
  integration: { appId: string; organizationId: string; baseUrl: string; mcpUrl: string; transport: "streamable-http" };
}

export interface SessionGrant {
  ticket: string;
  expiresAt: string;
  forgeUserId: string;
  workId: string;
  sessionId: string;
  appToken: string;
  appId: string;
  workType: string;
  entityId: string;
  selection?: Record<string, unknown>;
}

export type ReflectionOutcome = "analysis" | "changes" | "api-suggestion";
export interface ReflectionLens { id: "conversation" | "domain-knowledge" | "delegation-gap" | "api-suggestion"; version: number; enabled: boolean; prompt: string; }
export interface ReflectionRecord { id: string; workId?: string; ownerUserId: string; lensId: string; lensVersion: number; lensPrompt: string; question: string; evidenceEventIds: string[]; omRevision: string; status: string; outcome?: ReflectionOutcome; analysis?: string; attribution?: string; suggestionMarkdown?: string; }
export interface ReflectionMessage { id: string; reflectionId: string; role: "user" | "agent"; content: string; at: string; lensId?: string; lensVersion?: number; citedEventIds?: string[]; }
export interface ReflectionAgentResult { outcome: ReflectionOutcome; analysis: string; attribution: string; citedEventIds: string[]; edits?: Array<{ path: string; content: string }>; suggestionMarkdown?: string; changeSummary?: string; }
export type ReflectionToolName = "read_work_trajectory" | "read_candidate_file" | "write_candidate_file";
export interface ReflectionToolStatus { id: string; name: ReflectionToolName; status: "running" | "completed" | "failed"; }
export type ReflectionProgress =
  | { type: "text.delta"; text: string }
  | { type: "text.replace"; text: string }
  | { type: "tool.status"; tool: ReflectionToolStatus }
  | { type: "draft.updated" };
export type ReflectionRunStatus = "running" | "cancelling" | "completed" | "failed" | "cancelled" | "interrupted";
export interface ReflectionRun {
  id: string; reflectionId: string; ownerUserId: string; requestId: string; message: string;
  userMessage: ReflectionMessage; status: ReflectionRunStatus; sequence: number;
  text: string; tools: ReflectionToolStatus[]; agentMessageId?: string;
  error?: string; createdAt: string; updatedAt: string;
}
export interface ReflectionRunEvent { version: 1; runId: string; sequence: number; type: ReflectionProgress["type"] | "snapshot" | "run.status" | "completed" | "failed" | "cancelled"; run: ReflectionRun; }
/** Atomic acceptance records the user's message with the run, never twice. */
export interface ReflectionRunStore {
  reflectionRun(id: string): ReflectionRun | undefined;
  reflectionRunForRequest(reflectionId: string, requestId: string): ReflectionRun | undefined;
  currentReflectionRun(reflectionId: string): ReflectionRun | undefined;
  createReflectionRun(input: Omit<ReflectionRun, "userMessage">): ReflectionRun;
  saveReflectionRun(run: ReflectionRun): void;
  interruptReflectionRuns(now: string): void;
}
export interface WorkListFilters { ownerUserId?: string; workType?: Work["workType"]; status?: Work["status"]; }
export interface OrganizationContribution { id: string; authorUserId: string; sourceRevision: string; baseMainRevision: string; reason: string; evidence: string; status: "open" | "accepted"; selectedPaths: string[]; candidateBranch?: string; reviewedRevision?: string; selectionRevision?: string; acceptedRevision?: string; acceptedAt?: string; createdAt: string; }
export interface OrganizationContributionPort {
  createContribution(record: OrganizationContribution): MaybePromise<void>;
  contribution(id: string): MaybePromise<OrganizationContribution | undefined>;
  contributions(): MaybePromise<OrganizationContribution[]>;
  saveSelection(id: string, expectedRevision: string, revision: string): MaybePromise<void>;
  abandonContribution(id: string, expectedRevision: string): MaybePromise<void>;
}
export type WorkFeedbackKind = "required-human-decision" | "avoidable-correction" | "knowledge-helpful" | "work-outcome-correct" | "work-outcome-incorrect";
export interface WorkFeedback { id: string; workId: string; ownerUserId: string; kind: WorkFeedbackKind; note: string; at: string; }
export interface MeasurementPort {
  recordFeedback(feedback: WorkFeedback): MaybePromise<void>;
  feedbackForWork(workId: string): MaybePromise<WorkFeedback[]>;
  activityCounts(): MaybePromise<{ works: number; completedWorks: number; turns: number; reflections: number }>;
  feedbackCounts(): MaybePromise<Record<WorkFeedbackKind, number>>;
}
export interface TurnRecord { id: string; workId: string; sequence: number; status: string; omRevision: string; catalogDigest: string; contextDigest: string; startedAt: string; }
export interface TrajectoryEvent { id: string; workId: string; turnId?: string; type: "turn.started" | "turn.completed" | "context.assembled" | "context.document-loaded" | "message" | "action" | "error" | "observation" | "work.checkpoint" | "work.feedback"; at: string; payload: Record<string, unknown>; }
export interface OmDraft { ownerUserId: string; path: string; baseRevision: string; content: string; updatedAt: string; }
export interface OmDraftPort {
  draftsForUser(ownerUserId: string): MaybePromise<OmDraft[]>;
}

export interface AccountPort extends UserAdministrationPort {
  ensureUser(email: string): MaybePromise<ForgeUser>;
  linkedUserId(appId: string, appUserId: string): MaybePromise<string | undefined>;
  recordAppIdentity(appId: string, appUserId: string, userId: string, email: string): MaybePromise<void>;
  userByEmail(email: string): MaybePromise<ForgeUser | undefined>;
  userById(userId: string): MaybePromise<ForgeUser | undefined>;
  listUsers(): MaybePromise<ForgeUser[]>;
  passwordHash(email: string): MaybePromise<string | undefined>;
  setInitialPassword(userId: string, hash: string): MaybePromise<boolean>;
}

/** Local operator authority only; not part of browser or Agent account access. */
export interface PasswordAdministrationPort {
  userByEmail(email: string): MaybePromise<ForgeUser | undefined>;
  replacePassword(userId: string, hash: string): MaybePromise<boolean>;
}

export interface WorkPort {
  worksPage(filters: WorkListFilters, offset: number, limit: number): MaybePromise<{ works: Work[]; total: number }>;
  work(workId: string): MaybePromise<Work | undefined>;
  setWorkEntityTitle(workId: string, title: string): MaybePromise<void>;
  turnsForWork(workId: string): MaybePromise<TurnRecord[]>;
  activeWork(ownerUserId: string, appId: string, workType: string, entityId: string): MaybePromise<Work | undefined>;
  createWork(ownerUserId: string, appId: string, workType: string, entityId: string, binding?: { goal: string; appUserId: string; selection?: Record<string, unknown> }): MaybePromise<Work>;
  /** Atomically binds one durable resource conversation; existing histories are selected, never merged. */
  ensureResourceWork(ownerUserId: string, appId: string, workType: string, entityId: string, binding: { goal: string; appUserId: string }): MaybePromise<Work>;
  createOrTouchSession(workId: string): MaybePromise<{ id: string }>;
  userForWork(workId: string): MaybePromise<string | undefined>;
  nextTurn(workId: string, omRevision: string, catalogDigest: string, contextDigest: string): MaybePromise<TurnRecord>;
  completeTurn(turnId: string, status: "completed" | "failed" | "cancelled"): MaybePromise<void>;
  completeWork(workId: string): MaybePromise<void>;
  lenses(): MaybePromise<ReflectionLens[]>;
  lens(id: string): MaybePromise<ReflectionLens | undefined>;
  updateLens(id: string, enabled: boolean, prompt: string): MaybePromise<ReflectionLens>;
  openReflection(input: Omit<ReflectionRecord, "id" | "status" | "outcome" | "analysis" | "attribution" | "suggestionMarkdown">, introduction: string): MaybePromise<ReflectionRecord>;
  reflection(reflectionId: string): MaybePromise<ReflectionRecord | undefined>;
  reflectionsForWork(workId: string): MaybePromise<ReflectionRecord[]>;
  reflectionsForUser(ownerUserId: string): MaybePromise<ReflectionRecord[]>;
  setReflectionRevision(reflectionId: string, revision: string): MaybePromise<void>;
  reflectionMessages(reflectionId: string): MaybePromise<ReflectionMessage[]>;
  appendReflectionMessage(reflectionId: string, role: ReflectionMessage["role"], content: string, context?: { lensId: string; lensVersion: number; citedEventIds: string[] }): MaybePromise<ReflectionMessage>;
  setReflectionResult(reflectionId: string, result: { status: string; outcome?: ReflectionOutcome; analysis?: string; attribution?: string; suggestionMarkdown?: string }): MaybePromise<void>;
  setReflectionContext(reflectionId: string, lens: ReflectionLens, evidenceEventIds: string[]): MaybePromise<void>;
}

export interface OperatingModelPort {
  personalCommitCount?(): MaybePromise<number>;
  initialize(): MaybePromise<void>;
  ensureUserBranch(userId: string): MaybePromise<{ branch: string; worktree: string }>;
  head(branch: string): MaybePromise<string>;
  listFiles(revision: string): MaybePromise<string[]>;
  history(branch: string): MaybePromise<Array<{ revision: string; subject: string; at: string }>>;
  containsRevision(branch: string, revision: string): MaybePromise<boolean>;
  includesRevision(branch: string, revision: string): MaybePromise<boolean>;
  workDefinition(revision: string, id: string): MaybePromise<WorkDefinition>;
  document(revision: string, path: string): MaybePromise<string>;
  knownKnowledge(revision: string): MaybePromise<Set<string>>;
  knowledgePath?(revision: string, id: string): MaybePromise<string>;
  knowledgeIssues(revision: string): MaybePromise<ValidationIssue[]>;
  /** Personal changes still different from the target, excluding target-only updates; retain the merge base for review. */
  divergence(sourceRevision: string, targetRevision: string): MaybePromise<{ baseRevision: string; changedPaths: string[]; diff: string }>;
  pinContributionSource(contributionId: string, sourceRevision: string): MaybePromise<void>;
  prepareContribution(contributionId: string, sourceRevision: string, baseRevision: string, mainRevision: string, selectedPaths: string[], message: string, expectedCandidateRevision: string): MaybePromise<{ revision: string }>;
  acceptContribution(candidateBranch: string, expectedMainRevision: string, expectedCandidateRevision?: string, reviewer?: string): MaybePromise<string>;
}

export interface PasswordCodecPort { hash(password: string): string; verify(password: string, hash: string): boolean; }
export interface PasswordSetupPort { issue(userId: string, expiresAt: string): MaybePromise<string>; consume(ticket: string, now: string): MaybePromise<string | undefined>; }

export interface AppCommandLocator {
  commandId: string;
  capabilityId: string;
  entityId: string;
  targetKind?: string;
  targetId?: string;
  resourceKind: string;
  resourceId: string;
  scope: string;
}
export interface AppCommandTarget {
  resourceKind: string;
  resourceId: string;
  scope: string;
  targetKind: string;
  targetId: string;
}

/** The deployed App adapter owns business DTOs, target validation and receipt semantics. */
export interface AppPort {
  describeIntegration?(): InstanceSettings["integration"];
  bindInput?(entityId: string, input: Record<string, unknown>): Record<string, unknown>;
  auditObservation?(capabilityId: string, result: Record<string, unknown>): Record<string, unknown>;
  toolContent?(capabilityId: string, result: Record<string, unknown>, supportsImages: boolean): AgentToolContent[];
  identity(token: string): Promise<AppIdentity>;
  discoverTools(token: string): Promise<AppToolSnapshot>;
  resourceContext(token: string, entityId: string, selection?: Record<string, unknown>, workType?: string): Promise<Record<string, unknown>>;
  query(token: string, capabilityId: string, input: Record<string, unknown>): Promise<Record<string, unknown>>;
  prepareCommand(token: string, capabilityId: string, input: Record<string, unknown>): Promise<AppCommandTarget>;
  submitCommand(token: string, capabilityId: string, body: Record<string, unknown>, locator?: AppCommandLocator): Promise<{ status: "committed" | "rejected" | "unknown"; receipt?: Record<string, unknown>; reason?: string }>;
  receipt(token: string, locator: AppCommandLocator): Promise<Record<string, unknown> | undefined>;
}

export interface ExtractedEvidence { filename: string; digest: string; text: string; warnings: string[]; }
export interface EvidenceExtractorPort { extract(filename: string, mediaType: string, content: Uint8Array): Promise<ExtractedEvidence>; }
export interface EvidenceSessionPort {
  put(ticket: string, evidence: ExtractedEvidence): MaybePromise<void>;
  take(ticket: string, digests: string[]): MaybePromise<ExtractedEvidence[]>;
  clear(ticket: string): MaybePromise<void>;
}

export interface ToolSnapshotPort {
  /** Immutable metadata only, never an authorization or approval record. */
  recordToolSnapshot(snapshot: AppToolSnapshot): MaybePromise<void>;
  toolSnapshot(appId: string, digest: string): MaybePromise<AppToolSnapshot | undefined>;

}

export type AgentToolContent = { type: "text"; text: string } | { type: "image"; mimeType: string; data: string };
export interface WorkAgentTool {
  content?(result: Record<string, unknown>, supportsImages: boolean): AgentToolContent[];
  capability: AppToolDefinition;
  invoke(input: Record<string, unknown>): Promise<Record<string, unknown>>;
}

export interface WorkActivity {
  id: string;
  turnId?: string;
  phase: "preparing" | "context" | "model" | "tool";
  status: "running" | "completed" | "failed" | "cancelled" | "unknown";
  label: string;
  at: string;
  startedAt: string;
  capabilityId?: string;
  detail?: string;
  code?: string;
}

export interface AgentExecutionScope {
  organizationId: string; ownerUserId: string; workId: string; turnId: string;
  omRevision: string; catalogDigest: string;
}
export interface AgentRuntimeEvent { agentResourceDigest?: string; deploymentId?: string; kind: string; sessionId: string; sessionFile?: string; toolName?: string; toolCallId?: string; status?: string; tokensBefore?: number; }
export interface AgentRunnerPort {
  runWork(input: {
    sessionId: string;
    scope: AgentExecutionScope;
    onRuntimeEvent?: (event: AgentRuntimeEvent) => Promise<void>;
    signal?: AbortSignal;
    userMessage: string;
    context: Record<string, unknown>;
    documents: Array<{ id: string; content: string }>;
    availableDocumentIds: string[];
    loadDocument(id: string): Promise<string>;
    evidence?: Array<{ filename: string; digest: string; text: string }>;
    tools: WorkAgentTool[];
    checkpoint?: (input: WorkCheckpoint) => Promise<{ checkpointId: string }>;
    onText?: (text: string) => void;
    onContextStatus?: (status: "organizing" | "ready" | "failed") => void;
    onModelStatus?: () => void;
    readHistory?: (offset: number, limit: number) => Promise<Array<Record<string, unknown>>>;
  }): Promise<{ text: string }>;
}

export interface ReflectionAgentPort {
  analyze(input: { scope: AgentExecutionScope; onRuntimeEvent?: (event: AgentRuntimeEvent) => Promise<void>; reflectionId: string; lens: ReflectionLens; question: string; messages: ReflectionMessage[]; evidence: TrajectoryEvent[]; readTrajectory?: (offset: number, limit: number) => Promise<TrajectoryEvent[]>; readDraftFile?: (path: string) => Promise<string>; writeDraftFile?: (path: string, content: string, citedEventIds: string[], message: string) => Promise<void>; omRevision: string; documents: Array<{ path: string; content: string }>; privateDrafts?: Array<{ path: string; content: string; baseRevision: string }>; signal?: AbortSignal; onProgress?: (event: ReflectionProgress) => void }): Promise<ReflectionAgentResult>;
}

export interface AppSessionPort { put(session: SessionGrant): MaybePromise<void>; get(ticket: string): MaybePromise<SessionGrant | undefined>; claim(ticket: string): MaybePromise<SessionGrant | undefined>; remove(ticket: string): MaybePromise<void>; }
export interface TrajectoryPort { append(event: TrajectoryEvent): MaybePromise<void>; read(workId: string): MaybePromise<TrajectoryEvent[]>; }
export interface SystemPort { id(prefix: string): string; now(): string; digest(value: unknown): string; }
