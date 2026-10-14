import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { ForgeUseCases } from "@airic-forge/domain";
import { testCatalog } from "./certlab-test-catalog.js";
import { ForgeRuntime } from "./runtime.js";
import type { ForgeConfig } from "./config.js";
import { buildServer } from "./server.js";
import { createTestProposal } from "./test-proposal-fixture.js";

test("administrator selectively accepts personal OM and member sync preserves old HEAD", async () => {
  const root = mkdtempSync(join(tmpdir(), "airic-forge-stage-six-"));
  const config: ForgeConfig = { port: 0, projectDir: join(root, "project"), dataDir: join(root, "data"), seedProjectDir: resolve(process.cwd(), "../../seed/certlab"), webDistDir: join(root, "web"), certLabUrl: "http://127.0.0.1:1", organizationId: "synthetic-org", allowedOrigin: "http://localhost:5173", initialAdminEmails: new Set() };
  const runtime = new ForgeRuntime(config);
  try {
    const admin = runtime.db.ensureUser("admin@example.com", true);
    const author = runtime.db.ensureUser("author@example.com", false);
    const member = runtime.db.ensureUser("member@example.com", false);
    const catalog = testCatalog();
    runtime.db.saveCandidate(catalog, { paths: {} }); runtime.db.accept("certlab", catalog.digest, admin.id);
    const useCases: ForgeUseCases = runtime.useCases;
    const authorBranch = runtime.om.ensureUserBranch(author.id);
    const memberBranch = runtime.om.ensureUserBranch(member.id);
    const initialMain = runtime.om.head("main");
    const oldMemberHead = runtime.om.head(memberBranch.branch);
    const source = createTestProposal(runtime, author.id, "Improve policy and method", "Work reference");
    const policyPath = "work-definitions/report-authoring/policy.md";
    const methodPath = "work-definitions/report-authoring/method.md";
    await useCases.writePersonalProposal(author.id, source.id, policyPath, runtime.om.document(source.baseRevision, policyPath) + "\n\nShared organization policy.\n");
    await useCases.writePersonalProposal(author.id, source.id, methodPath, runtime.om.document(source.baseRevision, methodPath) + "\n\nPrivate author method.\n");
    const sourceReview = await useCases.reviewPersonalProposal(author.id, source.id);
    const authorRevision = (await useCases.adoptPersonalProposal(author.id, source.id, "Author improvement", sourceReview.reviewedRevision)).revision;
    assert.equal(runtime.om.head("main"), initialMain);
    await assert.rejects(() => useCases.compareOrganizationSource(member.id, author.id), /Forbidden/);
    const comparison = await useCases.compareOrganizationSource(admin.id, author.id);
    assert.deepEqual(comparison.changedPaths.sort(), [methodPath, policyPath]);
    const contribution = await useCases.createOrganizationContribution(admin.id, author.id, "Share policy only", "Work reference");
    await assert.rejects(() => useCases.organizationContribution(member.id, contribution.id), /Forbidden/);
    const reviewed = await useCases.reviewOrganizationContribution(admin.id, contribution.id, [policyPath]);
    assert.ok(reviewed.reviewedRevision);
    assert.equal(runtime.om.head("main"), initialMain);
    const accepted = await useCases.acceptOrganizationContribution(admin.id, contribution.id, reviewed.reviewedRevision!);
    assert.equal((await useCases.acceptOrganizationContribution(admin.id, contribution.id, reviewed.reviewedRevision!)).revision, accepted.revision);
    assert.match(runtime.om.document(accepted.revision, policyPath), /Shared organization policy/);
    assert.doesNotMatch(runtime.om.document(accepted.revision, methodPath), /Private author method/);
    assert.equal(runtime.om.head(authorBranch.branch), authorRevision);
    assert.equal(runtime.om.head(memberBranch.branch), oldMemberHead);
    assert.ok((await useCases.organizationOm(member.id)).files.includes(policyPath));
    assert.match((await useCases.organizationOmFile(member.id, policyPath)).content, /Shared organization policy/);
    assert.match(runtime.om.document(accepted.revision, policyPath), /Shared organization policy/);
    const sync = await useCases.createOrganizationSync(member.id);
    assert.equal(runtime.om.head(memberBranch.branch), oldMemberHead);
    assert.equal(sync.proposal.upstreamRevision, accepted.revision);
    const syncReview = await useCases.reviewPersonalProposal(member.id, sync.proposal.id);
    const synced = await useCases.adoptPersonalProposal(member.id, sync.proposal.id, "Sync organization", syncReview.reviewedRevision);
    assert.match(runtime.om.document(synced.revision, policyPath), /Shared organization policy/);
    assert.equal(runtime.om.containsRevision(memberBranch.branch, oldMemberHead), true);
    assert.equal(runtime.om.includesRevision(memberBranch.branch, accepted.revision), true);
    assert.equal((await useCases.personalOm(member.id, member.id, oldMemberHead)).revision, oldMemberHead);
    await assert.rejects(() => useCases.createOrganizationSync(member.id), /OrganizationAlreadyCurrent/);
    const work = runtime.db.createWork(member.id, "certlab", "report-authoring", "report-1");
    await assert.rejects(() => useCases.addWorkFeedback(author.id, work.id, "avoidable-correction", "Wrong owner"), /Forbidden/);
    await useCases.addWorkFeedback(member.id, work.id, "required-human-decision", "Report approval belongs to a human");
    await useCases.addWorkFeedback(member.id, work.id, "avoidable-correction", "I had to repeat the evidence location");
    assert.equal((await useCases.workFeedback(member.id, work.id)).length, 2);
    await assert.rejects(() => useCases.measurementBaseline(member.id), /Forbidden/);
    const baseline = await useCases.measurementBaseline(admin.id);
    assert.equal(baseline.activity.acceptedOrganizationContributions, 1);
    assert.equal(baseline.activity.synchronizedProposals, 1);
    assert.equal(baseline.feedback["required-human-decision"], 1);
    assert.equal(baseline.feedback["avoidable-correction"], 1);
  } finally { runtime.db.close(); rmSync(root, { recursive: true, force: true }); }
});

test("a reviewed organization candidate cannot overwrite a newer main HEAD", async () => {
  const root = mkdtempSync(join(tmpdir(), "airic-forge-stage-six-stale-"));
  const config: ForgeConfig = { port: 0, projectDir: join(root, "project"), dataDir: join(root, "data"), seedProjectDir: resolve(process.cwd(), "../../seed/certlab"), webDistDir: join(root, "web"), certLabUrl: "http://127.0.0.1:1", organizationId: "synthetic-org", allowedOrigin: "http://localhost:5173", initialAdminEmails: new Set() };
  const runtime = new ForgeRuntime(config);
  try {
    const author = runtime.db.ensureUser("author@example.com", false);
    const user = runtime.om.ensureUserBranch(author.id);
    const first = runtime.om.createProposal(author.id, "a", runtime.om.head(user.branch));
    const path = "work-definitions/report-authoring/policy.md";
    runtime.om.writeProposalFile(first.worktree, path, runtime.om.document(runtime.om.head(user.branch), path) + "\nAuthor rule.\n");
    runtime.om.commitProposal(first.worktree, "Author rule");
    runtime.om.adoptProposal(user.branch, user.worktree, first.branch, runtime.om.head("main"), {});
    const main = runtime.om.head("main");
    const source = runtime.om.head(user.branch);
    const candidate = runtime.om.prepareContribution("stale", source, runtime.om.divergence(source, main).baseRevision, main, [path], "Selected policy");
    const second = runtime.om.prepareContribution("advance", source, runtime.om.divergence(source, main).baseRevision, main, [path], "Advance main");
    runtime.om.acceptContribution(second.branch, main);
    assert.throws(() => runtime.om.acceptContribution(candidate.branch, main), /OrganizationReviewStale/);
  } finally { runtime.db.close(); rmSync(root, { recursive: true, force: true }); }
});

test("organization sync conflict stays in proposal until member resolves and adopts it", () => {
  const root = mkdtempSync(join(tmpdir(), "airic-forge-stage-six-conflict-"));
  const config: ForgeConfig = { port: 0, projectDir: join(root, "project"), dataDir: join(root, "data"), seedProjectDir: resolve(process.cwd(), "../../seed/certlab"), webDistDir: join(root, "web"), certLabUrl: "http://127.0.0.1:1", organizationId: "synthetic-org", allowedOrigin: "http://localhost:5173", initialAdminEmails: new Set() };
  const runtime = new ForgeRuntime(config);
  try {
    const author = runtime.om.ensureUserBranch("author");
    const member = runtime.om.ensureUserBranch("member");
    const base = runtime.om.head("main");
    const path = "work-definitions/report-authoring/policy.md";
    const original = runtime.om.document(base, path);
    const authorDraft = runtime.om.createProposal("author", "author-conflict", base);
    runtime.om.writeProposalFile(authorDraft.worktree, path, `${original}\nOrganization wording.\n`);
    runtime.om.commitProposal(authorDraft.worktree, "Organization wording");
    runtime.om.adoptProposal(author.branch, author.worktree, authorDraft.branch, base, {});
    const candidate = runtime.om.prepareContribution("conflict-main", runtime.om.head(author.branch), base, base, [path], "Organization wording");
    const mainRevision = runtime.om.acceptContribution(candidate.branch, base);
    const memberDraft = runtime.om.createProposal("member", "member-conflict", base);
    runtime.om.writeProposalFile(memberDraft.worktree, path, `${original}\nMember wording.\n`);
    runtime.om.commitProposal(memberDraft.worktree, "Member wording");
    const personalRevision = runtime.om.adoptProposal(member.branch, member.worktree, memberDraft.branch, base, {});
    const sync = runtime.om.createProposal("member", "sync-conflict", personalRevision);
    assert.throws(() => runtime.om.synchronizeProposal(sync.worktree, personalRevision, mainRevision), /ProposalRebaseConflict/);
    assert.equal(runtime.om.head(member.branch), personalRevision);
    assert.deepEqual(runtime.om.proposalConflicts(sync.worktree), [path]);
    runtime.om.writeProposalFile(sync.worktree, path, `${original}\nOrganization wording.\nMember wording.\n`);
    runtime.om.synchronizeProposal(sync.worktree, personalRevision, mainRevision);
    assert.deepEqual(runtime.om.proposalConflicts(sync.worktree), []);
    const synced = runtime.om.adoptSynchronizedProposal(member.branch, member.worktree, sync.branch, personalRevision, mainRevision, {});
    assert.match(runtime.om.document(synced, path), /Organization wording\.\nMember wording/);
    assert.equal(runtime.om.containsRevision(member.branch, personalRevision), true);
  } finally { runtime.db.close(); rmSync(root, { recursive: true, force: true }); }
});

test("organization HTTP routes expose main to members while keeping private evidence and baseline administrative", async () => {
  const root = mkdtempSync(join(tmpdir(), "airic-forge-stage-six-http-"));
  const config: ForgeConfig = { port: 0, projectDir: join(root, "project"), dataDir: join(root, "data"), seedProjectDir: resolve(process.cwd(), "../../seed/certlab"), webDistDir: join(root, "web"), certLabUrl: "http://127.0.0.1:1", organizationId: "synthetic-org", allowedOrigin: "http://localhost:5173", initialAdminEmails: new Set() };
  const runtime = new ForgeRuntime(config);
  const app = buildServer(runtime);
  try {
    const admin = runtime.db.ensureUser("admin@example.com", true);
    const author = runtime.db.ensureUser("author@example.com", false);
    const reader = runtime.db.ensureUser("reader@example.com", false);
    for (const user of [admin, author, reader]) runtime.om.ensureUserBranch(user.id);
    const work = runtime.db.createWork(author.id, "certlab", "report-authoring", "report-1");
    const cookie = (id: string) => ({ cookie: `forge_session=${runtime.webSessions.issue(id)}` });
    const readerHeaders = cookie(reader.id);
    const adminHeaders = cookie(admin.id);
    assert.equal((await app.inject({ method: "GET", url: "/api/v1/om/organization" })).statusCode, 401);
    assert.equal((await app.inject({ method: "GET", url: "/api/v1/om/organization", headers: readerHeaders })).statusCode, 200);
    assert.equal((await app.inject({ method: "GET", url: "/api/v1/om/organization/history", headers: readerHeaders })).statusCode, 200);
    assert.equal((await app.inject({ method: "GET", url: "/api/v1/om/organization/file?path=work-definitions%2Freport-authoring%2Fwork.yml", headers: readerHeaders })).statusCode, 200);
    assert.equal((await app.inject({ method: "GET", url: `/api/v1/works/${work.id}`, headers: readerHeaders })).statusCode, 403);
    assert.equal((await app.inject({ method: "GET", url: `/api/v1/organization/compare/${author.id}`, headers: readerHeaders })).statusCode, 403);
    assert.equal((await app.inject({ method: "GET", url: "/api/v1/organization/contributions", headers: readerHeaders })).statusCode, 403);
    assert.equal((await app.inject({ method: "GET", url: "/api/v1/measurements/baseline", headers: readerHeaders })).statusCode, 403);
    assert.equal((await app.inject({ method: "POST", url: `/api/v1/works/${work.id}/feedback`, headers: readerHeaders, payload: { kind: "avoidable-correction", note: "Not my work" } })).statusCode, 403);
    assert.equal((await app.inject({ method: "GET", url: "/api/v1/measurements/baseline", headers: adminHeaders })).statusCode, 200);
  } finally { await app.close(); runtime.db.close(); rmSync(root, { recursive: true, force: true }); }
});
