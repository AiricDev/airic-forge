import { isAllowedProposalPath, validateWorkDefinition } from "./operating-model.js";
import type { AccountPort, AgentRunnerPort, AppSessionPort, CatalogPort, CertReporterPort, EvidenceExtractorPort, EvidenceSessionPort, MeasurementPort, OmDraftPort, OperatingModelPort, OrganizationContributionPort, PasswordCodecPort, PasswordSetupPort, ProposalListFilters, ProposalRecord, ReflectionAgentPort, ReflectionLens, ReflectionRecord, SessionGrant, SystemPort, TrajectoryPort, WorkFeedbackKind, WorkListFilters, WorkPort, WorkAgentTool } from "./ports.js";

const lenses = new Set(["domain-knowledge", "delegation-gap", "api-suggestion"]);

export class ForgeUseCases {
  private readonly runningWorks = new Set<string>();
  private readonly runningReflections = new Set<string>();
  constructor(private readonly ports: { accounts: AccountPort; works: WorkPort; om: OperatingModelPort; omDrafts?: OmDraftPort; organization?: OrganizationContributionPort; measurements?: MeasurementPort; certReporter: CertReporterPort; catalogs: CatalogPort; agents: AgentRunnerPort; reflectionAgent?: ReflectionAgentPort; sessions: AppSessionPort; evidenceExtractor?: EvidenceExtractorPort; evidenceSessions?: EvidenceSessionPort; passwordSetups: PasswordSetupPort; passwordCodec: PasswordCodecPort; trajectories: TrajectoryPort; system: SystemPort; initialAdminEmails: Set<string>; }) {}

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

  async catalogOverview(actorUserId: string) {
    await this.requireAdmin(actorUserId);
    const [accepted, candidates] = await Promise.all([this.ports.catalogs.accepted("certreporter"), this.ports.catalogs.candidates("certreporter")]);
    return { accepted: accepted ?? null, candidates: candidates.filter((candidate) => candidate.digest !== accepted?.digest) };
  }

  async acceptCatalogFromWorkspace(actorUserId: string, digest: string) {
    await this.requireAdmin(actorUserId);
    const candidate = await this.ports.catalogs.candidate("certreporter", digest);
    if (!candidate) throw new Error("CatalogCandidateNotFound");
    await this.ports.catalogs.accept("certreporter", digest, actorUserId);
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

  async openWorkReflection(actorUserId: string, workId: string) {
    const work = await this.ports.works.work(workId);
    if (!work || work.ownerUserId !== actorUserId) throw new Error("WorkNotOwned");
    const existing = (await this.ports.works.reflectionsForWork(workId)).at(-1);
    if (existing) return this.reflectionDetail(actorUserId, existing.id);
    const omRevision = await this.ports.om.head(`users/${actorUserId}`);
    const reflection = await this.ports.works.openReflection({ workId, ownerUserId: actorUserId, lensId: "conversation", lensVersion: 0, lensPrompt: "", question: "", evidenceEventIds: [], omRevision }, `我们可以回顾这个 Work（${work.id}）。我可以按需读取它的轨迹；你可以直接提问，或使用 lens 命令分析可改进之处。`);
    return this.reflectionDetail(actorUserId, reflection.id);
  }

  async startReflectionConversation(actorUserId: string, workId: string, message: string) {
    const work = await this.ports.works.work(workId);
    if (!work || work.ownerUserId !== actorUserId) throw new Error("WorkNotOwned");
    if (!message.trim() || message.length > 4000) throw new Error("ReflectionMessageRequired");
    await this.reflectionCommand(message);
    const detail = await this.openWorkReflection(actorUserId, workId);
    return this.continueReflection(actorUserId, detail.reflection.id, message);
  }

  private async reflectionCommand(message: string): Promise<ReflectionLens | undefined> {
    const command = /^\/([^\s]+)(?:\s|$)/.exec(message.trim());
    if (!command) return undefined;
    const lensId = command[1] === "lens" ? message.trim().split(/\s+/)[1] : command[1];
    if (!lensId || !lenses.has(lensId)) throw new Error("UnknownReflectionLens");
    const lens = await this.ports.works.lens(lensId);
    if (!lens) throw new Error("UnknownReflectionLens");
    if (!lens.enabled) throw new Error("ReflectionLensDisabled");
    return lens;
  }

  async continueReflection(actorUserId: string, reflectionId: string, message: string) {
    const reflection = await this.readableReflection(actorUserId, reflectionId);
    if (reflection.ownerUserId !== actorUserId) throw new Error("ReflectionNotOwned");
    if (reflection.status === "abandoned" || reflection.status === "completed") throw new Error("ReflectionClosed");
    if (!message.trim() || message.length > 4000) throw new Error("ReflectionMessageRequired");
    const conversational = reflection.lensId === "conversation" || (await this.ports.works.reflectionMessages(reflectionId)).some((item) => item.role === "user" && /^\/(?:lens\s+)?(?:domain-knowledge|delegation-gap|api-suggestion)(?:\s|$)/.test(item.content));
    const invokedLens = conversational ? await this.reflectionCommand(message) : undefined;
    if (this.runningReflections.has(reflectionId)) throw new Error("ReflectionAlreadyRunning");
    this.runningReflections.add(reflectionId);
    try {
      await this.ports.works.appendReflectionMessage(reflectionId, "user", message.trim());
      const events = await this.ports.trajectories.read(reflection.workId);
      const selected = conversational ? [] : reflection.evidenceEventIds.map((id) => events.find((event) => event.id === id));
      if (selected.some((event) => !event)) throw new Error("ReflectionEvidenceMismatch");
      if (!conversational && selected.length === 0) {
        const analysis = "未选择 Work 轨迹证据。请从该 Work 选择事件后重新发起 Reflection；当前分析已保存，未创建 Proposal。";
        await this.ports.works.appendReflectionMessage(reflectionId, "agent", analysis);
        await this.ports.works.setReflectionResult(reflectionId, { status: "insufficient_evidence", outcome: "analysis", analysis, attribution: "无来源事件" });
        return this.reflectionDetail(actorUserId, reflectionId);
      }
      if (!this.ports.reflectionAgent) throw new Error("ReflectionAgentNotConfigured");
      let proposal = await this.ports.works.proposalForReflection(reflectionId);
      const sourceWork = await this.ports.works.work(reflection.workId);
      if (!sourceWork) throw new Error("WorkNotFound");
      const files = await this.ports.om.listFiles(reflection.omRevision);
      const relevant = files.filter((path) => path.startsWith(`work-definitions/${sourceWork.workType}/`) || path.startsWith("subject-knowledge/"));
      const documents = await Promise.all(relevant.map(async (path) => ({ path, content: await this.ports.om.document(reflection.omRevision, path) })));
      const lens: ReflectionLens = conversational ? invokedLens ?? { id: "conversation", version: 0, enabled: true, prompt: "Discuss the user's Work and answer without proposing an OM change unless a lens command is invoked." } : { id: reflection.lensId as ReflectionLens["id"], version: reflection.lensVersion, enabled: true, prompt: reflection.lensPrompt };
      const disclosed = new Set((selected as NonNullable<typeof selected[number]>[]).map((event) => event.id));
      const readTrajectory = async (offset: number, limit: number) => {
        if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 20) throw new Error("InvalidTrajectoryPage");
        const page = events.slice(offset, offset + limit);
        if (JSON.stringify(page).length > 100_000) throw new Error("ReflectionEvidenceTooLarge");
        for (const event of page) disclosed.add(event.id);
        return page;
      };
      const allowedPath = (path: string) => isAllowedProposalPath(path) && (lens.id === "domain-knowledge" ? path.startsWith("subject-knowledge/") : lens.id === "delegation-gap" && path.startsWith(`work-definitions/${sourceWork.workType}/`));
      const readProposalFile = async (path: string) => {
        if (!allowedPath(path)) throw new Error("InvalidReflectionProposal");
        return proposal ? this.ports.om.proposalFile(proposal.worktreePath, path) : this.ports.om.document(reflection.omRevision, path);
      };
      const writeProposalFile = async (path: string, content: string, citedEventIds: string[], proposalMessage: string) => {
        if (!allowedPath(path) || !content.trim() || content.length > 100_000 || !proposalMessage.trim() || proposalMessage.length > 1000) throw new Error("InvalidReflectionProposal");
        if (!Array.isArray(citedEventIds) || !citedEventIds.length || citedEventIds.some((id) => !disclosed.has(id))) throw new Error("ReflectionEvidenceMismatch");
        if (proposal?.status === "adopted") throw new Error("ReflectionProposalAlreadyAdopted");
        if (!proposal) {
          const proposalId = this.ports.system.id("prp");
          const proposalGit = await this.ports.om.createProposal(actorUserId, proposalId, reflection.omRevision);
          proposal = await this.ports.works.createProposal({ id: proposalId, reflectionId, workId: reflection.workId, ownerUserId: actorUserId, baseRevision: reflection.omRevision, branchRef: proposalGit.branch, worktreePath: proposalGit.worktree, status: "open", source: `reflection:${reflectionId}`, reason: proposalMessage.trim(), evidence: citedEventIds.join(",") });
        }
        await this.ports.om.writeProposalFile(proposal.worktreePath, path, content);
        if (lens.id === "domain-knowledge") await this.ports.om.makeKnowledgeAvailable(proposal.worktreePath, sourceWork.workType, [path.split("/").pop()!.replace(/\.md$/, "")]);
        await this.ports.works.setProposalMessage(proposal.id, proposalMessage.trim(), citedEventIds.join(","));
        proposal = { ...proposal, reason: proposalMessage.trim(), evidence: citedEventIds.join(",") };
        await this.ports.works.setProposalReview(proposal.id, undefined);
      };
      const privateDrafts = this.ports.omDrafts && ["domain-knowledge", "delegation-gap"].includes(lens.id)
        ? (await this.ports.omDrafts.draftsForUser(actorUserId)).filter((draft) => draft.baseRevision === reflection.omRevision && allowedPath(draft.path)).map(({ path, content, baseRevision }) => ({ path, content, baseRevision }))
        : [];
      const result = await this.ports.reflectionAgent.analyze({ reflectionId, lens, question: message.trim(), messages: await this.ports.works.reflectionMessages(reflectionId), evidence: selected as NonNullable<typeof selected[number]>[], ...(conversational ? { readTrajectory } : {}), ...(["domain-knowledge", "delegation-gap"].includes(lens.id) ? { readProposalFile, writeProposalFile } : {}), omRevision: reflection.omRevision, documents, privateDrafts });
      if (!result.analysis.trim() || !Array.isArray(result.citedEventIds) || result.citedEventIds.some((id) => !disclosed.has(id))) throw new Error("ReflectionEvidenceMismatch");
      if (lens.id === "conversation" && result.outcome !== "analysis") throw new Error("ReflectionLensRequired");
      if (result.outcome !== "analysis" && (!result.attribution.trim() || !result.citedEventIds.length)) throw new Error("ReflectionAttributionRequired");
      if (result.outcome === "proposal") {
        if (lens.id === "api-suggestion" || (result.edits?.length && result.edits.some((edit) => !allowedPath(edit.path))) || (!result.edits?.length && !proposal)) throw new Error("InvalidReflectionProposal");
        for (const edit of result.edits ?? []) await writeProposalFile(edit.path, edit.content, result.citedEventIds, result.proposalMessage?.trim() || result.attribution);
        if (!proposal) throw new Error("InvalidReflectionProposal");
        const unifiedMessage = result.proposalMessage?.trim() || proposal.reason || result.attribution;
        if (unifiedMessage !== proposal.reason || result.citedEventIds.join(",") !== proposal.evidence) {
          await this.ports.works.setProposalMessage(proposal.id, unifiedMessage, result.citedEventIds.join(","));
          await this.ports.works.setProposalReview(proposal.id, undefined);
        }
      }
      if (result.outcome === "api-suggestion" && (lens.id !== "api-suggestion" || !result.suggestionMarkdown?.trim())) throw new Error("InvalidApiSuggestion");
      await this.ports.works.appendReflectionMessage(reflectionId, "agent", result.analysis, { lensId: lens.id, lensVersion: lens.version, citedEventIds: result.citedEventIds });
      if (conversational && invokedLens) await this.ports.works.setReflectionContext(reflectionId, invokedLens, result.citedEventIds);
      await this.ports.works.setReflectionResult(reflectionId, { status: conversational ? "active" : "completed", outcome: result.outcome, analysis: result.analysis, attribution: result.attribution, ...(result.outcome === "api-suggestion" ? { suggestionMarkdown: result.suggestionMarkdown } : {}) });
      return this.reflectionDetail(actorUserId, reflectionId);
    } catch (error) {
      await this.ports.works.setReflectionResult(reflectionId, { status: "failed" });
      throw error;
    } finally { this.runningReflections.delete(reflectionId); }
  }

  async reflectionSuggestion(actorUserId: string, reflectionId: string) {
    const reflection = await this.readableReflection(actorUserId, reflectionId);
    if (!reflection.suggestionMarkdown) throw new Error("ApiSuggestionNotFound");
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

  async organizationOm(actorUserId: string, requestedRevision?: string) {
    if (!await this.ports.accounts.userById(actorUserId)) throw new Error("Unauthorized");
    const activeRevision = await this.ports.om.head("main");
    if (requestedRevision && !await this.ports.om.containsRevision("main", requestedRevision)) throw new Error("OmRevisionNotReachable");
    const revision = requestedRevision || activeRevision;
    const actor = await this.ports.accounts.userById(actorUserId);
    let syncAvailable = false;
    if (actor) {
      try { syncAvailable = !await this.ports.om.includesRevision(actor.activeBranch, activeRevision); }
      catch { syncAvailable = false; }
    }
    return { branch: "main", activeRevision, revision, files: await this.ports.om.listFiles(revision), syncAvailable };
  }

  async organizationOmHistory(actorUserId: string) {
    if (!await this.ports.accounts.userById(actorUserId)) throw new Error("Unauthorized");
    return this.ports.om.history("main");
  }

  async organizationOmFile(actorUserId: string, path: string, revision?: string) {
    if (!isAllowedProposalPath(path)) throw new Error("InvalidOmPath");
    const snapshot = await this.organizationOm(actorUserId, revision);
    if (!snapshot.files.includes(path)) throw new Error("OmFileNotFound");
    return { path, revision: snapshot.revision, content: await this.ports.om.document(snapshot.revision, path) };
  }

  async organizationOmManifest(actorUserId: string, path: string, revision?: string) {
    const snapshot = await this.organizationOm(actorUserId, revision);
    return this.omManifest(snapshot, path);
  }

  async addWorkFeedback(actorUserId: string, workId: string, kind: WorkFeedbackKind, note: string) {
    const work = await this.ports.works.work(workId);
    if (!work) throw new Error("WorkNotFound");
    if (work.ownerUserId !== actorUserId) throw new Error("Forbidden");
    if (!["required-human-decision", "avoidable-correction", "knowledge-helpful", "work-outcome-correct", "work-outcome-incorrect"].includes(kind) || !note.trim()) throw new Error("InvalidWorkFeedback");
    const feedback = { id: this.ports.system.id("fbk"), workId, ownerUserId: actorUserId, kind, note: note.trim(), at: this.ports.system.now() };
    await this.measurementPort().recordFeedback(feedback);
    return feedback;
  }

  async workFeedback(actorUserId: string, workId: string) {
    const work = await this.ports.works.work(workId);
    if (!work) throw new Error("WorkNotFound");
    await this.authorizedOmOwner(actorUserId, work.ownerUserId);
    return this.measurementPort().feedbackForWork(workId);
  }

  async measurementBaseline(actorUserId: string) {
    await this.requireAdmin(actorUserId);
    const [activity, feedback] = await Promise.all([this.measurementPort().activityCounts(), this.measurementPort().feedbackCounts()]);
    return { activity, feedback, interpretation: "活动数量不能证明能力改善。反馈来自用户自报；制定目标前需要按工作类型、任务难度、能力目录和模型配置选取可比样本。" };
  }

  async compareOrganizationSource(actorUserId: string, authorUserId: string) {
    await this.requireAdmin(actorUserId);
    const author = await this.ports.accounts.userById(authorUserId);
    if (!author) throw new Error("UserNotFound");
    const sourceRevision = await this.ports.om.head(author.activeBranch);
    const mainRevision = await this.ports.om.head("main");
    return { author: { id: author.id, email: author.email }, sourceRevision, mainRevision, ...await this.ports.om.divergence(sourceRevision, mainRevision) };
  }

  async createOrganizationContribution(actorUserId: string, authorUserId: string, reason: string, evidence: string) {
    await this.requireAdmin(actorUserId);
    if (!reason.trim()) throw new Error("ContributionReasonRequired");
    const comparison = await this.compareOrganizationSource(actorUserId, authorUserId);
    if (!comparison.changedPaths.length) throw new Error("NoOrganizationChanges");
    const organization = this.organizationPort();
    const record = { id: this.ports.system.id("con"), authorUserId, sourceRevision: comparison.sourceRevision, baseMainRevision: comparison.mainRevision, reason: reason.trim(), evidence: evidence.trim(), status: "open" as const, selectedPaths: [], createdAt: this.ports.system.now() };
    await this.ports.om.pinContributionSource(record.id, record.sourceRevision);
    await organization.createContribution(record);
    return record;
  }

  async organizationContributions(actorUserId: string) {
    await this.requireAdmin(actorUserId);
    const records = await this.organizationPort().contributions();
    return Promise.all(records.map(async (record) => ({ ...record, authorEmail: (await this.ports.accounts.userById(record.authorUserId))?.email ?? record.authorUserId })));
  }

  async organizationContribution(actorUserId: string, id: string) {
    await this.requireAdmin(actorUserId);
    const record = await this.organizationPort().contribution(id);
    if (!record) throw new Error("ContributionNotFound");
    const comparison = await this.ports.om.divergence(record.sourceRevision, await this.ports.om.head("main"));
    const candidateDiff = record.candidateWorktree ? await this.ports.om.proposalDiff(record.candidateWorktree, record.baseMainRevision) : undefined;
    return { record, authorEmail: (await this.ports.accounts.userById(record.authorUserId))?.email ?? record.authorUserId, ...comparison, candidateDiff };
  }

  async reviewOrganizationContribution(actorUserId: string, id: string, selectedPaths: string[]) {
    await this.requireAdmin(actorUserId);
    const organization = this.organizationPort();
    const record = await organization.contribution(id);
    if (!record || record.status === "accepted") throw new Error("ContributionNotOpen");
    const mainRevision = await this.ports.om.head("main");
    if (record.status === "reviewed" || record.baseMainRevision !== mainRevision) throw new Error("OrganizationReviewStale: create a new contribution");
    const comparison = await this.ports.om.divergence(record.sourceRevision, mainRevision);
    if (!selectedPaths.length || new Set(selectedPaths).size !== selectedPaths.length || selectedPaths.some((path) => !isAllowedProposalPath(path) || !comparison.changedPaths.includes(path))) throw new Error("InvalidContributionSelection");
    const trailer = (value: string) => value.replace(/\s+/g, " ").trim().slice(0, 500);
    const message = ["Accept selected organization OM contribution", "", `AiricForge-Contribution: ${record.id}`, `AiricForge-Author: ${record.authorUserId}`, `AiricForge-Source-Revision: ${record.sourceRevision}`, `AiricForge-Reason: ${trailer(record.reason)}`, `AiricForge-Base: ${mainRevision}`].join("\n");
    const candidate = await this.ports.om.prepareContribution(id, record.sourceRevision, comparison.baseRevision, mainRevision, selectedPaths, message);
    await this.validateProposalCandidate(candidate.revision);
    await organization.reviewContribution(id, selectedPaths, candidate.branch, candidate.worktree, candidate.revision, mainRevision);
    return { ...record, status: "reviewed" as const, selectedPaths, candidateBranch: candidate.branch, reviewedRevision: candidate.revision };
  }

  async acceptOrganizationContribution(actorUserId: string, id: string, reviewedRevision: string) {
    await this.requireAdmin(actorUserId);
    const organization = this.organizationPort();
    const record = await organization.contribution(id);
    if (!record || !record.candidateBranch || record.reviewedRevision !== reviewedRevision) throw new Error("ContributionReviewRequired");
    if (record.status === "accepted" && record.acceptedRevision === reviewedRevision) return { revision: reviewedRevision };
    if (record.status !== "reviewed") throw new Error("ContributionReviewRequired");
    const activeMain = await this.ports.om.head("main");
    if (activeMain === reviewedRevision) {
      await organization.acceptContribution(id, reviewedRevision);
      return { revision: reviewedRevision };
    }
    if (activeMain !== record.baseMainRevision) throw new Error("OrganizationReviewStale");
    if (await this.ports.om.head(record.candidateBranch) !== reviewedRevision || (await this.ports.om.proposalChanges(record.candidateWorktree!)).length) throw new Error("ContributionChangedAfterReview");
    await this.validateProposalCandidate(reviewedRevision);
    const revision = await this.ports.om.acceptContribution(record.candidateBranch, record.baseMainRevision);
    await organization.acceptContribution(id, revision);
    return { revision };
  }

  async createOrganizationSync(actorUserId: string) {
    const user = await this.ports.accounts.userById(actorUserId);
    if (!user) throw new Error("Unauthorized");
    const workspace = await this.ports.om.ensureUserBranch(user.id);
    const baseRevision = await this.ports.om.head(workspace.branch);
    const upstreamRevision = await this.ports.om.head("main");
    if (baseRevision === upstreamRevision || await this.ports.om.includesRevision(workspace.branch, upstreamRevision)) throw new Error("OrganizationAlreadyCurrent");
    const id = this.ports.system.id("prp");
    const git = await this.ports.om.createProposal(user.id, id, baseRevision);
    const proposal = await this.ports.works.createProposal({ id, ownerUserId: user.id, baseRevision, branchRef: git.branch, worktreePath: git.worktree, status: "open", source: "organization-sync", reason: "Synchronize organization OM", evidence: "", upstreamRevision });
    try { await this.ports.om.synchronizeProposal(git.worktree, baseRevision, upstreamRevision); }
    catch (error) { if (!(error instanceof Error && error.message.startsWith("ProposalRebaseConflict"))) throw error; }
    return this.personalProposal(actorUserId, proposal.id);
  }

  async personalProposals(actorUserId: string, ownerUserId: string) {
    await this.authorizedOmOwner(actorUserId, ownerUserId);
    return this.ports.works.proposalsForUser(ownerUserId);
  }

  async listProposals(actorUserId: string, filters: ProposalListFilters, page = 1) {
    if (!Number.isSafeInteger(page) || page < 1 || page > 100_000) throw new Error("InvalidProposalPage");
    if (filters.status && !["open", "adopted", "abandoned"].includes(filters.status)) throw new Error("InvalidProposalFilter");
    if (filters.source && !["personal", "reflection", "organization-sync"].includes(filters.source)) throw new Error("InvalidProposalFilter");
    if (filters.ownerUserId) await this.authorizedOmOwner(actorUserId, filters.ownerUserId);
    else await this.requireAdmin(actorUserId);
    const pageSize = 20;
    const { proposals, total } = await this.ports.works.proposalsPage(filters, (page - 1) * pageSize, pageSize);
    return { proposals, page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
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
    if (proposal.upstreamRevision && await this.ports.om.head("main") !== proposal.upstreamRevision) throw new Error("OrganizationRevisionChanged: restart synchronization");
    if ((await this.ports.om.proposalConflicts(proposal.worktreePath)).length) throw new Error("ProposalRebaseConflict");
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

  async abandonPersonalProposal(actorUserId: string, proposalId: string) {
    const proposal = await this.editableProposal(actorUserId, proposalId);
    if (!proposal.reflectionId) throw new Error("OnlyReflectionProposalCanBeAbandoned");
    await this.ports.works.abandonReflectionProposal(proposal.id, proposal.reflectionId, "Proposal 已放弃，未创建 OM commit。Reflection 对话保留为历史记录。");
    return this.personalProposal(actorUserId, proposalId);
  }

  async rebasePersonalProposal(actorUserId: string, proposalId: string) {
    const proposal = await this.editableProposal(actorUserId, proposalId);
    const activeRevision = await this.ports.om.head(`users/${actorUserId}`);
    if (proposal.upstreamRevision) {
      if (await this.ports.om.head("main") !== proposal.upstreamRevision || activeRevision !== proposal.baseRevision) throw new Error("OrganizationRevisionChanged: restart synchronization");
      await this.ports.works.setProposalReview(proposalId, undefined);
      await this.ports.om.synchronizeProposal(proposal.worktreePath, proposal.baseRevision, proposal.upstreamRevision);
      return this.personalProposal(actorUserId, proposalId);
    }
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
  async worksForUser(actorUserId: string, ownerUserId: string, page = 1) {
    return this.listWorks(actorUserId, { ownerUserId }, page);
  }
  async listWorks(actorUserId: string, filters: WorkListFilters, page = 1) {
    if (!Number.isSafeInteger(page) || page < 1 || page > 100_000) throw new Error("InvalidWorkPage");
    if (filters.workType && !["report-authoring", "report-type-definition"].includes(filters.workType)) throw new Error("InvalidWorkFilter");
    if (filters.status && !["active", "completed"].includes(filters.status)) throw new Error("InvalidWorkFilter");
    if (filters.ownerUserId) await this.authorizedOmOwner(actorUserId, filters.ownerUserId);
    else await this.requireAdmin(actorUserId);
    const pageSize = 20;
    const { works, total } = await this.ports.works.worksPage(filters, (page - 1) * pageSize, pageSize);
    return { works, page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
  }
  async workHistory(actorUserId: string, workId: string) {
    const work = await this.ports.works.work(workId);
    if (!work) throw new Error("WorkNotFound");
    await this.authorizedOmOwner(actorUserId, work.ownerUserId);
    const [turns, events] = await Promise.all([this.ports.works.turnsForWork(workId), this.ports.trajectories.read(workId)]);
    return { work, turns, events };
  }
  async workProposals(actorUserId: string, workId: string) {
    const work = await this.ports.works.work(workId);
    if (!work) throw new Error("WorkNotFound");
    await this.authorizedOmOwner(actorUserId, work.ownerUserId);
    return this.ports.works.proposalsForWork(workId);
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

  async personalOmManifest(actorUserId: string, ownerUserId: string, path: string, revision?: string) {
    const snapshot = await this.personalOm(actorUserId, ownerUserId, revision);
    return this.omManifest(snapshot, path);
  }

  async personalOmDrafts(actorUserId: string, ownerUserId: string) {
    if (actorUserId !== ownerUserId) throw new Error("Forbidden");
    await this.personalOm(actorUserId, ownerUserId);
    if (!this.ports.omDrafts) throw new Error("OmDraftsUnavailable");
    return this.ports.omDrafts.draftsForUser(ownerUserId);
  }

  async savePersonalOmDraft(actorUserId: string, ownerUserId: string, path: string, content: string, baseRevision: string) {
    if (actorUserId !== ownerUserId) throw new Error("Forbidden");
    if (!isAllowedProposalPath(path) || typeof content !== "string" || content.length > 100_000 || !content.trim()) throw new Error("InvalidOmDraft");
    const snapshot = await this.personalOm(actorUserId, ownerUserId);
    if (snapshot.activeRevision !== baseRevision) throw new Error("OmDraftBaseChanged");
    if (!snapshot.files.includes(path)) throw new Error("OmFileNotFound");
    if (!this.ports.omDrafts) throw new Error("OmDraftsUnavailable");
    const draft = { ownerUserId, path, content, baseRevision, updatedAt: this.ports.system.now() };
    await this.ports.omDrafts.saveDraft(draft);
    return draft;
  }

  async discardPersonalOmDraft(actorUserId: string, ownerUserId: string, path: string) {
    if (actorUserId !== ownerUserId) throw new Error("Forbidden");
    await this.personalOm(actorUserId, ownerUserId);
    if (!isAllowedProposalPath(path)) throw new Error("InvalidOmPath");
    if (!this.ports.omDrafts) throw new Error("OmDraftsUnavailable");
    await this.ports.omDrafts.discardDraft(ownerUserId, path);
  }

  private async omManifest(snapshot: { revision: string; files: string[] }, path: string) {
    const match = /^work-definitions\/([a-z0-9-]+)\/work\.yml$/.exec(path);
    if (!match || !snapshot.files.includes(path)) throw new Error("OmManifestNotFound");
    return { path, revision: snapshot.revision, definition: await this.ports.om.workDefinition(snapshot.revision, match[1]) };
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
    const commitTitle = proposal.reflectionId ? proposal.reason.replace(/\s+/g, " ").trim().slice(0, 160) : title.trim();
    if (!commitTitle) throw new Error("ProposalTitleRequired");
    if (!reviewedRevision || proposal.reviewedRevision !== reviewedRevision) throw new Error("ProposalReviewRequired");
    if (await this.ports.om.head(`users/${proposal.ownerUserId}`) !== proposal.baseRevision) throw new Error("ActiveRevisionChanged: rebase required");
    if (await this.ports.om.head(proposal.branchRef) !== reviewedRevision || (await this.ports.om.proposalChanges(proposal.worktreePath)).length) throw new Error("ProposalChangedAfterReview");
    const changedPaths = await this.ports.om.proposalChangedPaths(proposal.worktreePath, proposal.baseRevision);
    if (!changedPaths.length || changedPaths.some((path) => !isAllowedProposalPath(path))) throw new Error("InvalidProposalChanges");
    await this.validateProposalCandidate(reviewedRevision);
    const userWorkspace = await this.ports.om.ensureUserBranch(proposal.ownerUserId);
    const trailer = (value: string) => value.replace(/\s+/g, " ").trim().slice(0, 500);
    const trailers = {
      "AiricForge-Proposal": proposal.id,
      "AiricForge-Title": trailer(commitTitle),
      ...(proposal.reflectionId ? { "AiricForge-Reflection": proposal.reflectionId } : {}),
      "AiricForge-Source": trailer(proposal.source),
      "AiricForge-Reason": trailer(proposal.reason),
      ...(proposal.evidence ? { "AiricForge-Evidence": trailer(proposal.evidence) } : {}),
      "AiricForge-Base": proposal.baseRevision,
    };
    const revision = proposal.upstreamRevision
      ? await this.ports.om.adoptSynchronizedProposal(userWorkspace.branch, userWorkspace.worktree, proposal.branchRef, proposal.baseRevision, proposal.upstreamRevision, trailers)
      : await this.ports.om.adoptProposal(userWorkspace.branch, userWorkspace.worktree, proposal.branchRef, proposal.baseRevision, trailers);
    await this.ports.works.adoptProposal(proposal.id);
    return { revision, title: commitTitle };
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
  private organizationPort(): OrganizationContributionPort {
    if (!this.ports.organization) throw new Error("OrganizationNotConfigured");
    return this.ports.organization;
  }
  private measurementPort(): MeasurementPort {
    if (!this.ports.measurements) throw new Error("MeasurementsNotConfigured");
    return this.ports.measurements;
  }
}
