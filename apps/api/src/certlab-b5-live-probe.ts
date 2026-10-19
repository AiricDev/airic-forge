/** B5: real HTTP business, real Forge governance, synthetic models only. */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ForgeUseCases, type AgentRunnerPort, type ReflectionAgentPort } from "@airic-forge/domain";
import { ForgeRuntime } from "./runtime.js";
import { buildServer } from "./server.js";
import { hashPassword, verifyPassword } from "./auth.js";
import { systemPort } from "./system-port.js";

let input = "";
for await (const chunk of process.stdin) input += chunk;
const scene = JSON.parse(input) as { origin: string; token: string; organizationId: string; reportId: string; assessmentId: string; omSource: string; assets: Record<string, { id: string; revisionId: string }> };
const root = mkdtempSync(join(tmpdir(), "forge-certlab-b5-"));
const config = { port: 0, projectDir: join(root, "project"), dataDir: join(root, "data"), seedProjectDir: scene.omSource, reportWorkDefinitionId: "certification-assessment", webDistDir: join(root, "web"), certLabUrl: scene.origin, organizationId: scene.organizationId, allowedOrigin: "http://localhost", initialAdminEmails: new Set(["synthetic-engineer@example.invalid"]) };
const commands: string[] = [];
const knowledgePath = "subject-knowledge/standards/synthetic/2026/clauses/1/source-scope.md";
const precedentPath = "precedents/synthetic/2026/source-scope.md";
const knowledgeId = "synthetic-2026-clause-1-source";
const precedentId = "precedent-synthetic-source";
const marker = "Synthetic reviewed candidate: preserve revision and limitations.";
const learned = (id: string) => `---\nid: ${id}\ntitle: Synthetic source scope\nsummary: Preserve original revision and explicit limits.\ntopics: [source]\nreview_state: candidate\n---\n\n${marker}\nNot a verified professional rule.\n`;
const seen: string[] = [];
const agents: AgentRunnerPort = { runWork: async ({ tools, documents, loadDocument, availableDocumentIds }) => {
  const invoke = (id: string, value: Record<string, unknown>) => tools.find((tool) => tool.capability.id === id)!.invoke(value);
  if (!seen.length) {
    assert(!availableDocumentIds.includes(knowledgeId));
    const source = await invoke("asset.read", { revision_id: scene.assets.pdf.revisionId, page: 2, include_image: true });
    assert.equal(source.status, "ready");
    assert.equal((source.source as { revision_id: string }).revision_id, scene.assets.pdf.revisionId);
    for (const [id, value] of [
      ["assessment.start", { assessment_id: scene.assessmentId, expected_record_no: 0 }],
      ["assessment.save-draft", { assessment_id: scene.assessmentId, expected_record_no: 1, result_fields: { note: "Synthetic learning source; conclusion remains undetermined" }, rationale: "Source requires human professional verification.", evidence_refs: [{ asset_revision_id: scene.assets.pdf.revisionId, locator: "page 2" }] }],
    ] as Array<[string, Record<string, unknown>]>) {
      const result = await invoke(id, value);
      assert.equal(result.status, "committed");
      commands.push(String(result.commandId));
    }
  } else {
    assert(availableDocumentIds.includes(knowledgeId));
    assert((await loadDocument(knowledgeId)).includes(marker));
    assert((await loadDocument(precedentId)).includes("candidate"));
    assert(!documents.find((doc) => doc.id === "method")!.content.includes("Uncommitted private draft"));
  }
  seen.push("completed");
  return { text: "Synthetic source and original business results checked; required human confirmation remains." };
} };
const reflectionAgent: ReflectionAgentPort = { analyze: async (request) => {
  const events = await request.readTrajectory!(0, 20);
  const cited = events.filter((event) => event.type === "work.feedback" || event.type === "action" || event.type === "observation").map((event) => event.id);
  if (!cited.length) cited.push(...events.filter((event) => event.type === "turn.completed").map((event) => event.id));
  assert(cited.length);
  if (request.lens.id === "domain-knowledge") {
    assert(events.some((event) => event.type === "work.feedback"));
    assert(events.some((event) => event.type === "action" && event.payload.status === "committed"));
    assert(events.some((event) => event.type === "observation" && event.payload.capabilityId === "asset.read"));
  }
  if (request.lens.id === "conversation") return { outcome: "analysis", analysis: "Insufficient to establish professional improvement; retain the evidence.", attribution: "", citedEventIds: cited };
  if (request.lens.id === "api-suggestion") return { outcome: "api-suggestion", analysis: "A scoped source comparison query may help.", attribution: "Actual original source observations.", citedEventIds: cited, suggestionMarkdown: "# Synthetic API suggestion\n\nRead-only, authenticated, revision-pinned; not a published capability." };
  if (request.lens.id === "delegation-gap") {
    await assert.rejects(() => request.writeProposalFile!(knowledgePath, learned(knowledgeId), cited, "Wrong lens"), /InvalidReflectionProposal/);
    const path = "work-definitions/certification-assessment/method.md";
    return { outcome: "proposal", analysis: "Keep original source limitations before concluding.", attribution: "Actual feedback and source observations.", citedEventIds: cited, edits: [{ path, content: request.documents.find((doc) => doc.path === path)!.content + "\n\nSynthetic method candidate; human confirmation remains required.\n" }] };
  }
  await assert.rejects(() => request.writeProposalFile!("work-definitions/certification-assessment/policy.md", "Not allowed", cited, "Wrong lens"), /InvalidReflectionProposal/);
  return { outcome: "proposal", analysis: "Propose source-scope knowledge, not a professional conclusion.", attribution: "Actual original-source event, business receipts and engineer correction.", citedEventIds: cited, edits: [{ path: knowledgePath, content: learned(knowledgeId) }, { path: precedentPath, content: learned(precedentId) }] };
} };
const compose = (runtime: ForgeRuntime) => new ForgeUseCases({ accounts: runtime.db, works: runtime.db, om: runtime.om, omDrafts: runtime.db, organization: runtime.db, measurements: runtime.db, reportWorkDefinitionId: config.reportWorkDefinitionId, organizationId: config.organizationId, app: runtime.app, catalogs: runtime.db, agents, reflectionAgent, reflectionRunStore: runtime.db, sessions: runtime.sessions, passwordSetups: runtime.passwordSetups, passwordCodec: { hash: hashPassword, verify: verifyPassword }, trajectories: runtime.trajectories, system: systemPort, initialAdminEmails: config.initialAdminEmails });
let runtime = new ForgeRuntime(config);
Object.assign(runtime, { useCases: compose(runtime) });
let server = buildServer(runtime);
server.log.level = "silent";
let origin = await server.listen({ host: "127.0.0.1", port: 0 });
let cookie = "";
const http = async (path: string, body?: unknown, method = body === undefined ? "GET" : "POST", headers: Record<string, string> = {}, expected = 200) => {
  const response = await fetch(`${origin}${path}`, { method, headers: { ...cookie ? { Cookie: cookie } : {}, "Content-Type": "application/json", ...headers }, ...body === undefined ? {} : { body: JSON.stringify(body) } });
  assert.equal(response.status, expected, `${path}: ${await response.clone().text()}`);
  if (response.headers.get("set-cookie")) cookie = response.headers.get("set-cookie")!.split(";")[0];
  return response.status === 204 ? undefined : response.json();
};
try {
  const session = await http("/api/v1/app-sessions/bootstrap", { appId: "certlab", workType: "report-authoring", entityId: scene.reportId }, "POST", { Authorization: `Bearer ${scene.token}` }, 201);
  const useCases = runtime.useCases;
  const catalog = await useCases.importCatalog(session.ticket);
  await useCases.acceptCatalog(session.ticket, catalog.digest);
  await http(`/api/v1/app-sessions/${session.passwordSetupTicket}/password`, { password: "Synthetic-learning-password-123" }, "POST", {}, 204);
  await http("/api/v1/auth/login", { email: session.user.email, password: "Synthetic-learning-password-123" });
  const m1 = runtime.om.head(session.user.activeBranch);
  await useCases.startTurn(session.ticket, "Read original source");
  const original = await useCases.sessionHistory(session.ticket);
  await useCases.checkpointFeedback(session.ticket, { checkpointId: original.progress.checkpoint!.id, kind: "method", note: "Preserve original revision and limits; no reading establishes conformance." }, "synthetic-b5-method");
  const reflection = await http(`/api/v1/works/${session.work.id}/reflection/open`, {});
  const analyze = (message: string) => http(`/api/v1/reflections/${reflection.reflection.id}/messages`, { message });
  assert.equal((await analyze("Discuss limitations without inventing a reusable rule")).proposal, undefined);
  assert.equal((await analyze("/api-suggestion A revision-scoped comparison")).proposal, undefined);
  const domain = await analyze("/domain-knowledge Propose scoped source knowledge");
  const proposal = await http(`/api/v1/proposals/${domain.proposal.id}`);
  assert(proposal.changedPaths.includes(knowledgePath) && proposal.changedPaths.includes(precedentPath));
  assert.equal(runtime.om.head(session.user.activeBranch), m1);
  assert.equal(original.turns[0].omRevision, m1);
  const other = runtime.db.ensureUser("synthetic-other@example.invalid", false);
  const otherCookie = `forge_session=${runtime.webSessions.issue(other.id)}`;
  assert.equal((await http(`/api/v1/proposals/${domain.proposal.id}/adopt`, { title: "Unauthorized" }, "POST", { Cookie: otherCookie }, 409)).error, "Forbidden");
  const review = await http(`/api/v1/proposals/${domain.proposal.id}/review`, {});
  await http(`/api/v1/proposals/${domain.proposal.id}/adopt`, { title: "Wrong review", reviewedRevision: "wrong" }, "POST", {}, 409);
  const adopted = await http(`/api/v1/proposals/${domain.proposal.id}/adopt`, { title: "Preserve source scope", reviewedRevision: review.reviewedRevision });
  assert.notEqual(adopted.revision, m1);
  const personal = runtime.om.ensureUserBranch(session.user.id);
  const methodPath = "work-definitions/certification-assessment/method.md";
  await useCases.savePersonalOmDraft(session.user.id, session.user.id, methodPath, runtime.om.document(adopted.revision, methodPath) + "\nUncommitted private draft\n", adopted.revision);
  await useCases.startTurn(session.ticket, "Use adopted source-scope method in the original Work");
  assert.deepEqual((await useCases.sessionHistory(session.ticket)).events.filter((event) => original.events.some((old) => old.id === event.id)), original.events);
  assert.equal((await useCases.sessionHistory(session.ticket)).turns.at(-1)!.omRevision, adopted.revision);
  const methodSession = await useCases.bootstrap({ token: scene.token, reportId: scene.reportId });
  await useCases.startTurn(methodSession.ticket, "Check method candidate");
  const methodReflection = await http(`/api/v1/works/${methodSession.work.id}/reflection/open`, {});
  const method = await http(`/api/v1/reflections/${methodReflection.reflection.id}/messages`, { message: "/delegation-gap Preserve original limitations" });
  assert(method.proposal);
  await http(`/api/v1/proposals/${method.proposal.id}/abandon`, {});
  const share = await useCases.createOrganizationContribution(session.user.id, session.user.id, "Share scoped candidate knowledge", "Actual Work references");
  const sharedReview = await useCases.reviewOrganizationContribution(session.user.id, share.id, proposal.changedPaths);
  const shared = await useCases.acceptOrganizationContribution(session.user.id, share.id, sharedReview.reviewedRevision!);
  assert.equal(runtime.om.head(session.user.activeBranch), adopted.revision);
  await http("/api/v1/om/organization", undefined, "GET", { Cookie: otherCookie });
  await http(`/api/v1/works/${session.work.id}`, undefined, "GET", { Cookie: otherCookie }, 403);
  await server.close();
  runtime.db.close();
  assert.throws(() => new ForgeRuntime({ ...config, organizationId: "another-institution" }), /InstanceBindingMismatch/);
  runtime = new ForgeRuntime(config);
  Object.assign(runtime, { useCases: compose(runtime) });
  server = buildServer(runtime);
  server.log.level = "silent";
  origin = await server.listen({ host: "127.0.0.1", port: 0 });
  cookie = "";
  await http(`/api/v1/works/${session.work.id}`, undefined, "GET", {}, 401);
  await assert.rejects(() => runtime.useCases.sessionHistory(session.ticket), /AppSessionExpired/);
  const resumed = await http("/api/v1/app-sessions/bootstrap", { appId: "certlab", workType: "report-authoring", entityId: scene.reportId, workId: session.work.id }, "POST", { Authorization: `Bearer ${scene.token}` }, 201);
  assert.equal(resumed.passwordSetupRequired, false);
  assert.equal(resumed.activeRevision, adopted.revision);
  await http("/api/v1/auth/login", { email: session.user.email, password: "Synthetic-learning-password-123" });
  assert.equal((await http(`/api/v1/proposals/${domain.proposal.id}`)).proposal.status, "adopted");
  const history = await runtime.useCases.sessionHistory(resumed.ticket);
  await runtime.useCases.checkpointFeedback(resumed.ticket, { checkpointId: history.progress.checkpoint!.id, kind: "resume", note: "Restarted and re-read original facts." }, "synthetic-b5-restart");
  await runtime.useCases.startTurn(resumed.ticket, "Continue the original goal after restart");
  const restored = await runtime.useCases.sessionHistory(resumed.ticket);
  assert.equal(restored.turns.at(-1)!.omRevision, adopted.revision);
  assert.equal(restored.turns[0].omRevision, m1);
  assert(!JSON.stringify(restored).includes(scene.token));
  assert(!JSON.stringify(restored).includes(marker));
  process.stdout.write(JSON.stringify({ status: "passed", commands, initialOmUsed: true, actualWorkReceiptsAndFeedbackCited: true, threeLensesSeparated: true, nestedStableIdsAndPrecedentsReviewed: true, noAutomaticAdoption: true, authorReviewRequired: true, adoptedNextTurnSameWork: true, oldTurnAndEventsUnchanged: true, privateDraftExcluded: true, organizationMain: shared.revision, mainDoesNotOverwritePersonal: true, privateWorkNotShared: true, foreignRootRejected: true, restartRequiresBootstrapAndLogin: true, adoptedVersionSurvivesRestart: true, tokenAbsentFromHistory: true, manualConfirmationPreserved: true, modelQualityNotClaimed: true }));
} finally { await server.close(); runtime.db.close(); rmSync(root, { recursive: true, force: true }); }
