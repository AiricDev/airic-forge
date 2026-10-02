import type { WorkDefinition } from "@airic-forge/domain";
import { validateWorkDefinition } from "@airic-forge/domain";
import { CertReporterClient } from "./certreporter-client.js";
import { ForgeConfig } from "./config.js";
import { ForgeDatabase } from "./database.js";
import { digest, id } from "./ids.js";
import { GitOperatingModel } from "./git-om.js";
import { JsonlTrajectoryStore } from "./trajectory.js";

export interface AppSession {
  ticket: string;
  expiresAt: string;
  forgeUserId: string;
  workId: string;
  sessionId: string;
  appToken: string;
  reportId: string;
  selection?: Record<string, unknown>;
}

export class ForgeRuntime {
  readonly sessions = new Map<string, AppSession>();
  readonly db: ForgeDatabase;
  readonly om: GitOperatingModel;
  readonly trajectories: JsonlTrajectoryStore;
  readonly certReporter: CertReporterClient;

  constructor(readonly config: ForgeConfig) {
    this.db = new ForgeDatabase(config.dataDir);
    this.om = new GitOperatingModel(config.projectDir, config.dataDir, config.seedProjectDir);
    this.trajectories = new JsonlTrajectoryStore(config.dataDir);
    this.certReporter = new CertReporterClient(config.certReporterUrl);
    this.om.initialize();
  }

  async bootstrap(token: string, reportId: string, selection?: Record<string, unknown>) {
    const identity = await this.certReporter.identity(token);
    const user = this.db.ensureUser(identity.email, this.config.initialAdminEmails.has(identity.email));
    const userGit = this.om.ensureUserBranch(user.id);
    this.db.recordAppIdentity(identity.appId, identity.appUserId, user.id, identity.email);
    const work = this.db.activeWork(user.id, identity.appId, "report-authoring", reportId) ?? this.db.createWork(user.id, identity.appId, "report-authoring", reportId);
    const session = this.db.createOrTouchSession(String(work.id));
    const ticket = id("acp"); const expiresAt = new Date(Date.now() + 5 * 60_000).toISOString();
    this.sessions.set(ticket, { ticket, expiresAt, forgeUserId: user.id, workId: String(work.id), sessionId: String(session.id), appToken: token, reportId, selection });
    return { user, work, session, ticket, expiresAt, activeRevision: this.om.head(userGit.branch), passwordSetupRequired: !user.passwordConfigured };
  }

  session(ticket: string): AppSession {
    const session = this.sessions.get(ticket);
    if (!session || Date.parse(session.expiresAt) < Date.now()) { this.sessions.delete(ticket); throw new Error("AppSessionExpired"); }
    return session;
  }

  async startTurn(ticket: string, userMessage: string) {
    const session = this.session(ticket);
    const user = this.db.userForWork(session.workId);
    if (!user) throw new Error("WorkNotFound");
    const branch = `users/${user}`; const revision = this.om.head(branch);
    const catalog = await this.certReporter.catalog(session.appToken);
    const definition = this.om.workDefinition(revision, "report-authoring");
    this.#validate(definition, revision, catalog.capabilities.map((capability) => capability.id));
    const context = await this.certReporter.reportContext(session.appToken, session.reportId, session.selection);
    const documents = definition.documents.filter((document) => document.load === "required").map((document) => ({ id: document.id, path: `work-definitions/${definition.id}/${document.path}`, revision, reason: "work-definition" as const, content: this.om.document(revision, `work-definitions/${definition.id}/${document.path}`) }));
    const turn = this.db.nextTurn(session.workId, revision, catalog.digest, digest(context));
    this.trajectories.append({ id: id("evt"), workId: session.workId, turnId: String(turn.id), type: "turn.started", at: String(turn.started_at), payload: { omRevision: revision, catalogDigest: catalog.digest, userMessage } });
    this.trajectories.append({ id: id("evt"), workId: session.workId, turnId: String(turn.id), type: "context.assembled", at: new Date().toISOString(), payload: { contextDigest: digest(context), documents: documents.map(({ content: _, ...provenance }) => provenance) } });
    this.db.completeTurn(String(turn.id), "completed");
    this.trajectories.append({ id: id("evt"), workId: session.workId, turnId: String(turn.id), type: "turn.completed", at: new Date().toISOString(), payload: { result: "Context compiled; Agent runner is ready for configured model execution." } });
    return { turn, context, documents: documents.map(({ content: _, ...provenance }) => provenance), reply: "已固定本轮报告上下文和 Operating Model 版本。模型执行适配器尚未配置，因此没有发起业务命令。" };
  }

  openReflection(ticket: string, lensId: string, question: string) {
    const session = this.session(ticket);
    if (!["domain-knowledge", "delegation-gap", "api-suggestion"].includes(lensId)) throw new Error("UnknownReflectionLens");
    const revision = this.om.head(`users/${session.forgeUserId}`);
    const reflection = this.db.createReflection(session.workId, session.forgeUserId, lensId, question);
    const proposalId = id("prp"); const proposalGit = this.om.createProposal(session.forgeUserId, proposalId, revision);
    const proposal = this.db.createProposal(proposalId, String(reflection.id), session.workId, session.forgeUserId, revision, proposalGit.branch, proposalGit.worktree);
    this.trajectories.append({ id: id("evt"), workId: session.workId, type: "message", at: new Date().toISOString(), payload: { kind: "reflection.opened", reflectionId: reflection.id, lensId, question, proposalId: proposal.id, baseRevision: revision } });
    return { reflection, proposal };
  }

  writeProposal(ticket: string, proposalId: string, path: string, content: string) {
    const session = this.session(ticket); const proposal = this.db.proposal(proposalId);
    if (!proposal || proposal.owner_user_id !== session.forgeUserId || proposal.work_id !== session.workId || proposal.status !== "open") throw new Error("ProposalNotOwned");
    this.om.writeProposalFile(String(proposal.worktree_path), path, content);
    return { changedPaths: this.om.proposalChanges(String(proposal.worktree_path)) };
  }

  adoptProposal(ticket: string, proposalId: string, title: string) {
    const session = this.session(ticket); const proposal = this.db.proposal(proposalId);
    if (!proposal || proposal.owner_user_id !== session.forgeUserId || proposal.work_id !== session.workId || proposal.status !== "open") throw new Error("ProposalNotOwned");
    this.om.commitProposal(String(proposal.worktree_path), title);
    const userWorktree = `${this.config.dataDir}/worktrees/users/${session.forgeUserId}`;
    const revision = this.om.adoptProposal(`users/${session.forgeUserId}`, userWorktree, String(proposal.branch_ref), String(proposal.base_revision), { "AiricForge-Proposal": proposalId, "AiricForge-Reflection": String(proposal.reflection_id), "AiricForge-Base": String(proposal.base_revision) });
    this.db.adoptProposal(proposalId);
    return { revision };
  }

  completeWork(ticket: string): void {
    const session = this.session(ticket); this.db.completeWork(session.workId);
    this.trajectories.append({ id: id("evt"), workId: session.workId, type: "message", at: new Date().toISOString(), payload: { kind: "work.completed", sessionId: session.sessionId } });
  }

  #validate(definition: WorkDefinition, revision: string, capabilityIds: string[]): void {
    const issues = validateWorkDefinition(definition, new Set(capabilityIds), this.om.knownKnowledge(revision));
    if (issues.length) throw new Error(`InvalidOperatingModel: ${issues.map((issue) => `${issue.path} ${issue.message}`).join("; ")}`);
  }
}
