import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { ForgeUseCases, type AgentRunnerPort, type AppPort, type ReflectionAgentPort } from "@airic-forge/domain";
import { testCatalog, acknowledgeCheckpoint } from "./certlab-test-catalog.js";
import { hashPassword, verifyPassword } from "./auth.js";
import { InMemoryAppSessionStore } from "./app-session-store.js";
import { InMemoryPasswordSetupStore } from "./password-setup-store.js";
import type { ForgeConfig } from "./config.js";
import { ForgeRuntime } from "./runtime.js";
import { systemPort } from "./system-port.js";

test("three Reflection lenses preserve evidence and version, create only supported outcomes, and keep concurrent worktrees separate", async () => {
  const root = mkdtempSync(join(tmpdir(), "airic-forge-stage-four-"));
  const config: ForgeConfig = { port: 0, projectDir: join(root, "project"), dataDir: join(root, "data"), seedProjectDir: resolve(process.cwd(), "../../seed/certlab"), webDistDir: join(root, "web"), certLabUrl: "http://127.0.0.1:1", organizationId: "synthetic-org", allowedOrigin: "http://localhost:5173", initialAdminEmails: new Set() };
  const catalog = testCatalog("digest");
  const app: AppPort = { identity: async () => ({ appId: "certlab", appUserId: "author", email: "author@example.com", displayName: "Author" }), catalog: async () => catalog, openApi: async () => ({}), reportContext: async (_token, reportId) => ({ resource: { namespace: "certlab", resourceType: "report", resourceId: reportId } }), query: async () => ({}), submitCommand: async () => ({ status: "rejected" }), receipt: async () => undefined };
  const availableKnowledge: string[][] = [];
  const agents: AgentRunnerPort = { runWork: async (input) => { availableKnowledge.push(input.availableDocumentIds); return { text: "The report needs an evidence location." }; } };
  const calls: Array<{ lens: string; evidenceIds: string[]; draftPaths: string[] }> = [];
  const reflectionAgent: ReflectionAgentPort = { analyze: async (input) => {
    const page = await input.readTrajectory?.(0, 20) ?? [];
    const citedEventIds = [(page.find((event) => event.type === "turn.completed") ?? page[0])?.id].filter((id): id is string => Boolean(id));
    calls.push({ lens: input.lens.id, evidenceIds: citedEventIds, draftPaths: input.privateDrafts?.map((draft) => draft.path) ?? [] });
    if (input.lens.id === "api-suggestion") return { outcome: "api-suggestion", analysis: "A narrower evidence lookup would help.", attribution: "The selected completed Turn requested a source location.", citedEventIds, suggestionMarkdown: "# Proposed report evidence lookup\n\nSource event: " + citedEventIds[0] + "\n\nCandidate query: report.evidence-location.\n" };
    if (input.lens.id === "delegation-gap") {
      const path = "work-definitions/report-authoring/method.md";
      return { outcome: "proposal", analysis: "Keep source locations with extracted facts.", attribution: "The selected Turn exposed an evidence-location gap.", citedEventIds, edits: [{ path, content: input.documents.find((document) => document.path === path)!.content + "\n\nRecord the source location with every extracted fact.\n" }] };
    }
    const stableId = input.reflectionId.replaceAll("_", "-");
    return { outcome: "proposal", analysis: "Preserve a reusable evidence-location note.", attribution: "The selected Turn exposed an evidence-location gap.", citedEventIds, edits: [{ path: `subject-knowledge/${stableId}.md`, content: `---\nid: ${stableId}\ntitle: Evidence location\nsummary: Record the source location for report facts.\ntopics: [evidence]\n---\n\nKeep the source location with each extracted fact.\n` }] };
  } };
  const runtime = new ForgeRuntime(config);
  const compose = (source: ForgeRuntime) => new ForgeUseCases({ accounts: source.db, works: source.db, om: source.om, omDrafts: source.db, app, catalogs: source.db, agents, reflectionAgent, sessions: new InMemoryAppSessionStore(), passwordSetups: new InMemoryPasswordSetupStore(), passwordCodec: { hash: hashPassword, verify: verifyPassword }, trajectories: source.trajectories, system: systemPort, initialAdminEmails: config.initialAdminEmails });
  try {
    const author = runtime.db.ensureUser("author@example.com", false);
    const other = runtime.db.ensureUser("other@example.com", false);
    const admin = runtime.db.ensureUser("admin@example.com", true);
    runtime.db.saveCandidate(catalog, { paths: {} }); runtime.db.accept("certlab", catalog.digest, admin.id);
    const useCases = compose(runtime);
    const openWork = async (reportId: string) => {
      const session = await useCases.bootstrap({ token: "token", reportId, goal: "Find evidence location" });
      await useCases.startTurn(session.ticket, "Find the missing evidence location");
      return session;
    };
    const session = await openWork("report-1");
    const turn = (await useCases.workHistory(author.id, session.work.id)).turns[0];
    const headBefore = runtime.om.head(`users/${author.id}`);
    await assert.rejects(() => useCases.startReflectionConversation(other.id, session.work.id, "/domain-knowledge Learn"), /WorkNotOwned/);
    await assert.rejects(() => useCases.startReflectionConversation(author.id, session.work.id, "/unknown Learn"), /UnknownReflectionLens/);
    assert.deepEqual(await useCases.reflectionsForWork(author.id, session.work.id), []);
    const domainA = await useCases.startReflectionConversation(author.id, session.work.id, "/domain-knowledge Learn from the event");
    const secondWork = await openWork("report-2");
    const domainB = await useCases.startReflectionConversation(author.id, secondWork.work.id, "/domain-knowledge Find another reusable note");
    assert.ok(domainA.proposal && domainB.proposal);
    assert.equal((await useCases.reflectionsForWork(author.id, session.work.id)).length, 1);
    assert.notEqual(domainA.proposal.worktreePath, domainB.proposal.worktreePath);
    assert.notEqual(domainA.proposal.branchRef, domainB.proposal.branchRef);
    assert.ok((await useCases.personalProposal(author.id, domainA.proposal.id)).changedPaths.includes("work-definitions/report-authoring/work.yml"));
    assert.equal(runtime.om.head(`users/${author.id}`), headBefore);
    const delegationWork = await openWork("report-3");
    const methodPath = "work-definitions/report-authoring/method.md";
    const originalMethod = (await useCases.personalOmFile(author.id, author.id, methodPath)).content;
    await useCases.savePersonalOmDraft(author.id, author.id, methodPath, `${originalMethod}\n\nA private idea for the method.\n`, headBefore);
    const delegation = await useCases.startReflectionConversation(author.id, delegationWork.work.id, "/delegation-gap Improve the method");
    assert.ok(calls.some((call) => call.lens === "delegation-gap" && call.draftPaths.includes(methodPath)));
    assert.ok(delegation.proposal);
    assert.deepEqual((await useCases.personalProposal(author.id, delegation.proposal!.id)).changedPaths, ["work-definitions/report-authoring/method.md"]);
    await assert.rejects(() => useCases.abandonPersonalProposal(other.id, delegation.proposal!.id), /Forbidden/);
    const abandoned = await useCases.abandonPersonalProposal(author.id, delegation.proposal!.id);
    assert.equal(abandoned.proposal.status, "abandoned");
    assert.equal((await useCases.reflectionDetail(author.id, delegation.reflection.id)).reflection.status, "abandoned");
    await assert.rejects(() => useCases.reviewPersonalProposal(author.id, delegation.proposal!.id), /ProposalNotEditable/);
    assert.equal(runtime.om.head(`users/${author.id}`), headBefore);
    const suggestionWork = await openWork("report-4");
    const suggestion = await useCases.startReflectionConversation(author.id, suggestionWork.work.id, "/api-suggestion Suggest a query");
    assert.equal(suggestion.proposal, undefined);
    assert.match(await useCases.reflectionSuggestion(author.id, suggestion.reflection.id), /report\.evidence-location/);
    await assert.rejects(() => useCases.reflectionSuggestion(other.id, suggestion.reflection.id), /Forbidden/);
    assert.equal((await runtime.db.accepted("certlab"))?.digest, catalog.digest);
    assert.equal((await useCases.reflectionDetail(admin.id, suggestion.reflection.id)).reflection.ownerUserId, author.id);
    await assert.rejects(() => useCases.continueReflection(admin.id, suggestion.reflection.id, "Change it"), /ReflectionNotOwned/);
    const beforeLens = (await useCases.reflectionDetail(author.id, domainA.reflection.id)).reflection;
    await assert.rejects(() => useCases.updateReflectionLens(author.id, "domain-knowledge", false, "New prompt"), /Forbidden/);
    const changedLens = await useCases.updateReflectionLens(admin.id, "domain-knowledge", false, "New prompt");
    assert.equal(changedLens.version, beforeLens.lensVersion + 1);
    const disabledWork = await openWork("report-5");
    await assert.rejects(() => useCases.startReflectionConversation(author.id, disabledWork.work.id, "/domain-knowledge Try disabled lens"), /ReflectionLensDisabled/);
    assert.equal((await useCases.reflectionsForWork(author.id, disabledWork.work.id)).length, 0);
    assert.equal((await useCases.reflectionDetail(author.id, domainA.reflection.id)).reflection.lensVersion, beforeLens.lensVersion);
    const reviewed = await useCases.reviewPersonalProposal(author.id, domainA.proposal!.id);
    const adopted = await useCases.adoptPersonalProposal(author.id, domainA.proposal!.id, "Capture evidence location", reviewed.reviewedRevision);
    assert.notEqual(adopted.revision, headBefore);
    assert.equal((await useCases.reflectionDetail(author.id, domainA.reflection.id)).reflection.status, "completed");
    await assert.rejects(() => useCases.continueReflection(author.id, domainA.reflection.id, "Keep talking"), /ReflectionClosed/);
    await assert.rejects(() => useCases.adoptPersonalProposal(author.id, domainB.proposal!.id, "Stale", "not-reviewed"), /ProposalReviewRequired/);
    await acknowledgeCheckpoint(useCases, session.ticket);
    const nextTurn = await useCases.startTurn(session.ticket, "Read the updated OM");
    assert.equal(nextTurn.turn.omRevision, adopted.revision);
    assert.equal(turn?.omRevision, headBefore);
    assert.ok(availableKnowledge.at(-1)?.includes(domainA.reflection.id.replaceAll("_", "-")));
    assert.deepEqual(calls.map((call) => call.lens), ["domain-knowledge", "domain-knowledge", "delegation-gap", "api-suggestion"]);
    runtime.db.close();
    const restarted = new ForgeRuntime(config);
    try { const restored = compose(restarted); assert.equal((await restored.reflectionDetail(author.id, suggestion.reflection.id)).reflection.outcome, "api-suggestion"); assert.equal((await restored.reflectionDetail(author.id, domainA.reflection.id)).proposal?.status, "adopted"); }
    finally { restarted.db.close(); }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("Reflection conversation starts with a message and reads only its Work trajectory through a bounded resource", async () => {
  const root = mkdtempSync(join(tmpdir(), "airic-forge-reflection-chat-"));
  const config: ForgeConfig = { port: 0, projectDir: join(root, "project"), dataDir: join(root, "data"), seedProjectDir: resolve(process.cwd(), "../../seed/certlab"), webDistDir: join(root, "web"), certLabUrl: "http://127.0.0.1:1", organizationId: "synthetic-org", allowedOrigin: "http://localhost:5173", initialAdminEmails: new Set() };
  const runtime = new ForgeRuntime(config);
  const app: AppPort = { identity: async () => ({ appId: "certlab", appUserId: "author", email: "author@example.com", displayName: "Author" }), catalog: async () => testCatalog("digest"), openApi: async () => ({}), reportContext: async (_token, reportId) => ({ resource: { namespace: "certlab", resourceType: "report", resourceId: reportId } }), query: async () => ({}), submitCommand: async () => ({ status: "rejected" }), receipt: async () => undefined };
  const calls: Array<{ reflectionId: string; lens: string; messageCount: number }> = [];
  let citeWithoutReading = false;
  let previouslyReadEventId = "";
  const reflectionAgent: ReflectionAgentPort = { analyze: async (input) => {
    calls.push({ reflectionId: input.reflectionId, lens: input.lens.id, messageCount: input.messages.length });
    const page = citeWithoutReading ? [] : await input.readTrajectory?.(0, 20) ?? [];
    const eventId = (page.find((event) => event.type === "turn.completed") ?? page[0])?.id;
    if (eventId) previouslyReadEventId = eventId;
    if (input.lens.id === "domain-knowledge") {
      await input.writeProposalFile?.(`subject-knowledge/${input.reflectionId.replaceAll("_", "-")}.md`, `---\nid: ${input.reflectionId.replaceAll("_", "-")}\ntitle: Source location\nsummary: Keep source locations.\ntopics: [evidence]\n---\n\nKeep the source location.\n`, [eventId ?? previouslyReadEventId], "Record source location with each extracted fact");
      return { outcome: "proposal", analysis: "Keep source locations.", attribution: "The Work needed source locations.", proposalMessage: "Record source location with each extracted fact", citedEventIds: [eventId ?? previouslyReadEventId], edits: [] };
    }
    return { outcome: "analysis", analysis: "We can discuss this Work.", attribution: "", citedEventIds: eventId ? [eventId] : [] };
  } };
  const useCases = new ForgeUseCases({ accounts: runtime.db, works: runtime.db, om: runtime.om, app, catalogs: runtime.db, agents: { runWork: async () => ({ text: "Done" }) }, reflectionAgent, sessions: new InMemoryAppSessionStore(), passwordSetups: new InMemoryPasswordSetupStore(), passwordCodec: { hash: hashPassword, verify: verifyPassword }, trajectories: runtime.trajectories, system: systemPort, initialAdminEmails: config.initialAdminEmails });
  try {
    const author = runtime.db.ensureUser("author@example.com", false);
    const other = runtime.db.ensureUser("other@example.com", false);
    const catalog = await app.catalog("token");
    runtime.db.saveCandidate(catalog, { paths: {} }); runtime.db.accept("certlab", catalog.digest, author.id);
    const session = await useCases.bootstrap({ token: "token", reportId: "report-1", goal: "Find evidence location" });
    await useCases.startTurn(session.ticket, "Find the source location");
    await assert.rejects(() => useCases.startReflectionConversation(other.id, session.work.id, "Discuss the Work"), /WorkNotOwned/);
    await assert.rejects(() => useCases.startReflectionConversation(author.id, session.work.id, "/unknown Analyze"), /UnknownReflectionLens/);
    assert.deepEqual(await useCases.reflectionsForWork(author.id, session.work.id), []);
    const opened = await useCases.openWorkReflection(author.id, session.work.id);
    assert.equal(opened.messages.length, 1);
    assert.equal(opened.messages[0]?.role, "agent");
    assert.equal((await useCases.openWorkReflection(author.id, session.work.id)).reflection.id, opened.reflection.id);
    const first = await useCases.startReflectionConversation(author.id, session.work.id, "Discuss the Work");
    assert.equal(first.reflection.id, opened.reflection.id);
    assert.equal(first.messages.length, 3);
    assert.equal(first.reflection.lensId, "conversation");
    assert.equal(first.reflection.status, "active");
    assert.equal(first.proposal, undefined);
    const second = await useCases.continueReflection(author.id, first.reflection.id, "/domain-knowledge Save the lesson");
    assert.equal(second.messages.length, 5);
    assert.equal(second.reflection.lensId, "domain-knowledge");
    assert.ok(second.reflection.evidenceEventIds.length > 0);
    assert.equal(second.messages.at(-1)?.lensId, "domain-knowledge");
    assert.equal(second.messages.at(-1)?.lensVersion, 1);
    assert.equal(second.proposal?.reason, "Record source location with each extracted fact");
    assert.equal(calls[0].reflectionId, calls[1].reflectionId);
    assert.deepEqual(calls.map((call) => call.lens), ["conversation", "domain-knowledge"]);
    assert.deepEqual(calls.map((call) => call.messageCount), [2, 4]);
    citeWithoutReading = true;
    await assert.rejects(() => useCases.continueReflection(author.id, first.reflection.id, "/domain-knowledge Try without reading"), /ReflectionEvidenceMismatch/);
    assert.equal((await useCases.reflectionDetail(author.id, first.reflection.id)).messages.filter((message) => message.role === "user").length, 3);
    runtime.db.updateLens("domain-knowledge", false, "Disabled");
    await assert.rejects(() => useCases.continueReflection(author.id, first.reflection.id, "/domain-knowledge Try disabled"), /ReflectionLensDisabled/);
    const reviewed = await useCases.reviewPersonalProposal(author.id, second.proposal!.id);
    const adopted = await useCases.adoptPersonalProposal(author.id, second.proposal!.id, "A separate title", reviewed.reviewedRevision);
    assert.equal(adopted.title, "Record source location with each extracted fact");
  } finally { runtime.db.close(); rmSync(root, { recursive: true, force: true }); }
});
