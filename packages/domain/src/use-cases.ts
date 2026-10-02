import { validateWorkDefinition } from "./operating-model.js";
import type { AccountPort, AppSessionPort, CertReporterPort, OperatingModelPort, ProposalRecord, SessionGrant, SystemPort, TrajectoryPort, WorkPort } from "./ports.js";

const lenses = new Set(["domain-knowledge", "delegation-gap", "api-suggestion"]);

export class ForgeUseCases {
  constructor(private readonly ports: { accounts: AccountPort; works: WorkPort; om: OperatingModelPort; certReporter: CertReporterPort; sessions: AppSessionPort; trajectories: TrajectoryPort; system: SystemPort; initialAdminEmails: Set<string>; }) {}

  async bootstrap(input: { token: string; reportId: string; selection?: Record<string, unknown> }) {
    const identity = await this.ports.certReporter.identity(input.token);
    const user = await this.ports.accounts.ensureUser(identity.email, this.ports.initialAdminEmails.has(identity.email));
    const branch = await this.ports.om.ensureUserBranch(user.id);
    await this.ports.accounts.recordAppIdentity(identity.appId, identity.appUserId, user.id, identity.email);
    const work = await this.ports.works.activeWork(user.id, identity.appId, "report-authoring", input.reportId)
      ?? await this.ports.works.createWork(user.id, identity.appId, "report-authoring", input.reportId);
    const session = await this.ports.works.createOrTouchSession(work.id);
    const ticket = this.ports.system.id("acp");
    const expiresAt = new Date(Date.parse(this.ports.system.now()) + 5 * 60_000).toISOString();
    await this.ports.sessions.put({ ticket, expiresAt, forgeUserId: user.id, workId: work.id, sessionId: session.id, appToken: input.token, reportId: input.reportId, selection: input.selection });
    return { user, work, session, ticket, expiresAt, activeRevision: await this.ports.om.head(branch.branch), passwordSetupRequired: !user.passwordConfigured };
  }

  async appSession(ticket: string): Promise<SessionGrant> {
    const session = await this.ports.sessions.get(ticket);
    if (!session || Date.parse(session.expiresAt) < Date.parse(this.ports.system.now())) { await this.ports.sessions.remove(ticket); throw new Error("AppSessionExpired"); }
    return session;
  }

  async startTurn(ticket: string, userMessage: string) {
    const session = await this.appSession(ticket);
    const userId = await this.ports.works.userForWork(session.workId);
    if (!userId) throw new Error("WorkNotFound");
    const revision = await this.ports.om.head(`users/${userId}`);
    const [catalog, definition, context] = await Promise.all([
      this.ports.certReporter.catalog(session.appToken), this.ports.om.workDefinition(revision, "report-authoring"), this.ports.certReporter.reportContext(session.appToken, session.reportId, session.selection),
    ]);
    const issues = validateWorkDefinition(definition, new Set(catalog.capabilities.map((capability) => capability.id)), await this.ports.om.knownKnowledge(revision));
    if (issues.length) throw new Error(`InvalidOperatingModel: ${issues.map((issue) => `${issue.path} ${issue.message}`).join("; ")}`);
    const documents = await Promise.all(definition.documents.filter((document) => document.load === "required").map(async (document) => ({ id: document.id, path: `work-definitions/${definition.id}/${document.path}`, revision, reason: "work-definition" as const, content: await this.ports.om.document(revision, `work-definitions/${definition.id}/${document.path}`) })));
    const turn = await this.ports.works.nextTurn(session.workId, revision, catalog.digest, this.ports.system.digest(context));
    await this.ports.trajectories.append({ id: this.ports.system.id("evt"), workId: session.workId, turnId: turn.id, type: "turn.started", at: turn.startedAt, payload: { omRevision: revision, catalogDigest: catalog.digest, userMessage } });
    await this.ports.trajectories.append({ id: this.ports.system.id("evt"), workId: session.workId, turnId: turn.id, type: "context.assembled", at: this.ports.system.now(), payload: { contextDigest: this.ports.system.digest(context), documents: documents.map(({ content: _, ...provenance }) => provenance) } });
    await this.ports.works.completeTurn(turn.id, "completed");
    await this.ports.trajectories.append({ id: this.ports.system.id("evt"), workId: session.workId, turnId: turn.id, type: "turn.completed", at: this.ports.system.now(), payload: { result: "Context compiled; Agent runner is ready for configured model execution." } });
    return { turn, context, documents: documents.map(({ content: _, ...provenance }) => provenance), reply: "已固定本轮报告上下文和 Operating Model 版本。模型执行适配器尚未配置，因此没有发起业务命令。" };
  }

  async openReflection(ticket: string, lensId: string, question: string) {
    if (!lenses.has(lensId)) throw new Error("UnknownReflectionLens");
    const session = await this.appSession(ticket); const revision = await this.ports.om.head(`users/${session.forgeUserId}`);
    const reflection = await this.ports.works.createReflection(session.workId, session.forgeUserId, lensId, question);
    const proposalId = this.ports.system.id("prp"); const proposalGit = await this.ports.om.createProposal(session.forgeUserId, proposalId, revision);
    const proposal = await this.ports.works.createProposal({ id: proposalId, reflectionId: reflection.id, workId: session.workId, ownerUserId: session.forgeUserId, baseRevision: revision, branchRef: proposalGit.branch, worktreePath: proposalGit.worktree, status: "open" });
    await this.ports.trajectories.append({ id: this.ports.system.id("evt"), workId: session.workId, type: "message", at: this.ports.system.now(), payload: { kind: "reflection.opened", reflectionId: reflection.id, lensId, question, proposalId: proposal.id, baseRevision: revision } });
    return { reflection, proposal };
  }

  async writeProposal(ticket: string, proposalId: string, path: string, content: string) {
    const session = await this.appSession(ticket); const proposal = await this.ownedProposal(session, proposalId);
    await this.ports.om.writeProposalFile(proposal.worktreePath, path, content);
    return { changedPaths: await this.ports.om.proposalChanges(proposal.worktreePath) };
  }

  async adoptProposal(ticket: string, proposalId: string, title: string) {
    const session = await this.appSession(ticket); const proposal = await this.ownedProposal(session, proposalId);
    await this.ports.om.commitProposal(proposal.worktreePath, title);
    const userWorkspace = await this.ports.om.ensureUserBranch(session.forgeUserId);
    const revision = await this.ports.om.adoptProposal(userWorkspace.branch, userWorkspace.worktree, proposal.branchRef, proposal.baseRevision, { "AiricForge-Proposal": proposalId, "AiricForge-Reflection": proposal.reflectionId, "AiricForge-Base": proposal.baseRevision });
    await this.ports.works.adoptProposal(proposalId);
    return { revision };
  }

  async completeWork(ticket: string): Promise<void> { const session = await this.appSession(ticket); await this.ports.works.completeWork(session.workId); await this.ports.trajectories.append({ id: this.ports.system.id("evt"), workId: session.workId, type: "message", at: this.ports.system.now(), payload: { kind: "work.completed", sessionId: session.sessionId } }); }
  async setPassword(ticket: string, hash: string): Promise<void> { const session = await this.appSession(ticket); await this.ports.accounts.setPassword(session.forgeUserId, hash); }
  async login(email: string, password: string, verify: (password: string, hash: string) => boolean) { const user = await this.ports.accounts.userByEmail(email); const hash = user && await this.ports.accounts.passwordHash(user.email); return user && hash && verify(password, hash) ? user : undefined; }
  async trajectory(ticket: string, workId: string) { const session = await this.appSession(ticket); if (session.workId !== workId) throw new Error("WorkNotOwned"); return this.ports.trajectories.read(workId); }
  private async ownedProposal(session: SessionGrant, proposalId: string): Promise<ProposalRecord> { const proposal = await this.ports.works.proposal(proposalId); if (!proposal || proposal.ownerUserId !== session.forgeUserId || proposal.workId !== session.workId || proposal.status !== "open") throw new Error("ProposalNotOwned"); return proposal; }
}
