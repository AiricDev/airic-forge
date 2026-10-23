import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { omFixture } from "./om-test-fixture.js";
import { createTestOmCommit } from "./om-commit-fixture.js";
import { git } from "./personal-git-om.js";
import { GitOmWorkspaces } from "./git-om-workspaces.js";
import { GitContributions } from "./git-contributions.js";
import { buildServer } from "./server.js";
import { parse, stringify } from "yaml";

const path = "work-definitions/document-task/policy.md";

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
    assert.equal((await f.runtime.useCases.reflectionDetail(f.owner.id, reflection.id)).draft?.edits.length, 0);
  } finally { await f.close(); }
});

test("draft worktrees preserve deletions and additions; discard leaves branch unchanged", async () => {
  const f = omFixture();
  try {
    const base = f.runtime.om.head(`users/${f.owner.id}`);
    const added = "work-definitions/document-task/new.md";
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
    const otherPath = "work-definitions/document-task/method.md";
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
      for (const table of ["om_workspaces", "om_drafts", "organization_contributions"]) assert.equal(raw.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table), undefined);
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

test("invalid partial contributions fail validation before publishing a branch revision", async () => {
  const f = omFixture();
  try {
    const base = f.runtime.om.head("main");
    const definitionPath = "work-definitions/document-task/work.yml";
    const definition = parse(f.runtime.om.document(base, definitionPath));
    definition.documents.push({ ...definition.documents[0], id: "required-extra", path: "required-extra.md" });
    await createTestOmCommit(f.runtime, f.owner.id, [
      { path: definitionPath, content: stringify(definition) },
      { path: "work-definitions/document-task/required-extra.md", content: "# Required method\n" },
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
