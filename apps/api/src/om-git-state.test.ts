import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { omFixture } from "./om-test-fixture.js";
import { createTestOmCommit } from "./test-proposal-fixture.js";
import { git } from "./personal-git-om.js";
import { GitOmWorkspaces } from "./git-om-workspaces.js";
import { GitContributions } from "./git-contributions.js";
import { migrateOmStateToGit } from "./om-git-migration.js";
import { buildServer } from "./server.js";
import { parse, stringify } from "yaml";

const path = "work-definitions/report-authoring/policy.md";

test("drafts are uncommitted detached worktrees, recover from disk and confirm with Git metadata", async () => {
  const f = omFixture();
  try {
    const base = f.runtime.om.head(`users/${f.owner.id}`);
    const original = f.runtime.om.document(base, path);
    const { reflection } = await f.runtime.useCases.openPersonalReflection(f.owner.id, "Improve policy");
    const scope = `reflection:${reflection.id}`;
    const draft = await f.save(f.owner.id, scope, path, original + "\n  Exact draft.\r\n", "Explain evidence ownership");
    const directory = f.runtime.drafts.directory(f.owner.id, scope);
    assert.equal(git(directory, ["rev-parse", "--abbrev-ref", "HEAD"]), "HEAD");
    assert.match(git(directory, ["status", "--porcelain"]), /policy.md/);
    assert.equal(f.runtime.om.head(`users/${f.owner.id}`), base);
    assert.deepEqual(new GitOmWorkspaces(f.runtime.om).workspace(f.owner.id, scope), f.runtime.drafts.workspace(f.owner.id, scope));
    writeFileSync(join(directory, path), original + "\nEdited from outside.\n");
    await assert.rejects(() => f.runtime.omChanges.commit(f.owner.id, scope, draft.digest, "outdated-draft-request"), /OmDraftChanged/);
    const current = await f.runtime.omChanges.read(f.owner.id, scope);
    const committed = await f.runtime.omChanges.commit(f.owner.id, scope, current.digest, "confirmed-draft-request");
    assert.equal(f.runtime.om.document(committed.revision, path), original + "\nEdited from outside.\n");
    const message = git(f.runtime.om.projectDir, ["show", "-s", "--format=%B", committed.revision]);
    assert.match(message, /AiricForge-Reason: Explain evidence ownership/);
    assert.match(message, new RegExp(`AiricForge-Author: ${f.owner.id}`));
    assert.match(message, new RegExp(`AiricForge-Source-Revision: ${base}`));
    assert.equal(existsSync(directory), false);
    assert.equal(f.runtime.db.workspace(f.owner.id, scope), undefined);
    assert.equal((await f.runtime.useCases.reflectionDetail(f.owner.id, reflection.id)).draft?.edits.length, 0);
  } finally { await f.close(); }
});

test("draft worktrees preserve deletions and additions; discard leaves branch unchanged", async () => {
  const f = omFixture();
  try {
    const base = f.runtime.om.head(`users/${f.owner.id}`);
    const added = "work-definitions/report-authoring/new.md";
    await f.runtime.omChanges.save(f.owner.id, "manual", { baseRevision: base, summary: "Replace draft document", edits: [{ path, content: null }, { path: added, content: "  exact\r\n\r\n" }] });
    assert.deepEqual(f.runtime.drafts.workspace(f.owner.id, "manual")?.edits, [{ path: added, content: "  exact\r\n\r\n" }, { path, content: null }]);
    await f.runtime.omChanges.discard(f.owner.id, "manual");
    assert.equal(f.runtime.om.head(`users/${f.owner.id}`), base);
    assert.equal(existsSync(f.runtime.drafts.directory(f.owner.id, "manual")), false);
  } finally { await f.close(); }
});

test("contribution creation, selection and acceptance use Git alone and append commits", async () => {
  const f = omFixture();
  try {
    const base = f.runtime.om.head("main");
    const otherPath = "work-definitions/report-authoring/method.md";
    await createTestOmCommit(f.runtime, f.owner.id, [
      { path, content: f.runtime.om.document(base, path) + "\nShared rule.\n" },
      { path: otherPath, content: f.runtime.om.document(base, otherPath) + "\nShared method.\n" },
    ], "Share methods");
    const record = await f.runtime.useCases.createOrganizationContribution(f.admin.id, f.owner.id, "Reusable rules", "Shared evidence");
    const branch = `contributions/${record.id}`;
    assert.equal(f.runtime.om.head(branch), record.reviewedRevision);
    assert.equal(git(f.runtime.om.projectDir, ["rev-parse", `${branch}^{tree}`]), git(f.runtime.om.projectDir, ["rev-parse", `${base}^{tree}`]));
    await assert.rejects(() => f.runtime.useCases.acceptOrganizationContribution(f.admin.id, record.id, record.reviewedRevision!), /ContributionSelectionRequired/);
    const selected = await f.runtime.useCases.reviewOrganizationContribution(f.admin.id, record.id, [path]);
    const changed = await f.runtime.useCases.reviewOrganizationContribution(f.admin.id, record.id, [path, otherPath]);
    assert.equal(git(f.runtime.om.projectDir, ["rev-parse", `${changed.reviewedRevision}^`]), selected.reviewedRevision);
    assert.equal(f.runtime.om.head("main"), base);
    await assert.rejects(() => f.runtime.useCases.acceptOrganizationContribution(f.admin.id, record.id, selected.reviewedRevision!), /ContributionReviewRequired/);
    const accepted = await f.runtime.useCases.acceptOrganizationContribution(f.admin.id, record.id, changed.reviewedRevision!);
    const parents = git(f.runtime.om.projectDir, ["show", "-s", "--format=%P", accepted.revision]).split(" ");
    assert.deepEqual(parents, [base, changed.reviewedRevision]);
    assert.match(git(f.runtime.om.projectDir, ["show", "-s", "--format=%B", accepted.revision]), new RegExp(`AiricForge-Reviewer: ${f.admin.id}`));
    assert.equal(new GitContributions(f.runtime.om).contribution(record.id)?.status, "accepted");
    const raw = new DatabaseSync(join(f.config.dataDir, "forge.sqlite"), { readOnly: true });
    try {
      for (const table of ["om_workspaces", "om_drafts", "organization_contributions"]) assert.equal(raw.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()?.n, 0);
    } finally { raw.close(); }
  } finally { await f.close(); }
});

test("CLI merge and later branch commits determine contribution status without DB bookkeeping", async () => {
  const f = omFixture();
  try {
    const base = f.runtime.om.head("main");
    await f.save(f.owner.id, "manual", path, f.runtime.om.document(base, path) + "\nReusable CLI rule.\n");
    const draft = await f.runtime.omChanges.read(f.owner.id, "manual");
    await f.runtime.omChanges.commit(f.owner.id, "manual", draft.digest, "cli-rule-request");
    const record = await f.runtime.useCases.createOrganizationContribution(f.admin.id, f.owner.id, "Share CLI rule", "");
    const selected = await f.runtime.useCases.reviewOrganizationContribution(f.admin.id, record.id, [path]);
    git(f.runtime.om.projectDir, ["merge", "--no-ff", selected.candidateBranch!, "-m", "Merge from CLI"]);
    assert.equal((await f.runtime.useCases.organizationContribution(f.admin.id, record.id)).record.status, "accepted");
    assert.equal((await f.runtime.useCases.measurementBaseline(f.admin.id)).activity.acceptedOrganizationContributions, 1);
    const extra = git(f.runtime.om.projectDir, ["commit-tree", `${selected.reviewedRevision}^{tree}`, "-p", selected.reviewedRevision!], "Additional CLI commit");
    git(f.runtime.om.projectDir, ["update-ref", `refs/heads/${selected.candidateBranch}`, extra, selected.reviewedRevision!]);
    assert.equal((await f.runtime.useCases.organizationContribution(f.admin.id, record.id)).record.status, "open");
    await assert.rejects(() => f.runtime.useCases.acceptOrganizationContribution(f.admin.id, record.id, selected.reviewedRevision!), /ContributionReviewRequired/);
    assert.equal((await f.runtime.useCases.measurementBaseline(f.admin.id)).activity.acceptedOrganizationContributions, 0);
  } finally { await f.close(); }
});

test("invalid selection never moves the contribution branch", async () => {
  const f = omFixture();
  try {
    const base = f.runtime.om.head("main");
    await createTestOmCommit(f.runtime, f.owner.id, [{ path, content: f.runtime.om.document(base, path) + "\nShared rule.\n" }], "Share rule");
    const record = await f.runtime.useCases.createOrganizationContribution(f.admin.id, f.owner.id, "Share rule", "");
    await assert.rejects(() => f.runtime.useCases.reviewOrganizationContribution(f.admin.id, record.id, ["../private"]), /InvalidContributionSelection/);
    assert.equal(f.runtime.om.head(record.candidateBranch!), record.reviewedRevision);
    await assert.rejects(() => f.runtime.useCases.abandonOrganizationContribution(f.other.id, record.id, record.reviewedRevision!), /Forbidden/);
    await f.runtime.useCases.abandonOrganizationContribution(f.admin.id, record.id, record.reviewedRevision!);
    assert.equal(f.runtime.organization.contribution(record.id), undefined);
    assert.equal(f.runtime.om.head("main"), base);
  } finally { await f.close(); }
});

test("legacy draft migration is byte-exact, idempotent, preserves rows and never resurrects discarded work", async () => {
  const f = omFixture();
  try {
    const base = f.runtime.om.head(`users/${f.owner.id}`);
    const workspace = { ownerUserId: f.owner.id, scope: "manual", baseRevision: base, summary: "Pending legacy edit", conflicts: [], edits: [{ path, content: "  legacy bytes\r\n\r\n" }] };
    f.runtime.db.saveWorkspace(workspace);
    const refs = git(f.runtime.om.projectDir, ["show-ref"]);
    assert.equal(migrateOmStateToGit(f.runtime.db, f.runtime.om).report[0]?.status, "ready");
    assert.equal(f.runtime.drafts.workspace(f.owner.id, "manual"), undefined);
    migrateOmStateToGit(f.runtime.db, f.runtime.om, false);
    assert.equal(readFileSync(join(f.runtime.drafts.directory(f.owner.id, "manual"), path), "utf8"), workspace.edits[0].content);
    assert.deepEqual(f.runtime.db.workspace(f.owner.id, "manual"), workspace);
    assert.equal(git(f.runtime.om.projectDir, ["show-ref"]), refs);
    await f.runtime.omChanges.discard(f.owner.id, "manual");
    assert.deepEqual(migrateOmStateToGit(f.runtime.db, f.runtime.om, false).report, []);
    assert.equal(f.runtime.drafts.workspace(f.owner.id, "manual"), undefined);
  } finally { await f.close(); }
});

test("migration restores a missing accepted branch only from its verified historical Git commit", async () => {
  const f = omFixture();
  try {
    const base = f.runtime.om.head("main");
    const author = await createTestOmCommit(f.runtime, f.owner.id, [{ path, content: f.runtime.om.document(base, path) + "\nLegacy accepted rule.\n" }], "Legacy source");
    const id = "legacy-accepted";
    const candidate = f.runtime.om.prepareContribution(id, author.revision, base, base, [path],
      `Accept selected organization OM contribution\n\nAiricForge-Contribution: ${id}\nAiricForge-Author: ${f.owner.id}\nAiricForge-Source-Revision: ${author.revision}\nAiricForge-Reason: Legacy reason\nAiricForge-Base: ${base}`);
    const main = f.runtime.om.acceptContribution(candidate.branch, base);
    f.runtime.db.createContribution({ id, authorUserId: f.owner.id, sourceRevision: author.revision, baseMainRevision: base, reason: "Legacy reason", evidence: "", status: "accepted", selectedPaths: [path], createdAt: "2026-10-01" });
    const raw = new DatabaseSync(join(f.config.dataDir, "forge.sqlite"));
    try { raw.prepare("UPDATE organization_contributions SET accepted_revision=? WHERE id=?").run(candidate.revision, id); } finally { raw.close(); }
    git(f.runtime.om.projectDir, ["update-ref", "-d", `refs/heads/${candidate.branch}`, candidate.revision]);
    const refs = git(f.runtime.om.projectDir, ["show-ref"]);
    const preview = migrateOmStateToGit(f.runtime.db, f.runtime.om);
    assert.equal(preview.report[0]?.operation, "restore-accepted-branch");
    assert.equal(git(f.runtime.om.projectDir, ["show-ref"]), refs);
    migrateOmStateToGit(f.runtime.db, f.runtime.om, false);
    const restored = f.runtime.organization.contribution(id)!;
    assert.equal(restored.status, "accepted");
    assert.equal(restored.reviewedRevision, candidate.revision);
    assert.equal(f.runtime.om.head("main"), main);
    assert.deepEqual(migrateOmStateToGit(f.runtime.db, f.runtime.om, false).report, []);
  } finally { await f.close(); }
});

test("invalid partial contributions fail validation before publishing a branch revision", async () => {
  const f = omFixture();
  try {
    const base = f.runtime.om.head("main");
    const definitionPath = "work-definitions/report-authoring/work.yml";
    const definition = parse(f.runtime.om.document(base, definitionPath));
    definition.documents.push({ ...definition.documents[0], id: "required-extra", path: "required-extra.md" });
    await createTestOmCommit(f.runtime, f.owner.id, [
      { path: definitionPath, content: stringify(definition) },
      { path: "work-definitions/report-authoring/required-extra.md", content: "# Required method\n" },
    ], "Add required method");
    const record = await f.runtime.useCases.createOrganizationContribution(f.admin.id, f.owner.id, "Share required method", "");
    await assert.rejects(() => f.runtime.useCases.reviewOrganizationContribution(f.admin.id, record.id, [definitionPath]), /InvalidOperatingModel/);
    assert.equal(f.runtime.om.head(record.candidateBranch!), record.reviewedRevision);
    assert.equal(f.runtime.om.head("main"), base);
  } finally { await f.close(); }
});

test("HTTP contribution lifecycle supports selection, explicit abandonment and Git-derived acceptance", async () => {
  const f = omFixture();
  const app = buildServer(f.runtime);
  try {
    const base = f.runtime.om.head("main");
    await createTestOmCommit(f.runtime, f.owner.id, [{ path, content: f.runtime.om.document(base, path) + "\nShared HTTP rule.\n" }], "Share HTTP rule");
    const headers = { cookie: `forge_session=${f.runtime.webSessions.issue(f.admin.id)}` };
    const memberHeaders = { cookie: `forge_session=${f.runtime.webSessions.issue(f.other.id)}` };
    const url = "/api/v1/organization/contributions";
    const payload = { authorUserId: f.owner.id, reason: "Share HTTP rule", evidence: "" };
    const created = await app.inject({ method: "POST", url, headers, payload });
    assert.equal(created.statusCode, 201, created.body);
    const abandoned = created.json();
    const abandonUrl = `${url}/${abandoned.id}/abandon`;
    assert.equal((await app.inject({ method: "POST", url: abandonUrl, payload: { reviewedRevision: abandoned.reviewedRevision } })).statusCode, 401);
    assert.equal((await app.inject({ method: "POST", url: abandonUrl, headers: memberHeaders, payload: { reviewedRevision: abandoned.reviewedRevision } })).statusCode, 403);
    assert.equal((await app.inject({ method: "POST", url: abandonUrl, headers, payload: { reviewedRevision: abandoned.reviewedRevision } })).statusCode, 200);
    assert.equal(f.runtime.organization.contribution(abandoned.id), undefined);
    const second = (await app.inject({ method: "POST", url, headers, payload })).json();
    const selected = await app.inject({ method: "POST", url: `${url}/${second.id}/review`, headers, payload: { selectedPaths: [path] } });
    assert.equal(selected.statusCode, 200, selected.body);
    assert.equal(selected.json().status, "open");
    const accepted = await app.inject({ method: "POST", url: `${url}/${second.id}/accept`, headers, payload: { reviewedRevision: selected.json().reviewedRevision } });
    assert.equal(accepted.statusCode, 200, accepted.body);
    const detail = (await app.inject({ method: "GET", url: `${url}/${second.id}`, headers })).json();
    assert.equal(detail.record.status, "accepted");
    assert.equal(detail.record.acceptedRevision, accepted.json().revision);
    assert.equal((await app.inject({ method: "POST", url: `${url}/${second.id}/abandon`, headers, payload: { reviewedRevision: selected.json().reviewedRevision } })).statusCode, 409);
  } finally { await app.close(); await f.close(); }
});
