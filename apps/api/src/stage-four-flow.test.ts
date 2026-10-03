import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { ForgeUseCases, type AgentRunnerPort, type CapabilityCatalog, type CertReporterPort, type ReflectionAgentPort } from "@airic-forge/domain";
import { hashPassword, verifyPassword } from "./auth.js";
import { InMemoryAppSessionStore } from "./app-session-store.js";
import { InMemoryPasswordSetupStore } from "./password-setup-store.js";
import type { ForgeConfig } from "./config.js";
import { ForgeRuntime } from "./runtime.js";
import { systemPort } from "./system-port.js";

test("three Reflection lenses preserve evidence and version, create only supported outcomes, and keep concurrent worktrees separate", async () => {
  const root = mkdtempSync(join(tmpdir(), "airic-forge-stage-four-"));
  const config: ForgeConfig = { port: 0, projectDir: join(root, "project"), dataDir: join(root, "data"), seedProjectDir: resolve(process.cwd(), "../../seed/project"), webDistDir: join(root, "web"), certReporterUrl: "http://127.0.0.1:1", allowedOrigin: "http://localhost:5173", initialAdminEmails: new Set() };
  const ids = ["report.context", "report.read", "report.gaps", "report.update-master", "report.update-data", "report-type.context", "report-type.read", "report-type.list-published-standards", "report-type.preview", "report-type.update-draft"];
  const catalog: CapabilityCatalog = { id: "accepted", appId: "certreporter", domainRelease: "certreporter/v1", digest: "digest", acceptedAt: "", capabilities: ids.map((id) => ({ id, kind: id.startsWith("report.update") || id === "report-type.update-draft" ? "command" : "query", title: id, description: "", inputSchema: {}, outputSchema: {} })) };
  const app: CertReporterPort = { identity: async () => ({ appId: "certreporter", appUserId: "author", email: "author@example.com", displayName: "Author" }), catalog: async () => catalog, openApi: async () => ({}), reportContext: async (_token, reportId) => ({ resource: { namespace: "certreporter", resourceType: "report", resourceId: reportId, revision: "1" } }), query: async () => ({}), submitCommand: async () => ({ status: "rejected" }), receipt: async () => undefined };
  const availableKnowledge: string[][] = [];
  const agents: AgentRunnerPort = { runWork: async (input) => { availableKnowledge.push(input.availableDocumentIds); return { text: "The report needs an evidence location." }; } };
  const calls: Array<{ lens: string; evidenceIds: string[]; tools?: unknown }> = [];
  const reflectionAgent: ReflectionAgentPort = { analyze: async (input) => {
    calls.push({ lens: input.lens.id, evidenceIds: input.evidence.map((event) => event.id) });
    const citedEventIds = input.evidence.map((event) => event.id);
    if (input.lens.id === "api-suggestion") return { outcome: "api-suggestion", analysis: "A narrower evidence lookup would help.", attribution: "The selected completed Turn requested a source location.", citedEventIds, suggestionMarkdown: "# Proposed report evidence lookup\n\nSource event: " + citedEventIds[0] + "\n\nCandidate query: report.evidence-location.\n" };
    if (input.lens.id === "delegation-gap") {
      const path = "work-definitions/report-authoring/method.md";
      return { outcome: "proposal", analysis: "Keep source locations with extracted facts.", attribution: "The selected Turn exposed an evidence-location gap.", citedEventIds, edits: [{ path, content: input.documents.find((document) => document.path === path)!.content + "\n\nRecord the source location with every extracted fact.\n" }] };
    }
    const stableId = input.reflectionId.replaceAll("_", "-");
    return { outcome: "proposal", analysis: "Preserve a reusable evidence-location note.", attribution: "The selected Turn exposed an evidence-location gap.", citedEventIds, edits: [{ path: `subject-knowledge/${stableId}.md`, content: `---\nid: ${stableId}\ntitle: Evidence location\nsummary: Record the source location for report facts.\ntopics: [evidence]\n---\n\nKeep the source location with each extracted fact.\n` }] };
  } };
  const runtime = new ForgeRuntime(config);
  const compose = (source: ForgeRuntime) => new ForgeUseCases({ accounts: source.db, works: source.db, om: source.om, certReporter: app, catalogs: source.db, agents, reflectionAgent, sessions: new InMemoryAppSessionStore(), passwordSetups: new InMemoryPasswordSetupStore(), passwordCodec: { hash: hashPassword, verify: verifyPassword }, trajectories: source.trajectories, system: systemPort, initialAdminEmails: config.initialAdminEmails });
  try {
    const author = runtime.db.ensureUser("author@example.com", false);
    const other = runtime.db.ensureUser("other@example.com", false);
    const admin = runtime.db.ensureUser("admin@example.com", true);
    runtime.db.saveCandidate(catalog, { paths: {} }); runtime.db.accept("certreporter", catalog.digest, admin.id);
    const useCases = compose(runtime);
    const session = await useCases.bootstrap({ token: "token", reportId: "report-1" });
    const turn = await useCases.startTurn(session.ticket, "Find the missing evidence location");
    const events = await runtime.trajectories.read(session.work.id);
    const evidenceId = events.find((event) => event.type === "turn.completed")!.id;
    const headBefore = runtime.om.head(`users/${author.id}`);
    await assert.rejects(() => useCases.startReflection(other.id, session.work.id, "domain-knowledge", "Learn", [evidenceId]), /WorkNotOwned/);
    await assert.rejects(() => useCases.startReflection(author.id, session.work.id, "domain-knowledge", "Learn", ["evt_other"]), /ReflectionEvidenceMismatch/);
    assert.deepEqual(await useCases.reflectionsForWork(author.id, session.work.id), []);
    const empty = await useCases.startReflection(author.id, session.work.id, "domain-knowledge", "What can we learn?", []);
    assert.equal(empty.reflection.status, "insufficient_evidence"); assert.equal(empty.proposal, undefined);
    assert.equal(calls.length, 0);
    const domainA = await useCases.startReflection(author.id, session.work.id, "domain-knowledge", "Learn from the event", [evidenceId]);
    const domainB = await useCases.startReflection(author.id, session.work.id, "domain-knowledge", "Find another reusable note", [evidenceId]);
    assert.ok(domainA.proposal && domainB.proposal);
    assert.notEqual(domainA.proposal.worktreePath, domainB.proposal.worktreePath);
    assert.notEqual(domainA.proposal.branchRef, domainB.proposal.branchRef);
    assert.ok((await useCases.personalProposal(author.id, domainA.proposal.id)).changedPaths.includes("work-definitions/report-authoring/work.yml"));
    assert.equal(runtime.om.head(`users/${author.id}`), headBefore);
    const delegation = await useCases.startReflection(author.id, session.work.id, "delegation-gap", "Improve the method", [evidenceId]);
    assert.ok(delegation.proposal);
    assert.deepEqual((await useCases.personalProposal(author.id, delegation.proposal!.id)).changedPaths, ["work-definitions/report-authoring/method.md"]);
    const suggestion = await useCases.startReflection(author.id, session.work.id, "api-suggestion", "Suggest a query", [evidenceId]);
    assert.equal(suggestion.proposal, undefined);
    assert.match(await useCases.reflectionSuggestion(author.id, suggestion.reflection.id), /report\.evidence-location/);
    await assert.rejects(() => useCases.reflectionSuggestion(other.id, suggestion.reflection.id), /Forbidden/);
    assert.equal((await runtime.db.accepted("certreporter"))?.digest, catalog.digest);
    assert.equal((await useCases.reflectionDetail(admin.id, suggestion.reflection.id)).reflection.ownerUserId, author.id);
    await assert.rejects(() => useCases.continueReflection(admin.id, suggestion.reflection.id, "Change it"), /ReflectionNotOwned/);
    const beforeLens = (await useCases.reflectionDetail(author.id, domainA.reflection.id)).reflection;
    await assert.rejects(() => useCases.updateReflectionLens(author.id, "domain-knowledge", false, "New prompt"), /Forbidden/);
    const changedLens = await useCases.updateReflectionLens(admin.id, "domain-knowledge", false, "New prompt");
    assert.equal(changedLens.version, beforeLens.lensVersion + 1);
    await assert.rejects(() => useCases.startReflection(author.id, session.work.id, "domain-knowledge", "Try disabled lens", [evidenceId]), /ReflectionLensDisabled/);
    assert.equal((await useCases.reflectionDetail(author.id, domainA.reflection.id)).reflection.lensVersion, beforeLens.lensVersion);
    const reviewed = await useCases.reviewPersonalProposal(author.id, domainA.proposal!.id);
    const adopted = await useCases.adoptPersonalProposal(author.id, domainA.proposal!.id, "Capture evidence location", reviewed.reviewedRevision);
    assert.notEqual(adopted.revision, headBefore);
    await assert.rejects(() => useCases.adoptPersonalProposal(author.id, domainB.proposal!.id, "Stale", "not-reviewed"), /ProposalReviewRequired/);
    const nextTurn = await useCases.startTurn(session.ticket, "Read the updated OM");
    assert.equal(nextTurn.turn.omRevision, adopted.revision);
    assert.equal(turn.turn.omRevision, headBefore);
    assert.ok(availableKnowledge[1].includes(domainA.reflection.id.replaceAll("_", "-")));
    assert.deepEqual(calls.map((call) => call.lens), ["domain-knowledge", "domain-knowledge", "delegation-gap", "api-suggestion"]);
    runtime.db.close();
    const restarted = new ForgeRuntime(config);
    try { const restored = compose(restarted); assert.equal((await restored.reflectionDetail(author.id, suggestion.reflection.id)).reflection.outcome, "api-suggestion"); assert.equal((await restored.reflectionDetail(author.id, domainA.reflection.id)).proposal?.status, "adopted"); }
    finally { restarted.db.close(); }
  } finally { rmSync(root, { recursive: true, force: true }); }
});
