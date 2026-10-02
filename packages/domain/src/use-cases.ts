import { isAllowedProposalPath, validateWorkDefinition } from "./operating-model.js";
import type { AccountPort, AppSessionPort, CertReporterPort, OperatingModelPort, PasswordCodecPort, PasswordSetupPort, ProposalRecord, SessionGrant, SystemPort, TrajectoryPort, WorkPort } from "./ports.js";

const lenses = new Set(["domain-knowledge", "delegation-gap", "api-suggestion"]);

export class ForgeUseCases {
  constructor(private readonly ports: { accounts: AccountPort; works: WorkPort; om: OperatingModelPort; certReporter: CertReporterPort; sessions: AppSessionPort; passwordSetups: PasswordSetupPort; passwordCodec: PasswordCodecPort; trajectories: TrajectoryPort; system: SystemPort; initialAdminEmails: Set<string>; }) {}

  async bootstrap(input: { token: string; reportId: string; selection?: Record<string, unknown> }) {
    const identity = await this.ports.certReporter.identity(input.token);
    const context = await this.ports.certReporter.reportContext(input.token, input.reportId, input.selection);
    const resource = context.resource as Record<string, unknown> | undefined;
    if (resource?.namespace !== "certreporter" || resource.resourceType !== "report" || resource.resourceId !== input.reportId) throw new Error("InvalidReportContext");
    const linkedUserId = await this.ports.accounts.linkedUserId(identity.appId, identity.appUserId);
    const matchedUser = await this.ports.accounts.userByEmail(identity.email);
    if (linkedUserId && matchedUser?.id !== linkedUserId) throw new Error("AppIdentityEmailConflict");
    const user = await this.ports.accounts.ensureUser(identity.email, this.ports.initialAdminEmails.has(identity.email));
    const branch = await this.ports.om.ensureUserBranch(user.id);
    await this.ports.accounts.recordAppIdentity(identity.appId, identity.appUserId, user.id, identity.email);
    const work = await this.ports.works.activeWork(user.id, identity.appId, "report-authoring", input.reportId)
      ?? await this.ports.works.createWork(user.id, identity.appId, "report-authoring", input.reportId);
    const session = await this.ports.works.createOrTouchSession(work.id);
    const ticket = this.ports.system.id("acp");
    const expiresAt = new Date(Date.parse(this.ports.system.now()) + 5 * 60_000).toISOString();
    await this.ports.sessions.put({ ticket, expiresAt, forgeUserId: user.id, workId: work.id, sessionId: session.id, appToken: input.token, reportId: input.reportId, selection: input.selection });
    const passwordSetupTicket = user.passwordConfigured ? undefined : await this.ports.passwordSetups.issue(user.id, expiresAt);
    return { user, work, session, ticket, expiresAt, activeRevision: await this.ports.om.head(branch.branch), passwordSetupRequired: !user.passwordConfigured, passwordSetupTicket };
  }

  async appSession(ticket: string): Promise<SessionGrant> {
    const session = await this.ports.sessions.get(ticket);
    if (!session || Date.parse(session.expiresAt) < Date.parse(this.ports.system.now())) { await this.ports.sessions.remove(ticket); throw new Error("AppSessionExpired"); }
    return session;
  }

  async connectAcp(ticket: string): Promise<SessionGrant> {
    const session = await this.appSession(ticket);
    if (!await this.ports.sessions.claim(ticket)) throw new Error("AppSessionAlreadyConnected");
    return session;
  }

  async disconnectAcp(ticket: string): Promise<void> { await this.ports.sessions.remove(ticket); }

  async startTurn(ticket: string, userMessage: string) {
    const session = await this.appSession(ticket);
    await this.assertActiveWork(session);
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
    const session = await this.appSession(ticket); await this.assertActiveWork(session); const revision = await this.ports.om.head(`users/${session.forgeUserId}`);
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
    if (await this.ports.om.head(`users/${session.forgeUserId}`) !== proposal.baseRevision) throw new Error("ActiveRevisionChanged");
    const changedPaths = await this.ports.om.proposalChanges(proposal.worktreePath);
    if (!changedPaths.length) throw new Error("ProposalHasNoChanges");
    if (changedPaths.some((path) => !isAllowedProposalPath(path))) throw new Error("ProposalPathNotAllowed");
    await this.ports.om.commitProposal(proposal.worktreePath, title);
    const candidate = await this.ports.om.head(proposal.branchRef);
    const catalog = await this.ports.certReporter.catalog(session.appToken);
    const definition = await this.ports.om.workDefinition(candidate, "report-authoring");
    const issues = [
      ...validateWorkDefinition(definition, new Set(catalog.capabilities.map((capability) => capability.id)), await this.ports.om.knownKnowledge(candidate)),
      ...await this.ports.om.knowledgeIssues(candidate),
    ];
    for (const document of definition.documents) {
      try { await this.ports.om.document(candidate, `work-definitions/${definition.id}/${document.path}`); }
      catch { issues.push({ path: `documents.${document.id}.path`, message: "document does not exist" }); }
    }
    if (issues.length) throw new Error(`InvalidOperatingModel: ${issues.map((issue) => `${issue.path} ${issue.message}`).join("; ")}`);
    const userWorkspace = await this.ports.om.ensureUserBranch(session.forgeUserId);
    const revision = await this.ports.om.adoptProposal(userWorkspace.branch, userWorkspace.worktree, proposal.branchRef, proposal.baseRevision, { "AiricForge-Proposal": proposalId, "AiricForge-Reflection": proposal.reflectionId, "AiricForge-Base": proposal.baseRevision });
    await this.ports.works.adoptProposal(proposalId);
    return { revision };
  }

  async completeWork(ticket: string, workId: string): Promise<void> { const session = await this.appSession(ticket); if (session.workId !== workId) throw new Error("WorkNotOwned"); await this.assertActiveWork(session); await this.ports.works.completeWork(session.workId); await this.ports.trajectories.append({ id: this.ports.system.id("evt"), workId: session.workId, type: "message", at: this.ports.system.now(), payload: { kind: "work.completed", sessionId: session.sessionId } }); }
  async setPassword(ticket: string, password: string): Promise<void> { const hash = this.ports.passwordCodec.hash(password); const userId = await this.ports.passwordSetups.consume(ticket, this.ports.system.now()); if (!userId) throw new Error("PasswordSetupTicketExpired"); if (!await this.ports.accounts.setInitialPassword(userId, hash)) throw new Error("PasswordAlreadyConfigured"); }
  async login(email: string, password: string) { const user = await this.ports.accounts.userByEmail(email); const hash = user && await this.ports.accounts.passwordHash(user.email); return user && hash && this.ports.passwordCodec.verify(password, hash) ? user : undefined; }
  async webUser(userId: string) { return this.ports.accounts.userById(userId); }
  async listUsers(actorUserId: string) {
    const actor = await this.ports.accounts.userById(actorUserId);
    if (actor?.role !== "admin") throw new Error("Forbidden");
    return this.ports.accounts.listUsers();
  }
  async personalOm(actorUserId: string, ownerUserId: string) {
    const owner = await this.authorizedOmOwner(actorUserId, ownerUserId);
    const revision = await this.ports.om.head(owner.activeBranch);
    return { owner: { id: owner.id, email: owner.email }, branch: owner.activeBranch, revision, files: await this.ports.om.listFiles(revision) };
  }
  async personalOmFile(actorUserId: string, ownerUserId: string, path: string) {
    if (!/^(work-definitions\/[a-z0-9-]+\/(?:work\.yml|[a-z0-9-]+\.md)|subject-knowledge\/[a-z0-9-]+\.md)$/.test(path)) throw new Error("InvalidOmPath");
    const snapshot = await this.personalOm(actorUserId, ownerUserId);
    if (!snapshot.files.includes(path)) throw new Error("OmFileNotFound");
    return { path, revision: snapshot.revision, content: await this.ports.om.document(snapshot.revision, path) };
  }
  async trajectory(ticket: string, workId: string) { const session = await this.appSession(ticket); if (session.workId !== workId) throw new Error("WorkNotOwned"); return this.ports.trajectories.read(workId); }
  private async ownedProposal(session: SessionGrant, proposalId: string): Promise<ProposalRecord> { const proposal = await this.ports.works.proposal(proposalId); if (!proposal || proposal.ownerUserId !== session.forgeUserId || proposal.workId !== session.workId || proposal.status !== "open") throw new Error("ProposalNotOwned"); return proposal; }
  private async assertActiveWork(session: SessionGrant): Promise<void> {
    const work = await this.ports.works.activeWork(session.forgeUserId, "certreporter", "report-authoring", session.reportId);
    if (work?.id !== session.workId) throw new Error("WorkCompleted");
  }
  private async authorizedOmOwner(actorUserId: string, ownerUserId: string) {
    const actor = await this.ports.accounts.userById(actorUserId);
    const owner = await this.ports.accounts.userById(ownerUserId);
    if (!actor || !owner || (actor.id !== owner.id && actor.role !== "admin")) throw new Error("Forbidden");
    return owner;
  }
}
