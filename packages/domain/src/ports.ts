import type { AppIdentity, CapabilityCatalog, ForgeUser } from "./model.js";
import type { ValidationIssue, WorkDefinition } from "./operating-model.js";
import type { Work } from "./work.js";

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
  selection?: Record<string, unknown>;
}

export interface ReflectionRecord { id: string; workId: string; ownerUserId: string; lensId: string; question: string; status: string; }
export interface ProposalRecord { id: string; reflectionId: string; workId: string; ownerUserId: string; baseRevision: string; branchRef: string; worktreePath: string; status: string; }
export interface TurnRecord { id: string; workId: string; sequence: number; status: string; omRevision: string; catalogDigest: string; contextDigest: string; startedAt: string; }
export interface TrajectoryEvent { id: string; workId: string; turnId?: string; type: "turn.started" | "turn.completed" | "context.assembled" | "message" | "action" | "error"; at: string; payload: Record<string, unknown>; }

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
  activeWork(ownerUserId: string, appId: string, workType: string, entityId: string): MaybePromise<Work | undefined>;
  createWork(ownerUserId: string, appId: string, workType: string, entityId: string): MaybePromise<Work>;
  createOrTouchSession(workId: string): MaybePromise<{ id: string }>;
  userForWork(workId: string): MaybePromise<string | undefined>;
  nextTurn(workId: string, omRevision: string, catalogDigest: string, contextDigest: string): MaybePromise<TurnRecord>;
  completeTurn(turnId: string, status: "completed" | "failed"): MaybePromise<void>;
  completeWork(workId: string): MaybePromise<void>;
  createReflection(workId: string, ownerUserId: string, lensId: string, question: string): MaybePromise<ReflectionRecord>;
  createProposal(proposal: ProposalRecord): MaybePromise<ProposalRecord>;
  proposal(proposalId: string): MaybePromise<ProposalRecord | undefined>;
  adoptProposal(proposalId: string): MaybePromise<void>;
}

export interface OperatingModelPort {
  initialize(): MaybePromise<void>;
  ensureUserBranch(userId: string): MaybePromise<{ branch: string; worktree: string }>;
  head(branch: string): MaybePromise<string>;
  listFiles(revision: string): MaybePromise<string[]>;
  workDefinition(revision: string, id: string): MaybePromise<WorkDefinition>;
  document(revision: string, path: string): MaybePromise<string>;
  knownKnowledge(revision: string): MaybePromise<Set<string>>;
  knowledgeIssues(revision: string): MaybePromise<ValidationIssue[]>;
  createProposal(userId: string, proposalId: string, baseRevision: string): MaybePromise<{ branch: string; worktree: string }>;
  writeProposalFile(worktree: string, path: string, content: string): MaybePromise<void>;
  proposalChanges(worktree: string): MaybePromise<string[]>;
  commitProposal(worktree: string, title: string): MaybePromise<void>;
  adoptProposal(userBranch: string, userWorktree: string, proposalBranch: string, baseRevision: string, trailers: Record<string, string>): MaybePromise<string>;
}

export interface PasswordCodecPort { hash(password: string): string; verify(password: string, hash: string): boolean; }
export interface PasswordSetupPort { issue(userId: string, expiresAt: string): MaybePromise<string>; consume(ticket: string, now: string): MaybePromise<string | undefined>; }

export interface CertReporterPort {
  identity(token: string): Promise<AppIdentity>;
  catalog(token: string): Promise<CapabilityCatalog>;
  reportContext(token: string, reportId: string, selection?: Record<string, unknown>): Promise<Record<string, unknown>>;
}

export interface AppSessionPort { put(session: SessionGrant): MaybePromise<void>; get(ticket: string): MaybePromise<SessionGrant | undefined>; claim(ticket: string): MaybePromise<SessionGrant | undefined>; remove(ticket: string): MaybePromise<void>; }
export interface TrajectoryPort { append(event: TrajectoryEvent): MaybePromise<void>; read(workId: string): MaybePromise<TrajectoryEvent[]>; }
export interface SystemPort { id(prefix: string): string; now(): string; digest(value: unknown): string; }
