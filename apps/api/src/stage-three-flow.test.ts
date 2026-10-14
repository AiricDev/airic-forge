import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { ForgeUseCases, type AgentRunnerPort, type CapabilityCatalog, type CertReporterPort } from "@airic-forge/domain";
import { hashPassword, verifyPassword } from "./auth.js";
import { InMemoryAppSessionStore } from "./app-session-store.js";
import type { ForgeConfig } from "./config.js";
import { InMemoryPasswordSetupStore } from "./password-setup-store.js";
import { ForgeRuntime } from "./runtime.js";
import { systemPort } from "./system-port.js";
import { createTestProposal } from "./test-proposal-fixture.js";

test("personal Proposals keep active HEAD stable until reviewed adoption; stale peer rebases and next Turn uses new HEAD", async () => {
  const root = mkdtempSync(join(tmpdir(), "airic-forge-stage-three-"));
  const config: ForgeConfig = { port: 0, projectDir: join(root, "project"), dataDir: join(root, "data"), seedProjectDir: resolve(process.cwd(), "../../seed/project"), webDistDir: join(root, "web"), certReporterUrl: "http://127.0.0.1:1", allowedOrigin: "http://localhost:5173", initialAdminEmails: new Set() };
  const ids = ["report.context", "report.read", "report.gaps", "report.update-master", "report.update-data", "report-type.context", "report-type.read", "report-type.list-published-standards", "report-type.preview", "report-type.update-draft"];
  const catalog: CapabilityCatalog = { id: "accepted", appId: "certreporter", domainRelease: "certreporter/v1", digest: "digest", acceptedAt: "", capabilities: ids.map((id) => ({ id, kind: id.startsWith("report.update") || id === "report-type.update-draft" ? "command" : "query", title: id, description: "", inputSchema: {}, outputSchema: {} })) };
  const app: CertReporterPort = {
    identity: async () => ({ appId: "certreporter", appUserId: "author", email: "author@example.com", displayName: "Author" }),
    catalog: async () => catalog, openApi: async () => ({}),
    reportContext: async (_token, reportId) => ({ resource: { namespace: "certreporter", resourceType: "report", resourceId: reportId, revision: "1" } }),
    query: async () => ({}), submitCommand: async () => ({ status: "rejected" }), receipt: async () => undefined,
  };
  const observedPolicies: string[] = [];
  const agents: AgentRunnerPort = { runWork: async ({ documents }) => { observedPolicies.push(documents.find((item) => item.id === "policy")?.content ?? ""); return { text: "Checked" }; } };
  const compose = (runtime: ForgeRuntime) => new ForgeUseCases({ accounts: runtime.db, works: runtime.db, om: runtime.om, certReporter: app, catalogs: runtime.db, agents, sessions: new InMemoryAppSessionStore(), passwordSetups: new InMemoryPasswordSetupStore(), passwordCodec: { hash: hashPassword, verify: verifyPassword }, trajectories: runtime.trajectories, system: systemPort, initialAdminEmails: config.initialAdminEmails });
  const runtime = new ForgeRuntime(config);
  try {
    const author = runtime.db.ensureUser("author@example.com", false);
    const other = runtime.db.ensureUser("other@example.com", false);
    runtime.om.ensureUserBranch(other.id);
    const useCases = compose(runtime);
    runtime.db.saveCandidate(catalog, { paths: {} }); runtime.db.accept("certreporter", catalog.digest, author.id);
    const session = await useCases.bootstrap({ token: "token", reportId: "report-1" });
    const oldTurn = await useCases.startTurn(session.ticket, "Read the current policy");
    const base = oldTurn.turn.omRevision;
    const first = createTestProposal(runtime, author.id, "Clarify policy", "Work report-1");
    const second = createTestProposal(runtime, author.id, "Clarify method", "Work report-1");
    assert.equal(first.baseRevision, base); assert.equal(second.baseRevision, base);
    await assert.rejects(() => useCases.personalProposal(other.id, first.id), /Forbidden/);
    await assert.rejects(() => useCases.writePersonalProposal(other.id, first.id, "work-definitions/report-authoring/policy.md", "bad"), /Forbidden/);
    const policyPath = "work-definitions/report-authoring/policy.md";
    const methodPath = "work-definitions/report-authoring/method.md";
    const policy = (await useCases.personalProposalFile(author.id, first.id, policyPath)).content;
    const method = (await useCases.personalProposalFile(author.id, second.id, methodPath)).content;
    await useCases.writePersonalProposal(author.id, first.id, policyPath, `${policy}\n\nStage 3 reviewed policy.\n`);
    await useCases.writePersonalProposal(author.id, second.id, methodPath, `${method}\n\nStage 3 reviewed method.\n`);
    assert.equal(runtime.om.head(`users/${author.id}`), base);
    assert.equal(runtime.om.head(`users/${other.id}`), runtime.om.head("main"));
    const firstReview = await useCases.reviewPersonalProposal(author.id, first.id);
    const secondReview = await useCases.reviewPersonalProposal(author.id, second.id);
    assert.match(firstReview.diff, /Stage 3 reviewed policy/);
    await assert.rejects(() => useCases.adoptPersonalProposal(author.id, first.id, "Adopt", "wrong-revision"), /ProposalReviewRequired/);
    const adoptedFirst = await useCases.adoptPersonalProposal(author.id, first.id, "Clarify policy", firstReview.reviewedRevision);
    assert.notEqual(adoptedFirst.revision, base);
    const history = await useCases.personalOmHistory(author.id, author.id);
    assert.equal(history[0]?.revision, adoptedFirst.revision);
    assert.ok(!history.some((item) => item.revision === firstReview.reviewedRevision));
    assert.equal((await useCases.personalOm(author.id, author.id, base)).revision, base);
    assert.doesNotMatch((await useCases.personalOmFile(author.id, author.id, policyPath, base)).content, /Stage 3 reviewed policy/);
    assert.match((await useCases.personalOmFile(author.id, author.id, policyPath, adoptedFirst.revision)).content, /Stage 3 reviewed policy/);
    await assert.rejects(() => useCases.personalOm(other.id, author.id, base), /Forbidden/);
    await assert.rejects(() => useCases.personalOm(author.id, author.id, "0".repeat(40)), /OmRevisionNotReachable/);
    await assert.rejects(() => useCases.personalOm(author.id, author.id, firstReview.reviewedRevision), /OmRevisionNotReachable/);
    await assert.rejects(() => useCases.adoptPersonalProposal(author.id, second.id, "Clarify method", secondReview.reviewedRevision), /ActiveRevisionChanged/);
    assert.equal((await useCases.personalProposal(author.id, second.id)).proposal.status, "open");
    const rebased = await useCases.rebasePersonalProposal(author.id, second.id);
    assert.equal(rebased.proposal.baseRevision, adoptedFirst.revision);
    assert.equal(rebased.proposal.reviewedRevision, undefined);
    const reviewedAgain = await useCases.reviewPersonalProposal(author.id, second.id);
    const adoptedSecond = await useCases.adoptPersonalProposal(author.id, second.id, "Clarify method", reviewedAgain.reviewedRevision);
    assert.notEqual(adoptedSecond.revision, adoptedFirst.revision);
    const newTurn = await useCases.startTurn(session.ticket, "Read the updated policy");
    assert.equal(newTurn.turn.omRevision, adoptedSecond.revision);
    assert.equal(oldTurn.turn.omRevision, base);
    assert.doesNotMatch(observedPolicies[0], /Stage 3 reviewed policy/);
    assert.match(observedPolicies[1], /Stage 3 reviewed policy/);
    const third = createTestProposal(runtime, author.id, "Add another WD", "Schema check");
    await useCases.writePersonalProposal(author.id, third.id, "subject-knowledge/inspection-guidance.md", `---\nid: inspection-guidance\ntitle: Inspection guidance\nsummary: Facts needed for inspection\ntopics: [inspection]\n---\n\nKeep source locations with report facts.\n`);
    await useCases.writePersonalProposal(author.id, third.id, "work-definitions/inspection-check/work.yml", `schemaVersion: 1\nid: inspection-check\ntitle: Inspection check\ndescription: Check report facts.\ncapabilities:\n  allowed: [report.read]\ndocuments: []\nknowledge:\n  bootstrap: []\n  available: [inspection-guidance]\ncompletion:\n  mode: user\n  requiredCapabilities: []\n`);
    const thirdReview = await useCases.reviewPersonalProposal(author.id, third.id);
    const adoptedThird = await useCases.adoptPersonalProposal(author.id, third.id, "Add inspection check", thirdReview.reviewedRevision);
    assert.equal(runtime.om.workDefinition(adoptedThird.revision, "inspection-check").title, "Inspection check");
    const invalid = createTestProposal(runtime, author.id, "Try invalid knowledge", "Validation gate");
    await useCases.writePersonalProposal(author.id, invalid.id, "subject-knowledge/invalid.md", "# Missing front matter\n");
    await assert.rejects(() => useCases.reviewPersonalProposal(author.id, invalid.id), /InvalidOperatingModel.*front matter/);
    assert.equal((await useCases.personalProposal(author.id, invalid.id)).proposal.reviewedRevision, undefined);
    assert.equal(runtime.om.head(`users/${author.id}`), adoptedThird.revision);
    const userWorkspace = runtime.om.ensureUserBranch(author.id).worktree;
    writeFileSync(join(userWorkspace, policyPath), `${readFileSync(join(userWorkspace, policyPath), "utf8")}\nExternal HEAD commit.\n`);
    const external = spawnSync("git", ["-c", "user.name=External Editor", "-c", "user.email=external@localhost", "add", policyPath], { cwd: userWorkspace, encoding: "utf8" });
    assert.equal(external.status, 0, external.stderr);
    const committed = spawnSync("git", ["-c", "user.name=External Editor", "-c", "user.email=external@localhost", "commit", "-m", "External policy edit"], { cwd: userWorkspace, encoding: "utf8" });
    assert.equal(committed.status, 0, committed.stderr);
    const externalHead = runtime.om.head(`users/${author.id}`);
    assert.notEqual(externalHead, adoptedThird.revision);
    const externalTurn = await useCases.startTurn(session.ticket, "Read the external policy change");
    assert.equal(externalTurn.turn.omRevision, externalHead);
    assert.match(observedPolicies[2], /External HEAD commit/);
    runtime.db.close();
    const restarted = new ForgeRuntime(config);
    try {
      const restored = compose(restarted);
      assert.equal((await restored.personalProposal(author.id, second.id)).proposal.status, "adopted");
      assert.equal((await restored.workHistory(author.id, session.work.id)).turns[0].omRevision, base);
      assert.equal(restarted.om.head(`users/${author.id}`), externalHead);
    } finally { restarted.db.close(); }
  } finally { rmSync(root, { recursive: true, force: true }); }
});
