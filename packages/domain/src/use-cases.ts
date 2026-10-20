import { isAllowedOmDocumentPath, isAllowedProposalPath, validateWorkDefinition } from "./operating-model.js";
import { materialObservation } from "./materials.js";
import { assembleWorkMemory, pinnedWorkFacts, conversationMessages, CONTEXT_POLICY_VERSION, type WorkContextPorts } from "./work-context.js";
import type { AccountPort, AgentRunnerPort, AppSessionPort, AppPort, AppCommandLocator, CatalogPort, EvidenceExtractorPort, EvidenceSessionPort, MeasurementPort, OmDraftPort, OperatingModelPort, OrganizationContributionPort, PasswordCodecPort, PasswordSetupPort, ReflectionAgentPort, ReflectionRunStore, ReflectionLens, ReflectionRecord, SessionGrant, SystemPort, TrajectoryPort, WorkFeedbackKind, WorkListFilters, WorkPort, WorkAgentTool, WorkActivity } from "./ports.js";

import { PersonalOmChanges } from "./om-changes.js";
import { ReflectionRuns, type ReflectionExecution } from "./reflection-runs.js";

const lenses = new Set(["domain-knowledge", "delegation-gap", "api-suggestion"]);
import { workProgress, validateCheckpoint, type WorkCheckpoint, type CheckpointFeedback } from "./work-progress.js";

type ReflectionPreparation = { reflection: ReflectionRecord; conversational: boolean; invokedLens?: ReflectionLens };

export class ForgeUseCases {
  private readonly feedbackWorks = new Set<string>();
  private readonly runningWorks = new Set<string>();
  private readonly workRuns = new Map<string, { controller: AbortController; done: Promise<void>; finish: () => void }>();
  private readonly runningReflections = new Set<string>();
  readonly reflectionRuns?: ReflectionRuns;
  readonly omChanges?: PersonalOmChanges;
  constructor(private readonly ports: { accounts: AccountPort; works: WorkPort; om: OperatingModelPort; omChanges?: PersonalOmChanges; reportWorkDefinitionId?: string; omDrafts?: OmDraftPort; organization?: OrganizationContributionPort; measurements?: MeasurementPort; app: AppPort; organizationId?: string; catalogs: CatalogPort; agents: AgentRunnerPort; reflectionAgent?: ReflectionAgentPort; reflectionRunStore?: ReflectionRunStore; sessions: AppSessionPort; evidenceExtractor?: EvidenceExtractorPort; evidenceSessions?: EvidenceSessionPort; passwordSetups: PasswordSetupPort; passwordCodec: PasswordCodecPort; trajectories: TrajectoryPort; system: SystemPort; initialAdminEmails: Set<string>; workContext?: WorkContextPorts; }) {
    this.omChanges = ports.omChanges;
    if (ports.reflectionRunStore) this.reflectionRuns = new ReflectionRuns(ports.reflectionRunStore, ports.system);
  }

  private workDefinitionId(workType: string): string {
    return workType === "report-authoring" ? this.ports.reportWorkDefinitionId ?? workType : workType;
  }

  async bootstrap(input: { token: string; reportId?: string; entityId?: string; workType?: "report-authoring" | "report-type-definition"; selection?: Record<string, unknown>; workId?: string }) {
    const workType = input.workType ?? "report-authoring";
    const entityId = input.entityId ?? input.reportId;
    if (!entityId || workType !== "report-authoring") throw new Error("UnsupportedAppContext");
    const identity = await this.ports.app.identity(input.token);
    if (identity.appId !== "certlab" || (this.ports.organizationId && identity.organizationId !== this.ports.organizationId)) throw new Error("AppOrganizationBindingMismatch");
    const email = identity.email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("AppIdentityEmailRequired");
    const context = await this.authoritativeContext(input.token, workType, entityId, input.selection);
    this.assertContextTarget(context, workType, entityId);
    const existing = input.workId ? await this.ports.works.work(input.workId) : undefined;
    if (input.workId && (!existing || existing.appId !== identity.appId || existing.entityId !== entityId || existing.workType !== workType || existing.appUserId !== identity.appUserId || existing.status !== "active")) throw new Error("WorkBindingMismatch");
    const linkedUserId = await this.ports.accounts.linkedUserId(identity.appId, identity.appUserId);
    const matchedUser = await this.ports.accounts.userByEmail(email);
    if (linkedUserId && matchedUser?.id !== linkedUserId) throw new Error("AppIdentityEmailConflict");
    if (existing && existing.ownerUserId !== matchedUser?.id) throw new Error("WorkNotOwned");
    const user = await this.ports.accounts.ensureUser(email, this.ports.initialAdminEmails.has(email));
    const branch = await this.ports.om.ensureUserBranch(user.id);
    await this.ports.accounts.recordAppIdentity(identity.appId, identity.appUserId, user.id, email);
    const revision = await this.ports.om.head(branch.branch);
    const definition = await this.ports.om.workDefinition(revision, this.workDefinitionId(workType));
    const reportGoal = definition.description.trim() || definition.title.trim();
    if (!reportGoal || reportGoal.length > 4000) throw new Error("WorkGoalRequired");
    const work = await this.ports.works.ensureReportWork(user.id, identity.appId, workType, entityId, { goal: reportGoal, appUserId: identity.appUserId });
    if (work.ownerUserId !== user.id || work.appUserId !== identity.appUserId || work.status !== "active" || (input.workId && work.id !== input.workId)) throw new Error("WorkBindingMismatch");
    if (typeof context.entityTitle === "string" && context.entityTitle.trim()) {
      work.entityTitle = context.entityTitle.trim().slice(0, 300);
      await this.ports.works.setWorkEntityTitle(work.id, work.entityTitle);
    }
    const session = await this.ports.works.createOrTouchSession(work.id);
    const ticket = this.ports.system.id("acp");
    const expiresAt = new Date(Date.parse(this.ports.system.now()) + 5 * 60_000).toISOString();
    await this.ports.sessions.put({ ticket, expiresAt, forgeUserId: user.id, workId: work.id, sessionId: session.id, appToken: input.token, reportId: entityId, workType, entityId, selection: work.selection });
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

  async disconnectAcp(ticket: string): Promise<void> {
    const session = await this.ports.sessions.get(ticket);
    if (session) await this.stopWork(session.workId);
    await this.ports.evidenceSessions?.clear(ticket); await this.ports.sessions.remove(ticket);
  }

  private async stopWork(workId: string): Promise<void> {
    const running = this.workRuns.get(workId);
    if (running) { running.controller.abort(); await running.done; }
  }

  async cancelTurn(ticket: string) {
    const session = await this.appSession(ticket);
    await this.assertActiveWork(session);
    await this.stopWork(session.workId);
    return this.sessionHistory(ticket);
  }

  async sessionHistory(ticket: string) {
    const session = await this.appSession(ticket);
    await this.assertActiveWork(session);
    const history = await this.workHistory(session.forgeUserId, session.workId);
    return { ...history, progress: workProgress(history.events), running: this.runningWorks.has(session.workId), cancelling: !!this.workRuns.get(session.workId)?.controller.signal.aborted, unresolvedCommands: this.unresolvedCommands(history.events) };
  }

  async checkpointFeedback(ticket: string, input: CheckpointFeedback, requestId: string) {
    const session = await this.appSession(ticket);
    await this.assertActiveWork(session);
    if (this.runningWorks.has(session.workId)) throw new Error("WorkTurnAlreadyRunning");
    if (this.feedbackWorks.has(session.workId)) throw new Error("WorkFeedbackInProgress");
    this.feedbackWorks.add(session.workId);
    try {
    if (!requestId || requestId.length > 200 || !input
      || Object.keys(input).some((key) => !["checkpointId", "kind", "note", "checkAt"].includes(key))
      || !["approve", "correct", "redo", "knowledge", "method", "resume"].includes(input.kind)
      || typeof input.note !== "string" || input.note.length > 4000
      || (input.kind !== "approve" && !input.note.trim())
      || (input.checkAt !== undefined && !["step", "phase"].includes(input.checkAt))) throw new Error("InvalidCheckpointFeedback");
    const events = await this.ports.trajectories.read(session.workId);
    const prior = events.find((event) => event.type === "work.feedback" && event.payload.requestId === requestId);
    const payload = { ...input, requestId, actorUserId: session.forgeUserId };
    if (prior) {
      if (this.ports.system.digest(prior.payload) !== this.ports.system.digest(payload)) throw new Error("FeedbackRequestConflict");
      return this.sessionHistory(ticket);
    }
    const progress = workProgress(events);
    if (!progress.waiting || progress.checkpoint?.id !== input.checkpointId) throw new Error("WorkCheckpointChanged");
    await this.ports.trajectories.append({ id: this.ports.system.id("evt"), workId: session.workId,
      type: "work.feedback", at: this.ports.system.now(), payload });
    return this.sessionHistory(ticket);
    } finally { this.feedbackWorks.delete(session.workId); }
  }

  async appWorks(token: string, reportId: string) {
    const identity = await this.ports.app.identity(token);
    if (identity.appId !== "certlab" || (this.ports.organizationId && identity.organizationId !== this.ports.organizationId)) throw new Error("AppOrganizationBindingMismatch");
    const context = await this.authoritativeContext(token, "report-authoring", reportId);
    this.assertContextTarget(context, "report-authoring", reportId);
    const user = await this.ports.accounts.userByEmail(identity.email.trim().toLowerCase());
    if (!user || await this.ports.accounts.linkedUserId(identity.appId, identity.appUserId) !== user.id) return { works: [] };
    const page = await this.ports.works.worksPage({ ownerUserId: user.id, workType: "report-authoring", status: "active" }, 0, 1000);
    return { works: page.works.filter((work) => work.entityId === reportId && work.appUserId === identity.appUserId) };
  }

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
    const [catalog, openApi] = await Promise.all([this.ports.app.catalog(session.appToken), this.ports.app.openApi(session.appToken)]);
    if (catalog.appId !== "certlab" || catalog.domainRelease !== "certlab/v1") throw new Error("UnsupportedAppCatalog");
    const paths = openApi.paths as Record<string, unknown> | undefined;
    if (!paths || !catalog.capabilities.every((capability) => paths[`/airic/v1/${capability.kind === "command" ? "commands" : "queries"}/${capability.id}`])) throw new Error("CatalogOpenApiMismatch");
    await this.ports.catalogs.saveCandidate(catalog, openApi);
    return catalog;
  }

  async acceptCatalog(ticket: string, digest: string) {
    const session = await this.appSession(ticket);
    await this.requireAdmin(session.forgeUserId);
    const candidate = await this.ports.catalogs.candidate("certlab", digest);
    if (!candidate) throw new Error("CatalogCandidateNotFound");
    await this.ports.catalogs.accept("certlab", digest, session.forgeUserId);
    return candidate;
  }

  async catalogOverview(actorUserId: string) {
    await this.requireAdmin(actorUserId);
    const [accepted, candidates] = await Promise.all([this.ports.catalogs.accepted("certlab"), this.ports.catalogs.candidates("certlab")]);
    return { accepted: accepted ?? null, candidates: candidates.filter((candidate) => candidate.digest !== accepted?.digest) };
  }

  async acceptCatalogFromWorkspace(actorUserId: string, digest: string) {
    await this.requireAdmin(actorUserId);
    const candidate = await this.ports.catalogs.candidate("certlab", digest);
    if (!candidate) throw new Error("CatalogCandidateNotFound");
    await this.ports.catalogs.accept("certlab", digest, actorUserId);
    return candidate;
  }

  async startTurn(ticket: string, userMessage: string, onText?: (text: string) => void, evidenceDigests: string[] = [], requestId?: string, onTurn?: (turnId: string) => void, onContextStatus?: (status: "organizing" | "ready" | "failed") => void, onActivity?: (activity: WorkActivity) => void) {
    const session = await this.appSession(ticket);
    await this.assertActiveWork(session);
    if (!userMessage.trim() || userMessage.length > 4000) throw new Error("WorkMessageRequired");
    if (requestId) {
      const events = await this.ports.trajectories.read(session.workId);
      const accepted = events.find((event) => event.type === "turn.started" && event.payload.requestId === requestId);
      if (accepted) {
        if (accepted.payload.userMessage !== userMessage) throw new Error("PromptRequestConflict");
        const previous = (await this.ports.works.turnsForWork(session.workId)).find((turn) => turn.id === accepted.turnId);
        const completed = events.find((event) => event.type === "turn.completed" && event.turnId === accepted.turnId);
        if (!previous || !completed) throw new Error("PromptAlreadyAccepted");
        const provenance = events.find((event) => event.type === "context.assembled" && event.turnId === accepted.turnId)?.payload.documents;
        return { turn: previous, documents: Array.isArray(provenance) ? provenance : [], reply: String(completed.payload.text ?? "") };
      }
    }
    if (workProgress(await this.ports.trajectories.read(session.workId)).waiting) throw new Error("WorkAwaitingFeedback");
    const workType = session.workType ?? "report-authoring";
    const entityId = session.entityId ?? session.reportId;
    if (this.runningWorks.has(session.workId) || this.feedbackWorks.has(session.workId)) throw new Error("WorkTurnAlreadyRunning");
    this.runningWorks.add(session.workId);
    const controller = new AbortController();
    let finish!: () => void;
    const done = new Promise<void>((resolve) => { finish = resolve; });
    this.workRuns.set(session.workId, { controller, done, finish });
    const operations = new Set<Promise<unknown>>();
    const assertRunning = async () => { controller.signal.throwIfAborted(); await this.appSession(ticket); };
    try {
    const preparingAt = this.ports.system.now();
    const preparation: WorkActivity = { id: this.ports.system.id("progress"), phase: "preparing", status: "running", label: "核对报告、权限与工作方法", at: preparingAt, startedAt: preparingAt };
    onActivity?.(preparation);
    const userId = await this.ports.works.userForWork(session.workId);
    if (!userId) throw new Error("WorkNotFound");
    const revision = await this.ports.om.head(`users/${userId}`);
    const [catalog, currentCatalog, definition, context] = await Promise.all([
      this.ports.catalogs.accepted("certlab"), this.ports.app.catalog(session.appToken), this.ports.om.workDefinition(revision, this.workDefinitionId(workType)), this.authoritativeContext(session.appToken, workType, entityId, session.selection),
    ]);
    if (!catalog) throw new Error("CapabilityCatalogNotAccepted");
    if (catalog.digest !== currentCatalog.digest) throw new Error("CapabilityCatalogChanged");
    this.assertContextTarget(context, workType, entityId);
    const resource = context.resource as Record<string, unknown>;
    const work = await this.ports.works.work(session.workId);
    context.workGoal = work?.goal;
    context.workDefinitionId = definition.id;
    await assertRunning();
    if (typeof context.entityTitle === "string" && context.entityTitle.trim()) await this.ports.works.setWorkEntityTitle(session.workId, context.entityTitle.trim().slice(0, 300));
    const issues = validateWorkDefinition(definition, new Set(catalog.capabilities.map((capability) => capability.id)), await this.ports.om.knownKnowledge(revision));
    if (issues.length) throw new Error(`InvalidOperatingModel: ${issues.map((issue) => `${issue.path} ${issue.message}`).join("; ")}`);
    const documents = await Promise.all([
      ...definition.documents.filter((document) => document.load === "required").map(async (document) => ({ id: document.id, path: `work-definitions/${definition.id}/${document.path}`, revision, reason: "work-definition" as const, content: await this.ports.om.document(revision, `work-definitions/${definition.id}/${document.path}`) })),
      ...definition.knowledge.bootstrap.map(async (id) => {
        const path = this.ports.om.knowledgePath ? await this.ports.om.knowledgePath(revision, id) : `subject-knowledge/${id}.md`;
        return { id, path, revision, reason: "bootstrap" as const, content: await this.ports.om.document(revision, path) };
      }),
    ]);
    const priorEvents = await this.ports.trajectories.read(session.workId);
    const progress = workProgress(priorEvents);
    context.workProgress = progress;
    context.workFacts = pinnedWorkFacts(priorEvents);
    const turn = await this.ports.works.nextTurn(session.workId, revision, catalog.digest, this.ports.system.digest({
      context, documents: documents.map(({ content: _, ...source }) => source), history: conversationMessages(priorEvents),
      userMessage, evidenceDigests, policyVersion: CONTEXT_POLICY_VERSION,
    }));
    await this.ports.trajectories.append({ id: this.ports.system.id("evt"), workId: session.workId, turnId: turn.id, type: "turn.started", at: turn.startedAt, payload: { omRevision: revision, catalogDigest: catalog.digest, userMessage, ...(requestId ? { requestId } : {}) } });
    onTurn?.(turn.id);
    const trajectoryWrites: Promise<unknown>[] = [];
    let streamedAgentText = "";
    let activeActivity: WorkActivity | undefined;
    const activity = async (value: WorkActivity) => {
      activeActivity = value;
      await this.ports.trajectories.append({ id: this.ports.system.id("evt"), workId: session.workId,
        turnId: turn.id, type: "message", at: value.at, payload: { activity: value } });
      onActivity?.(value);
    };
    const startActivity = async (phase: WorkActivity["phase"], label: string, extra: Partial<WorkActivity> = {}) => {
      const at = this.ports.system.now();
      const value: WorkActivity = { id: this.ports.system.id("progress"), turnId: turn.id, phase, status: "running", label, at, startedAt: at, ...extra };
      await activity(value);
      return value;
    };
    const finishActivity = async (value: WorkActivity, status: WorkActivity["status"] = "completed", code?: string) => {
      await activity({ ...value, status, at: this.ports.system.now(), ...(code ? { code } : {}) });
    };
    const monitor = async <T>(label: string, operation: () => Promise<T>, extra: Partial<WorkActivity> = {}) => {
      if (modelActivity?.status === "running") { const value = modelActivity; modelActivity = undefined; await finishActivity(value); }
      const value = await startActivity("tool", label, extra);
      try {
        const result = await operation();
        const outcome = result && typeof result === "object" ? result as Record<string, unknown> : undefined;
        const status = outcome?.status === "unknown" ? "unknown" : outcome?.status === "rejected" ? "failed" : "completed";
        const reason = typeof outcome?.reason === "string" && /^[\w.-]{1,100}$/.test(outcome.reason) ? outcome.reason : undefined;
        await finishActivity(value, status, status === "failed" ? reason ?? "CommandRejected" : status === "unknown" ? reason ?? "CommandResultUnknown" : undefined);
        return result;
      }
      catch (error) {
        const raw = error instanceof Error ? error.message : "ToolFailed";
        await finishActivity(value, controller.signal.aborted ? "cancelled" : "failed", /^[\w.-]{1,100}$/.test(raw) ? raw : "ToolFailed");
        throw error;
      }
    };
    await finishActivity({ ...preparation, turnId: turn.id });
    let modelActivity: WorkActivity | undefined;
    const waitingForModel = () => {
      const previous = modelActivity;
      const at = this.ports.system.now();
      modelActivity = { id: this.ports.system.id("progress"), turnId: turn.id, phase: "model", status: "running", label: "等待模型响应", at, startedAt: at };
      const next = modelActivity;
      const write = previous ? finishActivity(previous).then(() => activity(next)) : activity(next);
      trajectoryWrites.push(write); void write.catch(() => {});
    };
    let paused = false;
    let checkpointWritten = false;
    let handoffReason: string | undefined;
    const checkpointImpl = async (input: WorkCheckpoint, internal = false) => {
      await assertRunning();
      if ((paused && !internal) || operations.size) throw new Error("WorkCheckpointNotReady");
      const events = await this.ports.trajectories.read(session.workId);
      validateCheckpoint(input, events);
      const id = this.ports.system.id("evt");
      paused = true;
      try {
        await this.ports.trajectories.append({ id, workId: session.workId, turnId: turn.id,
          type: "work.checkpoint", at: this.ports.system.now(), payload: { ...structuredClone(input) } });
        checkpointWritten = true;
      } catch (error) { paused = false; throw error; }
      return { checkpointId: id };
    };
    const checkpoint = (input: WorkCheckpoint, internal = false) => monitor("记录工作检查点", () => checkpointImpl(input, internal));
    let unresolvedCommand = this.unresolvedCommands(priorEvents).length > 0;
    let organizationActivity: WorkActivity | undefined;
    const contextStatus = async (status: "organizing" | "ready" | "failed") => {
      if (controller.signal.aborted) return;
      if (status === "organizing" && !organizationActivity)
        organizationActivity = await startActivity("context", "整理对话上下文");
      if (status === "failed" && !organizationActivity)
        organizationActivity = await startActivity("context", "整理对话上下文");
      if (status !== "organizing" && organizationActivity) {
        await finishActivity(organizationActivity, status === "failed" ? "failed" : "completed", status === "failed" ? "ContextOrganizationFailed" : undefined);
        organizationActivity = undefined;
        if (status === "ready" && modelActivity) waitingForModel();
      }
      onContextStatus?.(status);
      await this.ports.trajectories.append({ id: this.ports.system.id("evt"), workId: session.workId,
        turnId: turn.id, type: "message", at: this.ports.system.now(), payload: { contextStatus: status } });
    };
    const forbidden = new Set(["assessment.submit", "assessment.confirm", "report.issue", "report.send"]);
    const tools: WorkAgentTool[] = catalog.capabilities.filter((capability) => !forbidden.has(capability.id) && !capability.id.startsWith("report-type.") && definition.capabilities.allowed.includes(capability.id)).map((capability) => ({
      capability,
      invoke: (input) => {
        const operation = monitor(capability.title, async () => {
        await assertRunning();
        if (paused) throw new Error("WorkAwaitingFeedback");
        if (input.report_id !== undefined && input.report_id !== entityId) throw new Error("CommandTargetMismatch");
        const boundInput: Record<string, unknown> = { ...structuredClone(input), report_id: entityId };
        if (capability.kind === "query") {
          const result = await this.ports.app.query(session.appToken, capability.id, boundInput);
          const eventId = this.ports.system.id("evt");
          await this.ports.trajectories.append({ id: eventId, workId: session.workId, turnId: turn.id,
            type: "observation", at: this.ports.system.now(), payload: { capabilityId: capability.id, input: boundInput, result: ["asset.read", "asset.read-location", "asset.search"].includes(capability.id) ? materialObservation(result) : result } });
          return { ...result, observationEventId: eventId };
        }
        if (unresolvedCommand) throw new Error("UnresolvedCommandBlocksFurtherWrites");
        if (typeof resource.projectId !== "string" || !capability.receiptScope) throw new Error("CommandLocatorUnavailable");
        let prepared: { resourceKind: "project"; resourceId: string; scope: string; targetKind: string; targetId: string } | undefined;
        if (!capability.id.startsWith("assessment.")) {
          if (!this.ports.app.prepareCommand) throw new Error("CommandLocatorUnavailable");
          try {
            prepared = await this.ports.app.prepareCommand(session.appToken, capability.id, boundInput);
          } catch (error) {
            handoffReason = error instanceof Error ? error.message : "CommandPreparationRejected";
            paused = true;
            const observationEventId = this.ports.system.id("evt");
            await this.ports.trajectories.append({ id: observationEventId, workId: session.workId,
              turnId: turn.id, type: "observation", at: this.ports.system.now(),
              payload: { capabilityId: capability.id, input: boundInput, preparationRejected: handoffReason } });
            return { status: "rejected", reason: handoffReason, observationEventId };
          }
          if (prepared.resourceId !== resource.projectId) throw new Error("CommandTargetMismatch");
        } else {
        if (typeof boundInput.assessment_id !== "string") throw new Error("CommandLocatorUnavailable");
        const fresh = await this.ports.app.query(session.appToken, "assessment.context", { report_id: entityId, assessment_id: boundInput.assessment_id });
        const assessment = fresh.assessment as Record<string, unknown> | undefined;
        if (!assessment || assessment.id !== boundInput.assessment_id || assessment.report_id !== entityId) throw new Error("CommandTargetMismatch");
        if (!Number.isInteger(assessment.record_no) || boundInput.expected_record_no !== assessment.record_no) throw new Error("ExpectedRecordNoMismatch");
        }
        await assertRunning();
        if (unresolvedCommand) throw new Error("UnresolvedCommandBlocksFurtherWrites");
        const actionId = this.ports.system.id("act");
        const commandId = this.ports.system.id("cmd");
        unresolvedCommand = true;
        const locator: AppCommandLocator = { commandId, capabilityId: capability.id, reportId: entityId,
          ...(typeof boundInput.assessment_id === "string" ? { assessmentId: boundInput.assessment_id } : {}),
          resourceKind: "project", resourceId: resource.projectId, scope: capability.receiptScope, ...prepared };
        await this.ports.trajectories.append({ id: this.ports.system.id("evt"), workId: session.workId, turnId: turn.id, type: "action", at: this.ports.system.now(), payload: { actionId, commandId, capabilityId: capability.id, status: "pending", locator, input: boundInput } });
        let outcome: Awaited<ReturnType<AppPort["submitCommand"]>>;
        try {
          outcome = await this.ports.app.submitCommand(session.appToken, capability.id, { commandId, expectedDomainRelease: catalog.domainRelease, input: boundInput, correlation: { work_id: session.workId, session_id: session.sessionId, turn_id: turn.id, action_id: actionId } }, locator);
        } catch { outcome = { status: "unknown", reason: "CommandResponseLost" }; }
        if (outcome.status === "unknown") {
          try {
            const receipt = await this.ports.app.receipt(session.appToken, locator);
            if (receipt?.status === "committed" || receipt?.status === "rejected") outcome = { status: receipt.status, receipt };
          } catch { /* Authority may have been revoked; retain unknown. */ }
        }
        unresolvedCommand = outcome.status === "unknown";
        const actionEventId = this.ports.system.id("evt");
        await this.ports.trajectories.append({ id: actionEventId, workId: session.workId, turnId: turn.id, type: "action", at: this.ports.system.now(), payload: { actionId, commandId, capabilityId: capability.id, status: outcome.status, locator, input: boundInput, receipt: outcome.receipt, reason: outcome.reason } });
        return { status: outcome.status, commandId, actionEventId, ...(outcome.receipt ? { receipt: outcome.receipt } : {}), ...(outcome.reason ? { reason: outcome.reason } : {}) };
        }, { capabilityId: capability.id,
          detail: [typeof input.q === "string" ? `关键词：${input.q.slice(0, 100)}` : "",
            typeof input.revision_id === "string" ? `版本：${input.revision_id.slice(0, 80)}` : "",
            Number.isSafeInteger(input.page) ? `第 ${input.page} 页` : ""].filter(Boolean).join(" · ") });
        operations.add(operation);
        void operation.then(() => operations.delete(operation), () => operations.delete(operation));
        return operation;
      },
    }));
    try {
      if (evidenceDigests.length > 3 || new Set(evidenceDigests).size !== evidenceDigests.length) throw new Error("InvalidEvidenceSelection");
      const evidence = evidenceDigests.length ? await this.ports.evidenceSessions?.take(ticket, evidenceDigests) : [];
      if (evidenceDigests.length && (!evidence || evidence.length !== evidenceDigests.length)) throw new Error("EvidenceNotAvailable");
      for (const item of evidence ?? []) await this.ports.trajectories.append({ id: this.ports.system.id("evt"), workId: session.workId, turnId: turn.id, type: "message", at: this.ports.system.now(), payload: { evidence: { filename: item.filename, digest: item.digest, characters: item.text.length, warnings: item.warnings } } });
      const available = new Map([
        ...definition.documents.filter((document) => document.load === "on-demand").map((document) => [document.id, `work-definitions/${definition.id}/${document.path}`] as const),
        ...await Promise.all(definition.knowledge.available.map(async (id) =>
          [id, this.ports.om.knowledgePath ? await this.ports.om.knowledgePath(revision, id) : `subject-knowledge/${id}.md`] as const)),
      ]);
      let memory;
      const contextActivity = await startActivity("context", "组装当前回合上下文");
      try {
        const summarizer = this.ports.workContext?.summarizer;
        memory = await assembleWorkMemory({
          scope: { organizationId: this.ports.organizationId ?? "certlab", ownerId: userId, workId: session.workId, omRevision: revision, catalogDigest: catalog.digest },
          events: priorEvents, excludedTurnId: turn.id,
          mandatory: { context, documents, userMessage, evidence, tools: tools.map(t => t.capability.inputSchema) },
          ports: this.ports.workContext && summarizer ? { ...this.ports.workContext, summarizer: {
            modelFingerprint: summarizer.modelFingerprint,
            summarize: async request => { await contextStatus("organizing"); return summarizer.summarize(request); },
          } } : undefined,
          digest: value => this.ports.system.digest(value), signal: controller.signal,
        });
        await assertRunning();
        if (memory.memory) await contextStatus("ready");
      } catch (error) { await contextStatus("failed"); throw error; }
      await finishActivity(contextActivity);
      context.workMemory = memory.memory;
      await this.ports.trajectories.append({ id: this.ports.system.id("evt"), workId: session.workId,
        turnId: turn.id, type: "context.assembled", at: this.ports.system.now(), payload: {
          contextDigest: turn.contextDigest,
          envelopeDigest: this.ports.system.digest({ context, documents, conversation: memory.conversation, userMessage }),
          policyVersion: CONTEXT_POLICY_VERSION, estimatedTokens: memory.estimatedTokens,
          memory: memory.memory ? { firstEventId: memory.memory.firstEventId, lastEventId: memory.memory.lastEventId, sourceDigest: memory.memory.sourceDigest } : undefined,
          documents: documents.map(({ content: _, ...provenance }) => provenance),
        } });
      modelActivity = await startActivity("model", "准备模型会话");
      const result = await this.ports.agents.runWork({ sessionId: session.sessionId, signal: controller.signal, userMessage, conversation: memory.conversation, context,
        inputTokens: this.ports.workContext?.inputTokens, outputTokens: this.ports.workContext?.outputTokens,
        onModelStatus: waitingForModel,
        onContextStatus: status => { const write = contextStatus(status); trajectoryWrites.push(write); void write.catch(() => {}); },
        readHistory: (offset, limit) => monitor("读取工作历史", async () => {
          await assertRunning();
          if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 20) throw new Error("InvalidHistoryRange");
          const page: Array<Record<string, unknown>> = [];
          let characters = 0;
          for (const message of conversationMessages(await this.ports.trajectories.read(session.workId), turn.id).slice(offset, offset + limit)) {
            const size = Array.from(message.text).length;
            if (characters + size > 8000) break;
            characters += size;
            const index = offset + page.length;
            page.push({ ...message, offset: index, nextOffset: index + 1 });
          }
          return page;
        }), documents: documents.map(({ id, content }) => ({ id, content })), evidence: (evidence ?? []).map(({ filename, digest, text }) => ({ filename, digest, text })), availableDocumentIds: [...available.keys()], loadDocument: (id) => monitor("读取工作方法文档", async () => {
        await assertRunning();
        const path = available.get(id);
        if (!path) throw new Error("DocumentNotAvailable");
        const content = await this.ports.om.document(revision, path);
        await this.ports.trajectories.append({ id: this.ports.system.id("evt"), workId: session.workId, turnId: turn.id, type: "context.document-loaded", at: this.ports.system.now(), payload: { id, path, revision, reason: "on-demand" } });
        return content;
      }), tools, checkpoint, onText: (text) => {
        if (modelActivity?.status === "running" && modelActivity.label === "等待模型响应") {
          const value = modelActivity;
          const at = this.ports.system.now();
          modelActivity = { ...value, id: this.ports.system.id("progress"), label: "正在生成回复", at, startedAt: at };
          const responding = modelActivity;
          const write = finishActivity(value).then(() => activity(responding)); trajectoryWrites.push(write); void write.catch(() => {});
        }
        if (controller.signal.aborted) return;
        streamedAgentText += text;
        onText?.(text);
      } });
      await Promise.all(trajectoryWrites);
      if (modelActivity?.status === "running") { await finishActivity(modelActivity); modelActivity = undefined; }
      await Promise.allSettled([...operations]);
      controller.signal.throwIfAborted();
      if (!checkpointWritten && (definition.capabilities.allowed.includes("command.context") || definition.capabilities.allowed.some(id => ["asset.read", "asset.search", "asset.read-location"].includes(id)))
        && (progress.checkAt === "step" || handoffReason || unresolvedCommand)) {
        const facts = (await this.ports.trajectories.read(session.workId)).filter((event) =>
          event.turnId === turn.id && (event.type === "observation"
            || (event.type === "action" && event.payload.status !== "pending")));
        await checkpoint({
          summary: "回合已结束，目标仍待业务核对。",
          eventIds: facts.slice(-50).map((event) => event.id),
          selfCheck: "系统已保留实际查询和原命令结果；未把回复结束视为专业确认或目标完成。",
          uncertainties: [handoffReason ?? (unresolvedCommand ? "存在结果未知的原命令，禁止重复写入。" : "Agent 未提供显式业务自检，请检验实际依据。")],
          nextStep: "检验实际结果后继续原目标，并重新读取当前事实与版本。",
          remainingWork: [String(work?.goal ?? "原工作目标仍需核对")],
          waitFor: handoffReason ? "human" : "feedback",
          resumeCondition: "工程师明确反馈；未知命令须先核对原回执。",
        }, true);
      }
      await this.ports.works.completeTurn(turn.id, "completed");
      await this.ports.trajectories.append({ id: this.ports.system.id("evt"), workId: session.workId, turnId: turn.id, type: "turn.completed", at: this.ports.system.now(), payload: { text: result.text } });
      return { turn: { ...turn, status: "completed" }, documents: documents.map(({ content: _, ...provenance }) => provenance), reply: result.text };
    } catch (error) {
      await Promise.allSettled(trajectoryWrites);
      await Promise.allSettled([...operations]);
      const code = controller.signal.aborted ? "WorkCancelled" : error instanceof Error ? error.message : "AgentRunFailed";
      if (activeActivity && (activeActivity.status === "running" || activeActivity.code === "ContextOrganizationFailed")) await finishActivity(activeActivity, controller.signal.aborted ? "cancelled" : "failed", /^[\w.-]{1,100}$/.test(code) ? code : "AgentRunFailed");
      else {
        const failed = await startActivity("model", activeActivity ? `处理“${activeActivity.label.slice(0, 200)}”的结果` : "执行回合", activeActivity?.capabilityId ? { capabilityId: activeActivity.capabilityId } : {});
        await finishActivity(failed, controller.signal.aborted ? "cancelled" : "failed", /^[\w.-]{1,100}$/.test(code) ? code : "AgentRunFailed");
      }
      await this.ports.works.completeTurn(turn.id, controller.signal.aborted ? "cancelled" : "failed");
      if (streamedAgentText) await this.ports.trajectories.append({ id: this.ports.system.id("evt"), workId: session.workId, turnId: turn.id, type: "message", at: this.ports.system.now(), payload: { agentTextDelta: streamedAgentText, partial: true } });
      await this.ports.trajectories.append({ id: this.ports.system.id("evt"), workId: session.workId, turnId: turn.id, type: "error", at: this.ports.system.now(), payload: { code } });
      throw error;
    }
    } finally { await Promise.allSettled([...operations]); this.runningWorks.delete(session.workId); this.workRuns.delete(session.workId); finish(); }
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
    const messages = await this.ports.works.reflectionMessages(reflectionId);
    const draft = this.omChanges ? await this.omChanges.read(reflection.ownerUserId, `reflection:${reflectionId}`) : undefined;
    return { reflection, messages, draft };
  }

  async personalReflections(actorUserId: string) {
    if (!await this.ports.accounts.userById(actorUserId)) throw new Error("Unauthorized");
    return this.ports.works.reflectionsForUser(actorUserId);
  }
  async openPersonalReflection(actorUserId: string, question: string) {
    if (!await this.ports.accounts.userById(actorUserId)) throw new Error("Unauthorized");
    if (typeof question !== "string" || !question.trim() || question.length > 4000) throw new Error("ReflectionMessageRequired");
    await this.ports.om.ensureUserBranch(actorUserId);
    const omRevision = await this.ports.om.head(`users/${actorUserId}`);
    const reflection = await this.ports.works.openReflection({ ownerUserId: actorUserId, lensId: "conversation", lensVersion: 0, lensPrompt: "", question: question.trim(), evidenceEventIds: [], omRevision }, "可以在这里讨论工作方法和领域知识。明确要求修改时，我会准备 OM 草稿；只有你确认提交后才会生效。");
    return this.reflectionDetail(actorUserId, reflection.id);
  }
  async mutateOmDraft<T>(actorUserId: string, scope: string, action: () => Promise<T>): Promise<T> {
    const reflectionId = scope.startsWith("reflection:") ? scope.slice(11) : undefined;
    if (reflectionId) {
      const reflection = await this.readableReflection(actorUserId, reflectionId);
      if (reflection.ownerUserId !== actorUserId) throw new Error("ReflectionNotOwned");
      if (this.runningReflections.has(reflectionId)) throw new Error("ReflectionAlreadyRunning");
    }
    return this.reflectionRuns ? this.reflectionRuns.mutateDraft(reflectionId, action) : action();
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

  async startReflectionRun(actorUserId: string, reflectionId: string, message: string, requestId: string) {
    const reflection = await this.readableReflection(actorUserId, reflectionId);
    if (reflection.ownerUserId !== actorUserId) throw new Error("ReflectionNotOwned");
    if (typeof requestId !== "string" || !/^[a-zA-Z0-9_-]{8,100}$/.test(requestId)) throw new Error("ReflectionRequestIdRequired");
    if (typeof message !== "string" || !message.trim() || message.length > 4000) throw new Error("ReflectionMessageRequired");
    const runs = this.requireReflectionRuns();
    const existing = runs.forRequest(reflectionId, requestId, message);
    if (existing) return { run: existing, created: false };
    let preparation!: ReflectionPreparation;
    return runs.startPrepared({ reflectionId, ownerUserId: actorUserId, requestId, message }, async () => {
      preparation = await this.prepareReflection(actorUserId, reflectionId, message);
    }, async (execution) => {
      const detail = await this.executeReflection(actorUserId, reflectionId, message, execution, preparation);
      return detail.messages.at(-1)?.id;
    });
  }

  async currentReflectionRun(actorUserId: string, reflectionId: string) {
    await this.readableReflection(actorUserId, reflectionId);
    return this.requireReflectionRuns().current(reflectionId) ?? null;
  }

  async readableReflectionRun(actorUserId: string, reflectionId: string, runId: string) {
    await this.readableReflection(actorUserId, reflectionId);
    return this.requireReflectionRuns().get(reflectionId, runId);
  }

  async cancelReflectionRun(actorUserId: string, reflectionId: string, runId: string) {
    const reflection = await this.readableReflection(actorUserId, reflectionId);
    if (reflection.ownerUserId !== actorUserId) throw new Error("ReflectionNotOwned");
    return this.requireReflectionRuns().cancel(reflectionId, runId);
  }

  private requireReflectionRuns() {
    if (!this.reflectionRuns) throw new Error("ReflectionRunStoreNotConfigured");
    return this.reflectionRuns;
  }

  async continueReflection(actorUserId: string, reflectionId: string, message: string) {
    if (!this.reflectionRuns) return this.executeReflection(actorUserId, reflectionId, message);
    const { run } = await this.startReflectionRun(actorUserId, reflectionId, message, this.ports.system.id("req"));
    const settled = await this.reflectionRuns.wait(reflectionId, run.id);
    if (settled.status !== "completed") throw new Error(settled.error ?? "ReflectionCancelled");
    return this.reflectionDetail(actorUserId, reflectionId);
  }

  private async prepareReflection(actorUserId: string, reflectionId: string, message: string): Promise<ReflectionPreparation> {
    const reflection = await this.readableReflection(actorUserId, reflectionId);
    if (reflection.ownerUserId !== actorUserId) throw new Error("ReflectionNotOwned");
    if (reflection.status === "abandoned") throw new Error("ReflectionClosed");
    if (typeof message !== "string" || !message.trim() || message.length > 4000) throw new Error("ReflectionMessageRequired");
    const conversational = reflection.lensId === "conversation" || (await this.ports.works.reflectionMessages(reflectionId)).some((item) => item.role === "user" && /^\/(?:lens\s+)?(?:domain-knowledge|delegation-gap|api-suggestion)(?:\s|$)/.test(item.content));
    const invokedLens = conversational ? await this.reflectionCommand(message) : undefined;
    return { reflection, conversational, invokedLens };
  }

  private async executeReflection(actorUserId: string, reflectionId: string, message: string, execution?: ReflectionExecution, preparation?: ReflectionPreparation) {
    const { reflection, invokedLens } = preparation ?? await this.prepareReflection(actorUserId, reflectionId, message);
    if (!this.omChanges) throw new Error("OmChangesUnavailable");
    if (this.runningReflections.has(reflectionId)) throw new Error("ReflectionAlreadyRunning");
    this.runningReflections.add(reflectionId);
    try {
      execution?.signal.throwIfAborted();
      if (!execution) await this.ports.works.appendReflectionMessage(reflectionId, "user", message.trim());
      const scope = `reflection:${reflectionId}`;
      const draft = await this.omChanges.read(actorUserId, scope);
      await this.ports.works.setReflectionRevision(reflectionId, draft.baseRevision);
      const events = reflection.workId ? await this.ports.trajectories.read(reflection.workId) : [];
      const selected = reflection.evidenceEventIds.map((id) => events.find((event) => event.id === id)).filter((event) => event !== undefined);
      const disclosed = new Set(selected.map((event) => event.id));
      const readTrajectory = async (offset: number, limit: number) => {
        execution?.signal.throwIfAborted();
        if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 20) throw new Error("InvalidTrajectoryPage");
        const page = events.slice(offset, offset + limit);
        if (JSON.stringify(page).length > 100_000) throw new Error("ReflectionEvidenceTooLarge");
        for (const event of page) disclosed.add(event.id);
        return page;
      };
      const sourceWork = reflection.workId ? await this.ports.works.work(reflection.workId) : undefined;
      const files = await this.ports.om.listFiles(draft.baseRevision);
      const documents = await Promise.all(files.map(async (path) => ({ path, content: await this.ports.om.document(draft.baseRevision, path) })));
      const lens: ReflectionLens = invokedLens ?? { id: "conversation", version: 0, enabled: true, prompt: "Discuss improvements to the owner's Operating Model. Prepare draft edits only when the user explicitly requests a change. Never commit automatically." };
      const readDraftFile = async (path: string) => {
        execution?.signal.throwIfAborted();
        if (!isAllowedOmDocumentPath(path)) throw new Error("OmPathNotAllowed");
        const edit = (await this.omChanges!.read(actorUserId, scope)).edits.find((edit) => edit.path === path);
        return edit ? edit.content ?? "" : this.ports.om.document(draft.baseRevision, path);
      };
      const writeDraftFile = async (path: string, content: string, citedEventIds: string[], summary: string) => {
        execution?.signal.throwIfAborted();
        const lensAllows = lens.id === "conversation"
          || lens.id === "domain-knowledge" && /^(subject-knowledge|precedents)\//.test(path)
          || lens.id === "delegation-gap" && path.startsWith(sourceWork ? `work-definitions/${this.workDefinitionId(sourceWork.workType)}/` : "work-definitions/");
        if (!isAllowedOmDocumentPath(path) || !lensAllows || citedEventIds.some((id) => !disclosed.has(id))) throw new Error("InvalidReflectionChange");
        const current = await this.omChanges!.read(actorUserId, scope);
        let edits = [...current.edits.filter((edit) => edit.path !== path), { path, content }];
        if (sourceWork) edits = this.omChanges!.routeKnowledge(draft.baseRevision, edits, this.workDefinitionId(sourceWork.workType)) as typeof edits;
        await this.omChanges!.save(actorUserId, scope, { baseRevision: draft.baseRevision, edits, summary });
        execution?.onProgress({ type: "draft.updated" });
      };
      if (!this.ports.reflectionAgent) throw new Error("ReflectionAgentNotConfigured");
      const result = await this.ports.reflectionAgent.analyze({
        reflectionId, lens, question: message.trim(), messages: await this.ports.works.reflectionMessages(reflectionId),
        evidence: selected, ...(reflection.workId ? { readTrajectory } : {}),
        ...(lens.id !== "api-suggestion" ? { readDraftFile, writeDraftFile } : {}),
        omRevision: draft.baseRevision, documents,
        signal: execution?.signal, onProgress: execution?.onProgress,
      });
      execution?.signal.throwIfAborted();
      if (!result.analysis.trim() || result.citedEventIds.some((id) => !disclosed.has(id))) throw new Error("ReflectionEvidenceMismatch");
      if (result.outcome === "changes") {
        for (const edit of result.edits ?? []) await writeDraftFile(edit.path, edit.content, result.citedEventIds, result.changeSummary?.trim() || result.attribution);
        if (!(await this.omChanges.read(actorUserId, scope)).edits.length) throw new Error("InvalidReflectionChange");
      }
      if (result.outcome === "api-suggestion" && (lens.id !== "api-suggestion" || !result.suggestionMarkdown?.trim())) throw new Error("InvalidApiSuggestion");
      execution?.commit();
      execution?.onProgress({ type: "text.replace", text: result.analysis });
      await this.ports.works.appendReflectionMessage(reflectionId, "agent", result.analysis, { lensId: lens.id, lensVersion: lens.version, citedEventIds: result.citedEventIds });
      if (invokedLens) await this.ports.works.setReflectionContext(reflectionId, invokedLens, result.citedEventIds);
      await this.ports.works.setReflectionResult(reflectionId, { status: "active", outcome: result.outcome, analysis: result.analysis, attribution: result.attribution, ...(result.outcome === "api-suggestion" ? { suggestionMarkdown: result.suggestionMarkdown } : {}) });
      return this.reflectionDetail(actorUserId, reflectionId);
    } catch (error) {
      if (!execution?.signal.aborted) await this.ports.works.setReflectionResult(reflectionId, { status: "failed" });
      throw error;
    } finally { this.runningReflections.delete(reflectionId); }
  }
  async reflectionSuggestion(actorUserId: string, reflectionId: string) {
    const reflection = await this.readableReflection(actorUserId, reflectionId);
    if (!reflection.suggestionMarkdown) throw new Error("ApiSuggestionNotFound");
    return reflection.suggestionMarkdown;
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
    return { activity: { ...activity, personalOmCommits: await this.ports.om.personalCommitCount?.() ?? 0 }, feedback, interpretation: "活动数量不能证明能力改善。反馈来自用户自报；制定目标前需要按工作类型、任务难度、能力目录和模型配置选取可比样本。" };
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
    await this.validateOmCandidate(candidate.revision);
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
    await this.validateOmCandidate(reviewedRevision);
    const revision = await this.ports.om.acceptContribution(record.candidateBranch, record.baseMainRevision);
    await organization.acceptContribution(id, revision);
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
    if (!isAllowedOmDocumentPath(path)) throw new Error("InvalidOmPath");
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
    if (this.omChanges) {
      const workspace = await this.omChanges.read(actorUserId, "manual");
      await this.omChanges.save(actorUserId, "manual", { baseRevision, summary: workspace.summary || "Update personal OM", edits: [...workspace.edits.filter((edit) => edit.path !== path), { path, content }] });
    }
    else await this.ports.omDrafts.saveDraft(draft);
    return draft;
  }

  async discardPersonalOmDraft(actorUserId: string, ownerUserId: string, path: string) {
    if (actorUserId !== ownerUserId) throw new Error("Forbidden");
    await this.personalOm(actorUserId, ownerUserId);
    if (!isAllowedProposalPath(path)) throw new Error("InvalidOmPath");
    if (!this.ports.omDrafts) throw new Error("OmDraftsUnavailable");
    if (this.omChanges) {
      const workspace = await this.omChanges.read(actorUserId, "manual");
      if (workspace.edits.length) await this.omChanges.save(actorUserId, "manual", { baseRevision: workspace.baseRevision, summary: workspace.summary, edits: workspace.edits.filter((edit) => edit.path !== path) });
    }
    else await this.ports.omDrafts.discardDraft(ownerUserId, path);
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
    if (!pending.locator) throw new Error("OriginalCommandLocatorUnavailable");
    const receipt = await this.ports.app.receipt(session.appToken, pending.locator);
    if (!receipt || (receipt.status !== "committed" && receipt.status !== "rejected")) return { commandId, status: "unknown" as const };
    await this.ports.trajectories.append({ id: this.ports.system.id("evt"), workId: session.workId, turnId: pending.turnId, type: "action", at: this.ports.system.now(), payload: { commandId, actionId: pending.actionId, capabilityId: pending.capabilityId, status: receipt.status, receipt, recovered: true } });
    return { commandId, status: receipt.status, receipt };
  }
  private unresolvedCommands(events: Awaited<ReturnType<TrajectoryPort["read"]>>) {
    const latest = new Map<string, { commandId: string; actionId: string; capabilityId: string; status: string; turnId?: string; locator?: AppCommandLocator }>();
    for (const event of events) {
      if (event.type !== "action" || typeof event.payload.commandId !== "string") continue;
      const { commandId, actionId, capabilityId, status } = event.payload;
      latest.set(commandId, { commandId, actionId: String(actionId ?? ""), capabilityId: String(capabilityId ?? ""), status: String(status ?? "unknown"), turnId: event.turnId, locator: event.payload.locator as AppCommandLocator | undefined });
    }
    return [...latest.values()].filter((item) => item.status === "pending" || item.status === "unknown");
  }
  private async validateOmCandidate(candidate: string): Promise<void> {
    const catalog = await this.ports.catalogs.accepted("certlab");
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
  private async readableReflection(actorUserId: string, reflectionId: string): Promise<ReflectionRecord> {
    const reflection = await this.ports.works.reflection(reflectionId);
    if (!reflection) throw new Error("ReflectionNotFound");
    await this.authorizedOmOwner(actorUserId, reflection.ownerUserId);
    return reflection;
  }
  private async assertActiveWork(session: SessionGrant): Promise<void> {
    const work = await this.ports.works.work(session.workId);
    if (!work || work.status !== "active" || work.ownerUserId !== session.forgeUserId || work.appId !== "certlab" || work.entityId !== (session.entityId ?? session.reportId)) throw new Error("WorkCompleted");
  }
  private async authoritativeContext(token: string, workType: string, entityId: string, selection?: Record<string, unknown>) {
    if (workType !== "report-authoring") throw new Error("UnsupportedAppContext");
    return this.ports.app.reportContext(token, entityId, selection);
  }
  private assertContextTarget(context: Record<string, unknown>, workType: string, entityId: string): void {
    const resource = context.resource as Record<string, unknown> | undefined;
    if (workType !== "report-authoring" || resource?.namespace !== "certlab" || resource.resourceType !== "report" || resource.resourceId !== entityId) throw new Error("InvalidReportContext");
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
