import { testUser } from "./test-users.js";
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { omFixture } from "./om-test-fixture.js";
import { ForgeUseCases } from "@airic-forge/domain";
import { testCatalog } from "./certlab-test-catalog.js";
import { ForgeRuntime } from "./runtime.js";
import type { ForgeConfig } from "./config.js";
import { buildServer } from "./server.js";
import { createTestOmCommit } from "./om-commit-fixture.js";
import { git } from "./personal-git-om.js";

test("organization comparison and contribution detail return complete diffs above one MiB", async () => {
  const f = omFixture();
  const app = buildServer(f.runtime);
  try {
    const edits = Array.from({ length: 20 }, (_, index) => ({
      path: `work-definitions/report-authoring/shared-${index}.md`,
      content: `# Shared method ${index}\n${"Governed shared policy detail.\n".repeat(2200)}End of method ${index}.\n`,
    }));
    await createTestOmCommit(f.runtime, f.owner.id, edits, "Share large OM improvement");
    const headers = { cookie: `forge_session=${f.runtime.webSessions.issue(f.admin.id)}` };
    const comparison = await app.inject({ method: "GET", url: `/api/v1/organization/compare/${f.owner.id}`, headers });
    assert.equal(comparison.statusCode, 200, comparison.body.slice(0, 500));
    assert(comparison.json().diff.length > 1024 * 1024);
    assert.deepEqual(comparison.json().changedPaths.sort(), edits.map(edit => edit.path).sort());
    const contribution = await f.runtime.useCases.createOrganizationContribution(f.admin.id, f.owner.id, "Share reusable methods", "");
    await f.runtime.useCases.reviewOrganizationContribution(f.admin.id, contribution.id, edits.map(edit => edit.path));
    const detail = await app.inject({ method: "GET", url: `/api/v1/organization/contributions/${contribution.id}`, headers });
    assert.equal(detail.statusCode, 200, detail.body.slice(0, 500));
    assert.equal(detail.json().diff, comparison.json().diff);
    assert(detail.json().candidateDiff.length > 1024 * 1024);
    for (let index = 0; index < edits.length; index++) {
      assert(detail.json().diff.includes(`+End of method ${index}.`));
      assert(detail.json().candidateDiff.includes(`+End of method ${index}.`));
    }
  } finally { await app.close(); await f.close(); }
});

test("reviewed and accepted contribution details read immutable commits without requiring candidate worktrees", async () => {
  const f = omFixture();
  const app = buildServer(f.runtime);
  try {
    const path = "work-definitions/report-authoring/policy.md";
    await createTestOmCommit(f.runtime, f.owner.id, [{ path, content: f.runtime.om.document(f.runtime.om.head("main"), path) + "\nReviewed shared policy.\n" }], "Share policy");
    const record = await f.runtime.useCases.createOrganizationContribution(f.admin.id, f.owner.id, "Share reviewed policy", "");
    const reviewed = await f.runtime.useCases.reviewOrganizationContribution(f.admin.id, record.id, [path]);
    const stored = f.runtime.organization.contribution(record.id)!;
    const worktree = join(f.root, "optional-candidate-worktree");
    git(f.runtime.om.projectDir, ["worktree", "add", "--detach", worktree, stored.reviewedRevision!]);
    const headers = { cookie: `forge_session=${f.runtime.webSessions.issue(f.admin.id)}` };
    const read = () => app.inject({ method: "GET", url: `/api/v1/organization/contributions/${record.id}`, headers });
    const original = await read();
    assert.equal(original.statusCode, 200);
    const candidateDiff = original.json().candidateDiff;
    assert.match(candidateDiff, /Reviewed shared policy/);
    const originalFile = readFileSync(join(worktree, path), "utf8");
    writeFileSync(join(worktree, path), originalFile + "\nUnreviewed dirty worktree text.\n");
    const dirty = await read();
    assert.equal(dirty.statusCode, 200);
    assert.equal(dirty.json().candidateDiff, candidateDiff);
    writeFileSync(join(worktree, path), originalFile);
    const moved = join(f.root, "temporarily-moved-candidate");
    renameSync(worktree, moved);
    try {
      const missing = await read();
      assert.equal(missing.statusCode, 200, missing.body.slice(0, 500));
      assert.equal(missing.json().record.status, "open");
      assert.equal(missing.json().candidateDiff, candidateDiff);
      assert.deepEqual(f.runtime.organization.contribution(record.id), stored);
    } finally { renameSync(moved, worktree); }
    const accepted = await f.runtime.useCases.acceptOrganizationContribution(f.admin.id, record.id, reviewed.reviewedRevision!);
    rmSync(worktree, { recursive: true, force: true });
    const missing = await read();
    assert.equal(missing.statusCode, 200, missing.body.slice(0, 500));
    assert.equal(missing.json().record.status, "accepted");
    assert.equal(missing.json().candidateDiff, candidateDiff);
    assert.equal(f.runtime.om.head("main"), accepted.revision);
    const forbidden = await app.inject({ method: "GET", url: `/api/v1/organization/contributions/${record.id}`, headers: { cookie: `forge_session=${f.runtime.webSessions.issue(f.other.id)}` } });
    assert.equal(forbidden.statusCode, 403);
  } finally { await app.close(); await f.close(); }
});

test("administrator selectively accepts personal OM and member sync preserves old HEAD", async () => {
  const root = mkdtempSync(join(tmpdir(), "airic-forge-stage-six-"));
  const config: ForgeConfig = { port: 0, projectDir: join(root, "project"), dataDir: join(root, "data"), seedProjectDir: resolve(process.cwd(), "../../seed/certlab"), webDistDir: join(root, "web"), certLabUrl: "http://127.0.0.1:1", organizationId: "synthetic-org", allowedOrigin: "http://localhost:5173", };
  const runtime = new ForgeRuntime(config);
  try {
    const admin = testUser(runtime.db, "admin@example.com", true);
    const author = testUser(runtime.db, "author@example.com", false);
    const member = testUser(runtime.db, "member@example.com", false);
    const catalog = testCatalog();
    runtime.db.recordToolSnapshot(catalog);
    const useCases: ForgeUseCases = runtime.useCases;
    const authorBranch = runtime.om.ensureUserBranch(author.id);
    const memberBranch = runtime.om.ensureUserBranch(member.id);
    const initialMain = runtime.om.head("main");
    const oldMemberHead = runtime.om.head(memberBranch.branch);
    const policyPath = "work-definitions/report-authoring/policy.md";
    const methodPath = "work-definitions/report-authoring/method.md";
    const authorRevision = (await createTestOmCommit(runtime, author.id, [
      { path: policyPath, content: runtime.om.document(oldMemberHead, policyPath) + "\nShared organization policy.\n" },
      { path: methodPath, content: runtime.om.document(oldMemberHead, methodPath) + "\nPrivate author method.\n" },
    ], "Author improvement")).revision;
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
    const sync = await runtime.omChanges.sync(member.id);
    assert.equal(runtime.om.head(memberBranch.branch), oldMemberHead);
    assert.equal(sync.upstreamRevision, accepted.revision);
    const synced = await runtime.omChanges.commit(member.id, "sync", sync.digest, "sync-member-request");
    assert.match(runtime.om.document(synced.revision, policyPath), /Shared organization policy/);
    assert.equal(runtime.om.containsRevision(memberBranch.branch, oldMemberHead), true);
    assert.equal(runtime.om.includesRevision(memberBranch.branch, accepted.revision), true);
    assert.equal((await useCases.personalOm(member.id, member.id, oldMemberHead)).revision, oldMemberHead);
    await assert.rejects(() => runtime.omChanges.sync(member.id), /OrganizationAlreadyCurrent/);
    const work = runtime.db.createWork(member.id, "certlab", "report-authoring", "report-1");
    await assert.rejects(() => useCases.addWorkFeedback(author.id, work.id, "avoidable-correction", "Wrong owner"), /Forbidden/);
    await useCases.addWorkFeedback(member.id, work.id, "required-human-decision", "Report approval belongs to a human");
    await useCases.addWorkFeedback(member.id, work.id, "avoidable-correction", "I had to repeat the evidence location");
    assert.equal((await useCases.workFeedback(member.id, work.id)).length, 2);
    await assert.rejects(() => useCases.measurementBaseline(member.id), /Forbidden/);
    const baseline = await useCases.measurementBaseline(admin.id);
    assert.equal(baseline.activity.acceptedOrganizationContributions, 1);
    assert.equal(runtime.drafts.workspace(member.id, "sync"), undefined);
    assert.equal(baseline.feedback["required-human-decision"], 1);
    assert.equal(baseline.feedback["avoidable-correction"], 1);
  } finally { runtime.db.close(); rmSync(root, { recursive: true, force: true }); }
});

test("a reviewed organization candidate cannot overwrite a newer main HEAD", async () => {
  const root = mkdtempSync(join(tmpdir(), "airic-forge-stage-six-stale-"));
  const config: ForgeConfig = { port: 0, projectDir: join(root, "project"), dataDir: join(root, "data"), seedProjectDir: resolve(process.cwd(), "../../seed/certlab"), webDistDir: join(root, "web"), certLabUrl: "http://127.0.0.1:1", organizationId: "synthetic-org", allowedOrigin: "http://localhost:5173", };
  const runtime = new ForgeRuntime(config);
  try {
    const author = testUser(runtime.db, "author@example.com", false);
    const admin = testUser(runtime.db, "reviewer@example.invalid", true);
    const user = runtime.om.ensureUserBranch(author.id);
    const path = "work-definitions/report-authoring/policy.md";
    await createTestOmCommit(runtime, author.id, [{ path, content: runtime.om.document(runtime.om.head(user.branch), path) + "\nAuthor rule.\n" }], "Author rule");
    const candidate = await runtime.useCases.createOrganizationContribution(admin.id, author.id, "Selected policy", "");
    const selected = await runtime.useCases.reviewOrganizationContribution(admin.id, candidate.id, [path]);
    const advance = await runtime.useCases.createOrganizationContribution(admin.id, author.id, "Advance main", "");
    const advanced = await runtime.useCases.reviewOrganizationContribution(admin.id, advance.id, [path]);
    await runtime.useCases.acceptOrganizationContribution(admin.id, advance.id, advanced.reviewedRevision!);
    await assert.rejects(() => runtime.useCases.acceptOrganizationContribution(admin.id, candidate.id, selected.reviewedRevision!), /OrganizationReviewStale/);
  } finally { runtime.db.close(); rmSync(root, { recursive: true, force: true }); }
});

test("organization sync preserves conflicts in a draft until resolved and directly committed", async () => {
  const f = omFixture();
  try {
    const path = "work-definitions/report-authoring/policy.md";
    const base = f.runtime.om.head("main");
    const original = f.runtime.om.document(base, path);
    const author = await createTestOmCommit(f.runtime, f.owner.id, [{ path, content: original + "\nOrganization wording.\n" }], "Organization wording");
    const record = await f.runtime.useCases.createOrganizationContribution(f.admin.id, f.owner.id, "Organization wording", "");
    const selected = await f.runtime.useCases.reviewOrganizationContribution(f.admin.id, record.id, [path]);
    const { revision: main } = await f.runtime.useCases.acceptOrganizationContribution(f.admin.id, record.id, selected.reviewedRevision!);
    const personal = await createTestOmCommit(f.runtime, f.other.id, [{ path, content: original + "\nMember wording.\n" }], "Member wording");
    const sync = await f.runtime.omChanges.sync(f.other.id);
    assert.deepEqual(sync.conflicts, [path]);
    assert.equal(f.runtime.om.head(`users/${f.other.id}`), personal.revision);
    await assert.rejects(() => f.runtime.omChanges.commit(f.other.id, "sync", sync.digest, "sync-conflict-request"), /OmMergeConflict/);
    const resolved = await f.runtime.omChanges.save(f.other.id, "sync", { baseRevision: personal.revision, summary: "Keep both wordings", edits: [{ path, content: original + "\nOrganization wording.\nMember wording.\n" }] });
    const committed = await f.runtime.omChanges.commit(f.other.id, "sync", resolved.digest, "resolved-sync-request");
    assert.match(f.runtime.om.document(committed.revision, path), /Organization wording\.\nMember wording/);
    assert(f.runtime.om.includesRevision(`users/${f.other.id}`, main));
    assert(f.runtime.om.includesRevision(`users/${f.other.id}`, personal.revision));
  } finally { await f.close(); }
});
test("organization HTTP routes expose main to members while keeping private evidence and baseline administrative", async () => {
  const root = mkdtempSync(join(tmpdir(), "airic-forge-stage-six-http-"));
  const config: ForgeConfig = { port: 0, projectDir: join(root, "project"), dataDir: join(root, "data"), seedProjectDir: resolve(process.cwd(), "../../seed/certlab"), webDistDir: join(root, "web"), certLabUrl: "http://127.0.0.1:1", organizationId: "synthetic-org", allowedOrigin: "http://localhost:5173", };
  const runtime = new ForgeRuntime(config);
  const app = buildServer(runtime);
  try {
    const admin = testUser(runtime.db, "admin@example.com", true);
    const author = testUser(runtime.db, "author@example.com", false);
    const reader = testUser(runtime.db, "reader@example.com", false);
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
