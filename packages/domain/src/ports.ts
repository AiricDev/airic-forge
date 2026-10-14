import type { AppIdentity, CapabilityCatalog, CapabilityDefinition, ForgeUser } from "./model.js";
import type { ValidationIssue, WorkDefinition } from "./operating-model.js";
import type { Work } from "./work.js";
import type { WorkCheckpoint } from "./work-progress.js";

/** A port is written in the language of a Forge use case, never an SDK or SQL API. */
export type MaybePromise<T> = T | Promise<T>;

export interface SessionGrant {
  ticket: string;
  expiresAt: string;
  forgeUserId: string;
  workId: string;
  sessionId: string;
  appToken: string;
  reportId: string;
  workType?: "report-authoring" | "report-type-definition";
  entityId?: string;
  selection?: Record<string, unknown>;
}

export type ReflectionOutcome = "analysis" | "proposal" | "api-suggestion";
export interface ReflectionLens { id: "conversation" | "domain-knowledge" | "delegation-gap" | "api-suggestion"; version: number; enabled: boolean; prompt: string; }
export interface ReflectionRecord { id: string; workId: string; ownerUserId: string; lensId: string; lensVersion: number; lensPrompt: string; question: string; evidenceEventIds: string[]; omRevision: string; status: string; outcome?: ReflectionOutcome; analysis?: string; attribution?: string; suggestionMarkdown?: string; }
export interface ReflectionMessage { id: string; reflectionId: string; role: "user" | "agent"; content: string; at: string; lensId?: string; lensVersion?: number; citedEventIds?: string[]; }
export interface ReflectionAgentResult { outcome: ReflectionOutcome; analysis: string; attribution: string; citedEventIds: string[]; edits?: Array<{ path: string; content: string }>; suggestionMarkdown?: string; proposalMessage?: string; }
export type ReflectionToolName = "read_work_trajectory" | "read_candidate_file" | "write_candidate_file";
export interface ReflectionToolStatus { id: string; name: ReflectionToolName; status: "running" | "completed" | "failed"; }
export type ReflectionProgress =
  | { type: "text.delta"; text: string }
  | { type: "text.replace"; text: string }
  | { type: "tool.status"; tool: ReflectionToolStatus }
  | { type: "proposal.updated"; proposalId: string };
export type ReflectionRunStatus = "running" | "cancelling" | "completed" | "failed" | "cancelled" | "interrupted";
export interface ReflectionRun {
  id: string; reflectionId: string; ownerUserId: string; requestId: string; message: string;
  userMessage: ReflectionMessage; status: ReflectionRunStatus; sequence: number;
  text: string; tools: ReflectionToolStatus[]; proposalId?: string; agentMessageId?: string;
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
export interface ProposalRecord { id: string; reflectionId?: string; workId?: string; ownerUserId: string; baseRevision: string; branchRef: string; worktreePath: string; status: string; source: string; reason: string; evidence: string; reviewedRevision?: string; upstreamRevision?: string; }
export interface WorkListFilters { ownerUserId?: string; workType?: Work["workType"]; status?: Work["status"]; }
export interface ProposalListFilters { ownerUserId?: string; status?: "open" | "adopted" | "abandoned"; source?: "personal" | "reflection" | "organization-sync"; }
export interface OrganizationContribution { id: string; authorUserId: string; sourceRevision: string; baseMainRevision: string; reason: string; evidence: string; status: "open" | "reviewed" | "accepted"; selectedPaths: string[]; candidateBranch?: string; candidateWorktree?: string; reviewedRevision?: string; acceptedRevision?: string; createdAt: string; }
export interface OrganizationContributionPort {
  createContribution(record: OrganizationContribution): MaybePromise<void>;
  contribution(id: string): MaybePromise<OrganizationContribution | undefined>;
  contributions(): MaybePromise<OrganizationContribution[]>;
  reviewContribution(id: string, selectedPaths: string[], candidateBranch: string, candidateWorktree: string, reviewedRevision: string, baseMainRevision: string): MaybePromise<void>;
  acceptContribution(id: string, acceptedRevision: string): MaybePromise<void>;
}
export type WorkFeedbackKind = "required-human-decision" | "avoidable-correction" | "knowledge-helpful" | "work-outcome-correct" | "work-outcome-incorrect";
export interface WorkFeedback { id: string; workId: string; ownerUserId: string; kind: WorkFeedbackKind; note: string; at: string; }
export interface MeasurementPort {
  recordFeedback(feedback: WorkFeedback): MaybePromise<void>;
  feedbackForWork(workId: string): MaybePromise<WorkFeedback[]>;
  activityCounts(): MaybePromise<{ works: number; completedWorks: number; turns: number; reflections: number; personalProposals: number; adoptedPersonalProposals: number; organizationContributions: number; acceptedOrganizationContributions: number; synchronizedProposals: number; medianPersonalProposalHours: number | null; medianOrganizationReviewHours: number | null }>;
  feedbackCounts(): MaybePromise<Record<WorkFeedbackKind, number>>;
}
export interface TurnRecord { id: string; workId: string; sequence: number; status: string; omRevision: string; catalogDigest: string; contextDigest: string; startedAt: string; }
export interface TrajectoryEvent { id: string; workId: string; turnId?: string; type: "turn.started" | "turn.completed" | "context.assembled" | "context.document-loaded" | "message" | "action" | "error" | "observation" | "work.checkpoint" | "work.feedback"; at: string; payload: Record<string, unknown>; }
export interface OmDraft { ownerUserId: string; path: string; baseRevision: string; content: string; updatedAt: string; }
export interface OmDraftPort {
  draftsForUser(ownerUserId: string): MaybePromise<OmDraft[]>;
  saveDraft(draft: OmDraft): MaybePromise<void>;
  discardDraft(ownerUserId: string, path: string): MaybePromise<void>;
}

export interface AccountPort {
  ensureUser(email: string, initialAdmin: boolean): MaybePromise<ForgeUser>;
  linkedUserId(appId: string, appUserId: string): MaybePromise<string | undefined>;
  recordAppIdentity(appId: string, appUserId: string, userId: string, email: string): MaybePromise<void>;
  userByEmail(email: string): MaybePromise<ForgeUser | undefined>;
  userById(userId: string): MaybePromise<ForgeUser | undefined>;
  listUsers(): MaybePromise<ForgeUser[]>;
  passwordHash(email: string): MaybePromise<string | undefined>;
  setInitialPassword(userId: string, hash: string): MaybePromise<boolean>;
}

export interface WorkPort {
  worksPage(filters: WorkListFilters, offset: number, limit: number): MaybePromise<{ works: Work[]; total: number }>;
  proposalsPage(filters: ProposalListFilters, offset: number, limit: number): MaybePromise<{ proposals: ProposalRecord[]; total: number }>;
  work(workId: string): MaybePromise<Work | undefined>;
  setWorkEntityTitle(workId: string, title: string): MaybePromise<void>;
  turnsForWork(workId: string): MaybePromise<TurnRecord[]>;
  activeWork(ownerUserId: string, appId: string, workType: string, entityId: string): MaybePromise<Work | undefined>;
  createWork(ownerUserId: string, appId: string, workType: string, entityId: string, binding?: { goal: string; appUserId: string; selection?: Record<string, unknown> }): MaybePromise<Work>;
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
  reflectionMessages(reflectionId: string): MaybePromise<ReflectionMessage[]>;
  appendReflectionMessage(reflectionId: string, role: ReflectionMessage["role"], content: string, context?: { lensId: string; lensVersion: number; citedEventIds: string[] }): MaybePromise<ReflectionMessage>;
  setReflectionResult(reflectionId: string, result: { status: string; outcome?: ReflectionOutcome; analysis?: string; attribution?: string; suggestionMarkdown?: string }): MaybePromise<void>;
  setReflectionContext(reflectionId: string, lens: ReflectionLens, evidenceEventIds: string[]): MaybePromise<void>;
  proposalForReflection(reflectionId: string): MaybePromise<ProposalRecord | undefined>;
  proposalsForWork(workId: string): MaybePromise<ProposalRecord[]>;
  createProposal(proposal: ProposalRecord): MaybePromise<ProposalRecord>;
  proposal(proposalId: string): MaybePromise<ProposalRecord | undefined>;
  proposalsForUser(ownerUserId: string): MaybePromise<ProposalRecord[]>;
  updateProposalBase(proposalId: string, baseRevision: string): MaybePromise<void>;
  setProposalReview(proposalId: string, revision: string | undefined): MaybePromise<void>;
  setProposalMessage(proposalId: string, message: string, evidence: string): MaybePromise<void>;
  adoptProposal(proposalId: string): MaybePromise<void>;
  abandonReflectionProposal(proposalId: string, reflectionId: string, message: string): MaybePromise<void>;
}

export interface OperatingModelPort {
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
  createProposal(userId: string, proposalId: string, baseRevision: string): MaybePromise<{ branch: string; worktree: string }>;
  writeProposalFile(worktree: string, path: string, content: string): MaybePromise<void>;
  makeKnowledgeAvailable(worktree: string, workDefinitionId: string, knowledgePaths: string[]): MaybePromise<void>;
  proposalChanges(worktree: string): MaybePromise<string[]>;
  proposalChangedPaths(worktree: string, baseRevision: string): MaybePromise<string[]>;
  proposalConflicts(worktree: string): MaybePromise<string[]>;
  proposalFile(worktree: string, path: string): MaybePromise<string>;
  proposalDiff(worktree: string, baseRevision: string): MaybePromise<string>;
  commitProposal(worktree: string, title: string): MaybePromise<void>;
  rebaseProposal(worktree: string, oldBase: string, newBase: string): MaybePromise<void>;
  adoptProposal(userBranch: string, userWorktree: string, proposalBranch: string, baseRevision: string, trailers: Record<string, string>): MaybePromise<string>;
  divergence(sourceRevision: string, targetRevision: string): MaybePromise<{ baseRevision: string; changedPaths: string[]; diff: string }>;
  pinContributionSource(contributionId: string, sourceRevision: string): MaybePromise<void>;
  prepareContribution(contributionId: string, sourceRevision: string, baseRevision: string, mainRevision: string, selectedPaths: string[], message: string): MaybePromise<{ branch: string; worktree: string; revision: string }>;
  acceptContribution(candidateBranch: string, expectedMainRevision: string): MaybePromise<string>;
  synchronizeProposal(worktree: string, personalRevision: string, mainRevision: string): MaybePromise<void>;
  adoptSynchronizedProposal(userBranch: string, userWorktree: string, proposalBranch: string, baseRevision: string, expectedMainRevision: string, trailers: Record<string, string>): MaybePromise<string>;
}

export interface PasswordCodecPort { hash(password: string): string; verify(password: string, hash: string): boolean; }
export interface PasswordSetupPort { issue(userId: string, expiresAt: string): MaybePromise<string>; consume(ticket: string, now: string): MaybePromise<string | undefined>; }

export interface CertReporterPort {
  identity(token: string): Promise<AppIdentity>;
  catalog(token: string): Promise<CapabilityCatalog>;
  openApi(token: string): Promise<Record<string, unknown>>;
  reportContext(token: string, reportId: string, selection?: Record<string, unknown>): Promise<Record<string, unknown>>;
  reportTypeContext?(token: string, reportTypeId: string, selection?: Record<string, unknown>): Promise<Record<string, unknown>>;
  query(token: string, capabilityId: string, input: Record<string, unknown>): Promise<Record<string, unknown>>;
  submitCommand(token: string, capabilityId: string, body: Record<string, unknown>): Promise<{ status: "committed" | "rejected" | "unknown"; receipt?: Record<string, unknown>; reason?: string }>;
  receipt(token: string, commandId: string): Promise<Record<string, unknown> | undefined>;
}

export interface AppCommandLocator {
  commandId: string;
  capabilityId: string;
  reportId: string;
  assessmentId?: string;
  targetKind?: string;
  targetId?: string;
  resourceKind: "project";
  resourceId: string;
  scope: string;
}
export interface AppCommandTarget {
  resourceKind: "project";
  resourceId: string;
  scope: string;
  targetKind: string;
  targetId: string;
}

/** Only the configured CertLab binding implements the live App port. */
export interface AppPort {
  identity(token: string): Promise<AppIdentity>;
  catalog(token: string): Promise<CapabilityCatalog>;
  openApi(token: string): Promise<Record<string, unknown>>;
  reportContext(token: string, reportId: string, selection?: Record<string, unknown>): Promise<Record<string, unknown>>;
  query(token: string, capabilityId: string, input: Record<string, unknown>): Promise<Record<string, unknown>>;
  prepareCommand?(token: string, capabilityId: string, input: Record<string, unknown>): Promise<AppCommandTarget>;
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

export interface CatalogPort {
  saveCandidate(catalog: CapabilityCatalog, openApi: Record<string, unknown>): MaybePromise<void>;
  candidate(appId: string, digest: string): MaybePromise<CapabilityCatalog | undefined>;
  candidates(appId: string): MaybePromise<CapabilityCatalog[]>;
  accept(appId: string, digest: string, acceptedBy: string): MaybePromise<void>;
  accepted(appId: string): MaybePromise<CapabilityCatalog | undefined>;
}

export interface WorkAgentTool {
  capability: CapabilityDefinition;
  invoke(input: Record<string, unknown>): Promise<Record<string, unknown>>;
}

export interface AgentRunnerPort {
  runWork(input: {
    sessionId: string;
    signal?: AbortSignal;
    userMessage: string;
    context: Record<string, unknown>;
    documents: Array<{ id: string; content: string }>;
    availableDocumentIds: string[];
    loadDocument(id: string): Promise<string>;
    evidence?: Array<{ filename: string; digest: string; text: string }>;
    conversation?: Array<{ role: "user" | "agent"; text: string }>;
    tools: WorkAgentTool[];
    checkpoint?: (input: WorkCheckpoint) => Promise<{ checkpointId: string }>;
    onText?: (text: string) => void;
    onContextStatus?: (status: "organizing" | "ready" | "failed") => void;
    readHistory?: (offset: number, limit: number) => Promise<Array<Record<string, unknown>>>;
    inputTokens?: number;
    outputTokens?: number;
  }): Promise<{ text: string }>;
}

export interface ReflectionAgentPort {
  analyze(input: { reflectionId: string; lens: ReflectionLens; question: string; messages: ReflectionMessage[]; evidence: TrajectoryEvent[]; readTrajectory?: (offset: number, limit: number) => Promise<TrajectoryEvent[]>; readProposalFile?: (path: string) => Promise<string>; writeProposalFile?: (path: string, content: string, citedEventIds: string[], message: string) => Promise<void>; omRevision: string; documents: Array<{ path: string; content: string }>; privateDrafts?: Array<{ path: string; content: string; baseRevision: string }>; signal?: AbortSignal; onProgress?: (event: ReflectionProgress) => void }): Promise<ReflectionAgentResult>;
}

export interface AppSessionPort { put(session: SessionGrant): MaybePromise<void>; get(ticket: string): MaybePromise<SessionGrant | undefined>; claim(ticket: string): MaybePromise<SessionGrant | undefined>; remove(ticket: string): MaybePromise<void>; }
export interface TrajectoryPort { append(event: TrajectoryEvent): MaybePromise<void>; read(workId: string): MaybePromise<TrajectoryEvent[]>; }
export interface SystemPort { id(prefix: string): string; now(): string; digest(value: unknown): string; }
