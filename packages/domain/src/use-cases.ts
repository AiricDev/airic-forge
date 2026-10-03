import { isAllowedProposalPath, validateWorkDefinition } from "./operating-model.js";
import type { AccountPort, AgentRunnerPort, AppSessionPort, CatalogPort, CertReporterPort, EvidenceExtractorPort, EvidenceSessionPort, OperatingModelPort, PasswordCodecPort, PasswordSetupPort, ProposalRecord, ReflectionAgentPort, ReflectionLens, ReflectionRecord, SessionGrant, SystemPort, TrajectoryPort, WorkPort, WorkAgentTool } from "./ports.js";

const lenses = new Set(["domain-knowledge", "delegation-gap", "api-suggestion"]);

export class ForgeUseCases {
  private readonly runningWorks = new Set<string>();
  private readonly runningReflections = new Set<string>();
  constructor(private readonly ports: { accounts: AccountPort; works: WorkPort; om: OperatingModelPort; certReporter: CertReporterPort; catalogs: CatalogPort; agents: AgentRunnerPort; reflectionAgent?: ReflectionAgentPort; sessions: AppSessionPort; evidenceExtractor?: EvidenceExtractorPort; evidenceSessions?: EvidenceSessionPort; passwordSetups: PasswordSetupPort; passwordCodec: PasswordCodecPort; trajectories: TrajectoryPort; system: SystemPort; initialAdminEmails: Set<string>; }) {}

  async bootstrap(input: { token: string; reportId?: string; entityId?: string; workType?: "report-authoring" | "report-type-definition"; selection?: Record<string, unknown> }) {
    const workType = input.workType ?? "report-authoring";
    const entityId = input.entityId ?? input.reportId;
    if (!entityId || !["report-authoring", "report-type-definition"].includes(workType)) throw new Error("UnsupportedAppContext");
    const identity = await this.ports.certReporter.identity(input.token);
    const email = identity.email.trim().toLowerCase();
    const context = await this.authoritativeContext(input.token, workType, entityId, input.selection);
    this.assertContextTarget(context, workType, entityId);
    const linkedUserId = await this.ports.accounts.linkedUserId(identity.appId, identity.appUserId);
    const matchedUser = await this.ports.accounts.userByEmail(email);
    if (linkedUserId && matchedUser?.id !== linkedUserId) throw new Error("AppIdentityEmailConflict");
    const user = await this.ports.accounts.ensureUser(email, this.ports.initialAdminEmails.has(email));
    const branch = await this.ports.om.ensureUserBranch(user.id);
    await this.ports.accounts.recordAppIdentity(identity.appId, identity.appUserId, user.id, email);
    const work = await this.ports.works.activeWork(user.id, identity.appId, workType, entityId)
      ?? await this.ports.works.createWork(user.id, identity.appId, workType, entityId);
    const session = await this.ports.works.createOrTouchSession(work.id);
    const ticket = this.ports.system.id("acp");
    const expiresAt = new Date(Date.parse(this.ports.system.now()) + 5 * 60_000).toISOString();
    await this.ports.sessions.put({ ticket, expiresAt, forgeUserId: user.id, workId: work.id, sessionId: session.id, appToken: input.token, reportId: workType === "report-authoring" ? entityId : "", workType, entityId, selection: input.selection });
    const passwordSetupTicket = user.passwordConfigured ? undefined : await this.ports.passwordSetups.issue(user.id, expiresAt);
    return { user, work, session, ticket, expiresAt, activeRevision: await this.ports.om.head(branch.branch), passwordSetupRequired: !user.passwordConfigured, passwordSetupTicket };
  }

  async appSession(ticket: string): Promise<SessionGrant> {
    const session = await this.ports.sessions.get(ticket);
    if (!session || Date.parse(session.expiresAt) < Date.parse(this.ports.system.now())) { await this.ports.evidenceSessions?.clear(ticket); await this.ports.sessions.remove(ticket); throw new Error("AppSessionExpired"); }
    return session;
  }

  async connectAcp(ticket: string): Promise<SessionGrant> {
    const session = await this.appSession(ticket);
    if (!await this.ports.sessions.claim(ticket)) throw new Error("AppSessionAlreadyConnected");
    return session;
  }

  async disconnectAcp(ticket: string): Promise<void> { await this.ports.evidenceSessions?.clear(ticket); await this.ports.sessions.remove(ticket); }

  async attachEvidence(ticket: string, filename: string, mediaType: string, content: Uint8Array) {
    const session = await this.appSession(ticket);
    await this.assertActiveWork(session);
    if (!this.ports.evidenceExtractor || !this.ports.evidenceSessions) throw new Error("EvidenceNotConfigured");
    const extracted = await this.ports.evidenceExtractor.extract(filename, mediaType, content);
    await this.ports.evidenceSessions.put(ticket, extracted);
    return { digest: extracted.digest, filename: extracted.filename, extraction: { characters: extracted.text.length, warnings: extracted.warnings } };
  }

  async importCatalog(ticket: string) {
    const session = await this.appSession(ticket);
    await this.requireAdmin(session.forgeUserId);
    const [catalog, openApi] = await Promise.all([this.ports.certReporter.catalog(session.appToken), this.ports.certReporter.openApi(session.appToken)]);
    const paths = openApi.paths as Record<string, unknown> | undefined;
    if (!paths || !catalog.capabilities.every((capability) => paths[`/airic/v1/${capability.kind === "command" ? "commands" : "queries"}/${capability.id}`])) throw new Error("CatalogOpenApiMismatch");
    await this.ports.catalogs.saveCandidate(catalog, openApi);
    return catalog;
  }

  async acceptCatalog(ticket: string, digest: string) {
    const session = await this.appSession(ticket);
    await this.requireAdmin(session.forgeUserId);
    const candidate = await this.ports.catalogs.candidate("certreporter", digest);
    if (!candidate) throw new Error("CatalogCandidateNotFound");
    await this.ports.catalogs.accept("certreporter", digest, session.forgeUserId);
    return candidate;
  }

  async startTurn(ticket: string, userMessage: string, onText?: (text: string) => void, evidenceDigests: string[] = []) {
    const session = await this.appSession(ticket);
    await this.assertActiveWork(session);
    const workType = session.workType ?? "report-authoring";
    const entityId = session.entityId ?? session.reportId;
    if (this.runningWorks.has(session.workId)) throw new Error("WorkTurnAlreadyRunning");
    this.runningWorks.add(session.workId);
    try {
    const userId = await this.ports.works.userForWork(session.workId);
    if (!userId) throw new Error("WorkNotFound");
    const revision = await this.ports.om.head(`users/${userId}`);
    const [catalog, currentCatalog, definition, context] = await Promise.all([
      this.ports.catalogs.accepted("certreporter"), this.ports.certReporter.catalog(session.appToken), this.ports.om.workDefinition(revision, workType), this.authoritativeContext(session.appToken, workType, entityId, session.selection),
    ]);
    if (!catalog) throw new Error("CapabilityCatalogNotAccepted");
    if (catalog.digest !== currentCatalog.digest) throw new Error("CapabilityCatalogChanged");
    this.assertContextTarget(context, workType, entityId);
    const resource = context.resource as Record<string, unknown>;
    const issues = validateWorkDefinition(definition, new Set(catalog.capabilities.map((capability) => capability.id)), await this.ports.om.knownKnowledge(revision));
    if (issues.length) throw new Error(`InvalidOperatingModel: ${issues.map((issue) => `${issue.path} ${issue.message}`).join("; ")}`);
    const documents = await Promise.all([
      ...definition.documents.filter((document) => document.load === "required").map(async (document) => ({ id: document.id, path: `work-definitions/${definition.id}/${document.path}`, revision, reason: "work-definition" as const, content: await this.ports.om.document(revision, `work-definitions/${definition.id}/${document.path}`) })),
      ...definition.knowledge.bootstrap.map(async (id) => ({ id, path: `subject-knowledge/${id}.md`, revision, reason: "bootstrap" as const, content: await this.ports.om.document(revision, `subject-knowledge/${id}.md`) })),
    ]);
    const turn = await this.ports.works.nextTurn(session.workId, revision, catalog.digest, this.ports.system.digest(context));
    await this.ports.trajectories.append({ id: this.ports.system.id("evt"), workId: session.workId, turnId: turn.id, type: "turn.started", at: turn.startedAt, payload: { omRevision: revision, catalogDigest: catalog.digest, userMessage } });
    await this.ports.trajectories.append({ id: this.ports.system.id("evt"), workId: session.workId, turnId: turn.id, type: "context.assembled", at: this.ports.system.now(), payload: { contextDigest: this.ports.system.digest(context), documents: documents.map(({ content: _, ...provenance }) => provenance) } });
    const priorEvents = await this.ports.trajectories.read(session.workId);
    let unresolvedCommand = this.unresolvedCommands(priorEvents).length > 0;
    const conversation = priorEvents.filter((event) => event.turnId !== turn.id && (event.type === "turn.started" || event.type === "turn.completed"))
      .slice(-12).map((event) => ({ role: event.type === "turn.started" ? "user" as const : "agent" as const, text: String(event.type === "turn.started" ? event.payload.userMessage ?? "" : event.payload.text ?? "") }));
    const allowedPrefix = workType === "report-authoring" ? "report." : "report-type.";
    const tools: WorkAgentTool[] = catalog.capabilities.filter((capability) => capability.id.startsWith(allowedPrefix) && definition.capabilities.allowed.includes(capability.id)).map((capability) => ({
      capability,
      invoke: async (input) => {
        if (capability.id !== "report-type.list-published-standards" && input[workType === "report-authoring" ? "reportId" : "reportTypeId"] !== entityId) throw new Error("CommandTargetMismatch");
        if (capability.kind === "query") return this.ports.certReporter.query(session.appToken, capability.id, input);
        if (unresolvedCommand) throw new Error("UnresolvedCommandBlocksFurtherWrites");
        const expectedRevision = workType === "report-authoring" ? Number(resource.revision) : undefined;
        const expectedContentDigest = workType === "report-type-definition" ? String(resource.contentDigest ?? "") : undefined;
        if (workType === "report-authoring" && (!Number.isInteger(expectedRevision) || input.expectedRevision !== expectedRevision)) throw new Error("ExpectedRevisionMismatch");
        if (workType === "report-type-definition" && (!expectedContentDigest || input.expectedContentDigest !== expectedContentDigest)) throw new Error("ExpectedContentDigestMismatch");
        const actionId = this.ports.system.id("act");
        const commandId = this.ports.system.id("cmd");
        await this.ports.trajectories.append({ id: this.ports.system.id("evt"), workId: session.workId, turnId: turn.id, type: "action", at: this.ports.system.now(), payload: { actionId, commandId, capabilityId: capability.id, status: "pending", entityId, ...(expectedRevision === undefined ? { expectedContentDigest } : { expectedRevision }) } });
        let outcome = await this.ports.certReporter.submitCommand(session.appToken, capability.id, { commandId, actionId, workId: session.workId, expectedDomainRelease: catalog.domainRelease, input });
        if (outcome.status === "unknown") {
          try {
            const receipt = await this.ports.certReporter.receipt(session.appToken, commandId);
            if (receipt?.status === "committed" || receipt?.status === "rejected") outcome = { status: receipt.status, receipt };
          } catch { /* Authority may have been revoked; retain unknown. */ }
        }
        if (outcome.status === "unknown") unresolvedCommand = true;
        await this.ports.trajectories.append({ id: this.ports.system.id("evt"), workId: session.workId, turnId: turn.id, type: "action", at: this.ports.system.now(), payload: { actionId, commandId, capabilityId: capability.id, status: outcome.status, receipt: outcome.receipt, reason: outcome.reason } });
        return { status: outcome.status, commandId, ...(outcome.receipt ? { receipt: outcome.receipt } : {}), ...(outcome.reason ? { reason: outcome.reason } : {}) };
      },
    }));
    try {
      if (evidenceDigests.length > 3 || new Set(evidenceDigests).size !== evidenceDigests.length) throw new Error("InvalidEvidenceSelection");
      const evidence = evidenceDigests.length ? await this.ports.evidenceSessions?.take(ticket, evidenceDigests) : [];
      if (evidenceDigests.length && (!evidence || evidence.length !== evidenceDigests.length)) throw new Error("EvidenceNotAvailable");
      for (const item of evidence ?? []) await this.ports.trajectories.append({ id: this.ports.system.id("evt"), workId: session.workId, turnId: turn.id, type: "message", at: this.ports.system.now(), payload: { evidence: { filename: item.filename, digest: item.digest, characters: item.text.length, warnings: item.warnings } } });
      const available = new Map([
        ...definition.documents.filter((document) => document.load === "on-demand").map((document) => [document.id, `work-definitions/${definition.id}/${document.path}`] as const),
        ...definition.knowledge.available.map((id) => [id, `subject-knowledge/${id}.md`] as const),
      ]);
      const result = await this.ports.agents.runWork({ sessionId: session.sessionId, userMessage, conversation, context, documents: documents.map(({ id, content }) => ({ id, content })), evidence: (evidence ?? []).map(({ filename, digest, text }) => ({ filename, digest, text })), availableDocumentIds: [...available.keys()], loadDocument: async (id) => {
        const path = available.get(id);
        if (!path) throw new Error("DocumentNotAvailable");
        const content = await this.ports.om.document(revision, path);
        await this.ports.trajectories.append({ id: this.ports.system.id("evt"), workId: session.workId, turnId: turn.id, type: "context.document-loaded", at: this.ports.system.now(), payload: { id, path, revision, reason: "on-demand" } });
        return content;
      }, tools, onText });
      await this.ports.works.completeTurn(turn.id, "completed");
      await this.ports.trajectories.append({ id: this.ports.system.id("evt"), workId: session.workId, turnId: turn.id, type: "turn.completed", at: this.ports.system.now(), payload: { text: result.text } });
      return { turn: { ...turn, status: "completed" }, documents: documents.map(({ content: _, ...provenance }) => provenance), reply: result.text };
    } catch (error) {
      await this.ports.works.completeTurn(turn.id, "failed");
      await this.ports.trajectories.append({ id: this.ports.system.id("evt"), workId: session.workId, turnId: turn.id, type: "error", at: this.ports.system.now(), payload: { code: error instanceof Error ? error.message : "AgentRunFailed" } });
      throw error;
    }
    } finally { this.runningWorks.delete(session.workId); }
  }

  async reflectionLenses(actorUserId: string) {
    const user = await this.ports.accounts.userById(actorUserId);
    if (!user) throw new Error("Unauthorized");
    const all = await this.ports.works.lenses();
    return user.role === "admin" ? all : all.filter((lens) => lens.enabled);
  }

  async updateReflectionLens(actorUserId: string, lensId: string, enabled: boolean, prompt: string) {
    await this.requireAdmin(actorUserId);
    if (!lenses.has(lensId)) throw new Error("UnknownReflectionLens");
    if (!prompt.trim()) throw new Error("ReflectionPromptRequired");
    return this.ports.works.updateLens(lensId, enabled, prompt.trim());
  }

  async reflectionsForWork(actorUserId: string, workId: string) {
    const work = await this.ports.works.work(workId);
    if (!work) throw new Error("WorkNotFound");
    await this.authorizedOmOwner(actorUserId, work.ownerUserId);
    return this.ports.works.reflectionsForWork(workId);
  }

  async reflectionDetail(actorUserId: string, reflectionId: string) {
    const reflection = await this.readableReflection(actorUserId, reflectionId);
    const [messages, proposal] = await Promise.all([this.ports.works.reflectionMessages(reflectionId), this.ports.works.proposalForReflection(reflectionId)]);
    return { reflection, messages, proposal };
  }

  async startReflection(actorUserId: string, workId: string, lensId: string, question: string, evidenceEventIds: string[]) {
    const work = await this.ports.works.work(workId);
    if (!work || work.ownerUserId !== actorUserId) throw new Error("WorkNotOwned");
    const lens = await this.ports.works.lens(lensId);
    if (!lens || !lenses.has(lensId)) throw new Error("UnknownReflectionLens");
    if (!lens.enabled) throw new Error("ReflectionLensDisabled");
    if (!question.trim() || question.length > 4000) throw new Error("ReflectionQuestionRequired");
    if (!Array.isArray(evidenceEventIds) || evidenceEventIds.length > 20 || new Set(evidenceEventIds).size !== evidenceEventIds.length) throw new Error("InvalidReflectionEvidence");
    const events = await this.ports.trajectories.read(workId);
    if (evidenceEventIds.some((id) => !events.some((event) => event.id === id))) throw new Error("ReflectionEvidenceMismatch");
    if (JSON.stringify(events.filter((event) => evidenceEventIds.includes(event.id))).length > 100_000) throw new Error("ReflectionEvidenceTooLarge");
    const omRevision = await this.ports.om.head(`users/${actorUserId}`);
    const reflection = await this.ports.works.createReflection({ workId, ownerUserId: actorUserId, lensId, lensVersion: lens.version, lensPrompt: lens.prompt, question: question.trim(), evidenceEventIds, omRevision });
    return this.continueReflection(actorUserId, reflection.id, question);
  }

  async continueReflection(actorUserId: string, reflectionId: string, message: string) {
    const reflection = await this.readableReflection(actorUserId, reflectionId);
    if (reflection.ownerUserId !== actorUserId) throw new Error("ReflectionNotOwned");
    if (!message.trim() || message.length > 4000) throw new Error("ReflectionMessageRequired");
    if (this.runningReflections.has(reflectionId)) throw new Error("ReflectionAlreadyRunning");
    this.runningReflections.add(reflectionId);
    try {
      await this.ports.works.appendReflectionMessage(reflectionId, "user", message.trim());
      const events = await this.ports.trajectories.read(reflection.workId);
      const selected = reflection.evidenceEventIds.map((id) => events.find((event) => event.id === id));
      if (selected.some((event) => !event)) throw new Error("ReflectionEvidenceMismatch");
      if (selected.length === 0) {
        const analysis = "未选择 Work 轨迹证据。请从该 Work 选择事件后重新发起 Reflection；当前分析已保存，未创建 Proposal。";
        await this.ports.works.appendReflectionMessage(reflectionId, "agent", analysis);
        await this.ports.works.setReflectionResult(reflectionId, { status: "insufficient_evidence", outcome: "analysis", analysis, attribution: "无来源事件" });
        return this.reflectionDetail(actorUserId, reflectionId);
      }
      if (!this.ports.reflectionAgent) throw new Error("ReflectionAgentNotConfigured");
      const existing = await this.ports.works.proposalForReflection(reflectionId);
      const sourceWork = await this.ports.works.work(reflection.workId);
      if (!sourceWork) throw new Error("WorkNotFound");
      const files = await this.ports.om.listFiles(reflection.omRevision);
      const relevant = files.filter((path) => path.startsWith(`work-definitions/${sourceWork.workType}/`) || path.startsWith("subject-knowledge/"));
      const documents = await Promise.all(relevant.map(async (path) => ({ path, content: await this.ports.om.document(reflection.omRevision, path) })));
      const lens: ReflectionLens = { id: reflection.lensId as ReflectionLens["id"], version: reflection.lensVersion, enabled: true, prompt: reflection.lensPrompt };
      const result = await this.ports.reflectionAgent.analyze({ reflectionId, lens, question: message.trim(), messages: await this.ports.works.reflectionMessages(reflectionId), evidence: selected as NonNullable<typeof selected[number]>[], omRevision: reflection.omRevision, documents });
      if (!result.analysis.trim() || !Array.isArray(result.citedEventIds) || result.citedEventIds.some((id) => !reflection.evidenceEventIds.includes(id))) throw new Error("ReflectionEvidenceMismatch");
      if (result.outcome !== "analysis" && (!result.attribution.trim() || !result.citedEventIds.length)) throw new Error("ReflectionAttributionRequired");
      if (result.outcome === "proposal") {
        if (lens.id === "api-suggestion" || !result.edits?.length || result.edits.some((edit) => !isAllowedProposalPath(edit.path) || (lens.id === "domain-knowledge" ? !edit.path.startsWith("subject-knowledge/") : !edit.path.startsWith(`work-definitions/${sourceWork.workType}/`)))) throw new Error("InvalidReflectionProposal");
        if (existing?.status === "adopted") throw new Error("ReflectionProposalAlreadyAdopted");
        let proposal = existing;
        if (!proposal) {
          const proposalId = this.ports.system.id("prp");
          const proposalGit = await this.ports.om.createProposal(actorUserId, proposalId, reflection.omRevision);
          proposal = await this.ports.works.createProposal({ id: proposalId, reflectionId, workId: reflection.workId, ownerUserId: actorUserId, baseRevision: reflection.omRevision, branchRef: proposalGit.branch, worktreePath: proposalGit.worktree, status: "open", source: `reflection:${reflectionId}`, reason: result.attribution, evidence: result.citedEventIds.join(",") });
        }
        for (const edit of result.edits) await this.ports.om.writeProposalFile(proposal.worktreePath, edit.path, edit.content);
        if (lens.id === "domain-knowledge") await this.ports.om.makeKnowledgeAvailable(proposal.worktreePath, sourceWork.workType, result.edits.map((edit) => edit.path.split("/").pop()!.replace(/\.md$/, "")));
        await this.ports.works.setProposalReview(proposal.id, undefined);
      }
      if (result.outcome === "api-suggestion" && (lens.id !== "api-suggestion" || !result.suggestionMarkdown?.trim())) throw new Error("InvalidApiSuggestion");
      await this.ports.works.appendReflectionMessage(reflectionId, "agent", result.analysis);
      await this.ports.works.setReflectionResult(reflectionId, { status: "completed", outcome: result.outcome, analysis: result.analysis, attribution: result.attribution, ...(result.outcome === "api-suggestion" ? { suggestionMarkdown: result.suggestionMarkdown } : {}) });
      return this.reflectionDetail(actorUserId, reflectionId);
    } catch (error) {
      await this.ports.works.setReflectionResult(reflectionId, { status: "failed" });
      throw error;
    } finally { this.runningReflections.delete(reflectionId); }
  }

  async reflectionSuggestion(actorUserId: string, reflectionId: string) {
    const reflection = await this.readableReflection(actorUserId, reflectionId);
    if (reflection.outcome !== "api-suggestion" || !reflection.suggestionMarkdown) throw new Error("ApiSuggestionNotFound");
    return reflection.suggestionMarkdown;
  }

  async writeProposal(ticket: string, proposalId: string, path: string, content: string) {
    const session = await this.appSession(ticket); const proposal = await this.ownedProposal(session, proposalId);
    await this.ports.om.writeProposalFile(proposal.worktreePath, path, content);
    await this.ports.works.setProposalReview(proposalId, undefined);
    return { changedPaths: await this.ports.om.proposalChanges(proposal.worktreePath) };
  }

  async adoptProposal(ticket: string, proposalId: string, title: string) {
    const session = await this.appSession(ticket); const proposal = await this.ownedProposal(session, proposalId);
    return this.adoptReviewedProposal(proposal, title, proposal.reviewedRevision);
  }

  async createPersonalProposal(actorUserId: string, source: string, reason: string, evidence: string) {
    if (!source.trim() || !reason.trim()) throw new Error("ProposalSourceAndReasonRequired");
    const user = await this.ports.accounts.userById(actorUserId);
    if (!user) throw new Error("Unauthorized");
    const workspace = await this.ports.om.ensureUserBranch(user.id);
    const baseRevision = await this.ports.om.head(workspace.branch);
    const id = this.ports.system.id("prp");
    const git = await this.ports.om.createProposal(user.id, id, baseRevision);
    return this.ports.works.createProposal({ id, ownerUserId: user.id, baseRevision, branchRef: git.branch, worktreePath: git.worktree, status: "open", source: source.trim(), reason: reason.trim(), evidence: evidence.trim() });
  }

  async personalProposals(actorUserId: string, ownerUserId: string) {
    await this.authorizedOmOwner(actorUserId, ownerUserId);
    return this.ports.works.proposalsForUser(ownerUserId);
  }

  async personalProposal(actorUserId: string, proposalId: string) {
    const proposal = await this.readableProposal(actorUserId, proposalId);
    const activeRevision = await this.ports.om.head(`users/${proposal.ownerUserId}`);
    return { proposal, activeRevision, changedPaths: await this.ports.om.proposalChangedPaths(proposal.worktreePath, proposal.baseRevision), conflicts: await this.ports.om.proposalConflicts(proposal.worktreePath), diff: await this.ports.om.proposalDiff(proposal.worktreePath, proposal.baseRevision) };
  }

  async personalProposalFile(actorUserId: string, proposalId: string, path: string) {
    const proposal = await this.readableProposal(actorUserId, proposalId);
    return { path, content: await this.ports.om.proposalFile(proposal.worktreePath, path) };
  }

  async writePersonalProposal(actorUserId: string, proposalId: string, path: string, content: string) {
    const proposal = await this.editableProposal(actorUserId, proposalId);
    await this.ports.om.writeProposalFile(proposal.worktreePath, path, content);
    await this.ports.works.setProposalReview(proposalId, undefined);
    return this.personalProposal(actorUserId, proposalId);
  }

  async reviewPersonalProposal(actorUserId: string, proposalId: string) {
    const proposal = await this.editableProposal(actorUserId, proposalId);
    if (await this.ports.om.head(`users/${actorUserId}`) !== proposal.baseRevision) throw new Error("ActiveRevisionChanged: rebase required");
    const changedPaths = await this.ports.om.proposalChangedPaths(proposal.worktreePath, proposal.baseRevision);
    if (!changedPaths.length) throw new Error("ProposalHasNoChanges");
    if (changedPaths.some((path) => !isAllowedProposalPath(path))) throw new Error("ProposalPathNotAllowed");
    if ((await this.ports.om.proposalChanges(proposal.worktreePath)).length) await this.ports.om.commitProposal(proposal.worktreePath, "Review AiricForge Proposal");
    const candidate = await this.ports.om.head(proposal.branchRef);
    await this.validateProposalCandidate(candidate);
    await this.ports.works.setProposalReview(proposalId, candidate);
    return { reviewedRevision: candidate, ...(await this.personalProposal(actorUserId, proposalId)) };
  }

  async adoptPersonalProposal(actorUserId: string, proposalId: string, title: string, reviewedRevision: string) {
    const proposal = await this.editableProposal(actorUserId, proposalId);
    return this.adoptReviewedProposal(proposal, title, reviewedRevision);
  }

  async rebasePersonalProposal(actorUserId: string, proposalId: string) {
    const proposal = await this.editableProposal(actorUserId, proposalId);
    const activeRevision = await this.ports.om.head(`users/${actorUserId}`);
    if (activeRevision === proposal.baseRevision) return this.personalProposal(actorUserId, proposalId);
    await this.ports.works.setProposalReview(proposalId, undefined);
    await this.ports.om.rebaseProposal(proposal.worktreePath, proposal.baseRevision, activeRevision);
    await this.ports.works.updateProposalBase(proposalId, activeRevision);
    return this.personalProposal(actorUserId, proposalId);
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
  async worksForUser(actorUserId: string, ownerUserId: string) {
    await this.authorizedOmOwner(actorUserId, ownerUserId);
    return this.ports.works.worksForUser(ownerUserId);
  }
  async workHistory(actorUserId: string, workId: string) {
    const work = await this.ports.works.work(workId);
    if (!work) throw new Error("WorkNotFound");
    await this.authorizedOmOwner(actorUserId, work.ownerUserId);
    const [turns, events] = await Promise.all([this.ports.works.turnsForWork(workId), this.ports.trajectories.read(workId)]);
    return { work, turns, events };
  }
  async personalOm(actorUserId: string, ownerUserId: string, requestedRevision?: string) {
    const owner = await this.authorizedOmOwner(actorUserId, ownerUserId);
    const activeRevision = await this.ports.om.head(owner.activeBranch);
    if (requestedRevision && !await this.ports.om.containsRevision(owner.activeBranch, requestedRevision)) throw new Error("OmRevisionNotReachable");
    const revision = requestedRevision || activeRevision;
    return { owner: { id: owner.id, email: owner.email }, branch: owner.activeBranch, activeRevision, revision, files: await this.ports.om.listFiles(revision) };
  }
  async personalOmHistory(actorUserId: string, ownerUserId: string) {
    const owner = await this.authorizedOmOwner(actorUserId, ownerUserId);
    return this.ports.om.history(owner.activeBranch);
  }
  async personalOmFile(actorUserId: string, ownerUserId: string, path: string, revision?: string) {
    if (!/^(work-definitions\/[a-z0-9-]+\/(?:work\.yml|[a-z0-9-]+\.md)|subject-knowledge\/[a-z0-9-]+\.md)$/.test(path)) throw new Error("InvalidOmPath");
    const snapshot = await this.personalOm(actorUserId, ownerUserId, revision);
    if (!snapshot.files.includes(path)) throw new Error("OmFileNotFound");
    return { path, revision: snapshot.revision, content: await this.ports.om.document(snapshot.revision, path) };
  }
  async trajectory(ticket: string, workId: string) { const session = await this.appSession(ticket); if (session.workId !== workId) throw new Error("WorkNotOwned"); return this.ports.trajectories.read(workId); }
  async recoverCommand(ticket: string, commandId: string) {
    const session = await this.appSession(ticket);
    await this.assertActiveWork(session);
    const events = await this.ports.trajectories.read(session.workId);
    const pending = this.unresolvedCommands(events).find((item) => item.commandId === commandId);
    if (!pending) throw new Error("UnknownCommandNotFound");
    const receipt = await this.ports.certReporter.receipt(session.appToken, commandId);
    if (!receipt || (receipt.status !== "committed" && receipt.status !== "rejected")) return { commandId, status: "unknown" as const };
    await this.ports.trajectories.append({ id: this.ports.system.id("evt"), workId: session.workId, turnId: pending.turnId, type: "action", at: this.ports.system.now(), payload: { commandId, actionId: pending.actionId, capabilityId: pending.capabilityId, status: receipt.status, receipt, recovered: true } });
    return { commandId, status: receipt.status, receipt };
  }
  private unresolvedCommands(events: Awaited<ReturnType<TrajectoryPort["read"]>>) {
    const latest = new Map<string, { commandId: string; actionId: string; capabilityId: string; status: string; turnId?: string }>();
    for (const event of events) {
      if (event.type !== "action" || typeof event.payload.commandId !== "string") continue;
      const { commandId, actionId, capabilityId, status } = event.payload;
      latest.set(commandId, { commandId, actionId: String(actionId ?? ""), capabilityId: String(capabilityId ?? ""), status: String(status ?? "unknown"), turnId: event.turnId });
    }
    return [...latest.values()].filter((item) => item.status === "pending" || item.status === "unknown");
  }
  private async validateProposalCandidate(candidate: string): Promise<void> {
    const catalog = await this.ports.catalogs.accepted("certreporter");
    if (!catalog) throw new Error("CapabilityCatalogNotAccepted");
    const issues = await this.ports.om.knowledgeIssues(candidate);
    if (issues.length) throw new Error(`InvalidOperatingModel: ${issues.map((issue) => `${issue.path} ${issue.message}`).join("; ")}`);
    const knownKnowledge = await this.ports.om.knownKnowledge(candidate);
    const files = await this.ports.om.listFiles(candidate);
    for (const path of files.filter((path) => /^work-definitions\/[a-z0-9-]+\/work\.yml$/.test(path))) {
      const id = path.split("/")[1];
      const definition = await this.ports.om.workDefinition(candidate, id);
      issues.push(...validateWorkDefinition(definition, new Set(catalog.capabilities.map((capability) => capability.id)), knownKnowledge));
      for (const document of definition.documents) {
        try { await this.ports.om.document(candidate, `work-definitions/${id}/${document.path}`); }
        catch { issues.push({ path: `work-definitions/${id}/documents.${document.id}.path`, message: "document does not exist" }); }
      }
    }
    if (issues.length) throw new Error(`InvalidOperatingModel: ${issues.map((issue) => `${issue.path} ${issue.message}`).join("; ")}`);
  }
  private async adoptReviewedProposal(proposal: ProposalRecord, title: string, reviewedRevision?: string) {
    if (!title.trim()) throw new Error("ProposalTitleRequired");
    if (!reviewedRevision || proposal.reviewedRevision !== reviewedRevision) throw new Error("ProposalReviewRequired");
    if (await this.ports.om.head(`users/${proposal.ownerUserId}`) !== proposal.baseRevision) throw new Error("ActiveRevisionChanged: rebase required");
    if (await this.ports.om.head(proposal.branchRef) !== reviewedRevision || (await this.ports.om.proposalChanges(proposal.worktreePath)).length) throw new Error("ProposalChangedAfterReview");
    const changedPaths = await this.ports.om.proposalChangedPaths(proposal.worktreePath, proposal.baseRevision);
    if (!changedPaths.length || changedPaths.some((path) => !isAllowedProposalPath(path))) throw new Error("InvalidProposalChanges");
    await this.validateProposalCandidate(reviewedRevision);
    const userWorkspace = await this.ports.om.ensureUserBranch(proposal.ownerUserId);
    const trailer = (value: string) => value.replace(/\s+/g, " ").trim().slice(0, 500);
    const revision = await this.ports.om.adoptProposal(userWorkspace.branch, userWorkspace.worktree, proposal.branchRef, proposal.baseRevision, {
      "AiricForge-Proposal": proposal.id,
      "AiricForge-Title": trailer(title),
      ...(proposal.reflectionId ? { "AiricForge-Reflection": proposal.reflectionId } : {}),
      "AiricForge-Source": trailer(proposal.source),
      "AiricForge-Reason": trailer(proposal.reason),
      ...(proposal.evidence ? { "AiricForge-Evidence": trailer(proposal.evidence) } : {}),
      "AiricForge-Base": proposal.baseRevision,
    });
    await this.ports.works.adoptProposal(proposal.id);
    return { revision, title: title.trim() };
  }
  private async readableProposal(actorUserId: string, proposalId: string): Promise<ProposalRecord> {
    const proposal = await this.ports.works.proposal(proposalId);
    if (!proposal) throw new Error("ProposalNotFound");
    await this.authorizedOmOwner(actorUserId, proposal.ownerUserId);
    return proposal;
  }
  private async readableReflection(actorUserId: string, reflectionId: string): Promise<ReflectionRecord> {
    const reflection = await this.ports.works.reflection(reflectionId);
    if (!reflection) throw new Error("ReflectionNotFound");
    await this.authorizedOmOwner(actorUserId, reflection.ownerUserId);
    return reflection;
  }
  private async editableProposal(actorUserId: string, proposalId: string): Promise<ProposalRecord> {
    const proposal = await this.readableProposal(actorUserId, proposalId);
    if (proposal.ownerUserId !== actorUserId || proposal.status !== "open") throw new Error("ProposalNotEditable");
    return proposal;
  }
  private async ownedProposal(session: SessionGrant, proposalId: string): Promise<ProposalRecord> { const proposal = await this.ports.works.proposal(proposalId); if (!proposal || proposal.ownerUserId !== session.forgeUserId || proposal.workId !== session.workId || proposal.status !== "open") throw new Error("ProposalNotOwned"); return proposal; }
  private async assertActiveWork(session: SessionGrant): Promise<void> {
    const work = await this.ports.works.activeWork(session.forgeUserId, "certreporter", session.workType ?? "report-authoring", session.entityId ?? session.reportId);
    if (work?.id !== session.workId) throw new Error("WorkCompleted");
  }
  private async authoritativeContext(token: string, workType: string, entityId: string, selection?: Record<string, unknown>) {
    if (workType === "report-type-definition") {
      if (!this.ports.certReporter.reportTypeContext) throw new Error("ReportTypeContextUnavailable");
      return this.ports.certReporter.reportTypeContext(token, entityId, selection);
    }
    return this.ports.certReporter.reportContext(token, entityId, selection);
  }
  private assertContextTarget(context: Record<string, unknown>, workType: string, entityId: string): void {
    const resource = context.resource as Record<string, unknown> | undefined;
    if (workType === "report-type-definition") {
      if (resource?.type !== "report-type" || resource.id !== entityId) throw new Error("InvalidReportTypeContext");
    } else if (resource?.namespace !== "certreporter" || resource.resourceType !== "report" || resource.resourceId !== entityId) throw new Error("InvalidReportContext");
  }
  private async authorizedOmOwner(actorUserId: string, ownerUserId: string) {
    const actor = await this.ports.accounts.userById(actorUserId);
    const owner = await this.ports.accounts.userById(ownerUserId);
    if (!actor || !owner || (actor.id !== owner.id && actor.role !== "admin")) throw new Error("Forbidden");
    return owner;
  }
  private async requireAdmin(userId: string): Promise<void> {
    if ((await this.ports.accounts.userById(userId))?.role !== "admin") throw new Error("Forbidden");
  }
}
