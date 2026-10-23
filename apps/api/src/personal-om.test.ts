import assert from "node:assert/strict";
import test from "node:test";
import { GitOmWorkspaces } from "./git-om-workspaces.js";
import { omFixture } from "./om-test-fixture.js";
const path = "work-definitions/document-task/policy.md";
test("manual drafts commit directly, preserve history, survive restart and retry idempotently", async () => {
  const f = omFixture();
  try {
    const base = f.runtime.om.head(`users/${f.owner.id}`);
    const turnWork = f.runtime.db.createWork(f.owner.id, "sample-app", "document-task", "report-1");
    const oldTurn = f.runtime.db.nextTurn(turnWork.id, base, "catalog", "context");
    const draft = await f.save(f.owner.id, "manual", path, f.runtime.om.document(base, path) + "\nReviewed rule.\n");
    assert.equal(f.runtime.om.head(`users/${f.owner.id}`), base);
    await assert.rejects(() => f.runtime.omChanges.commit(f.owner.id, "manual", "wrong", "manual-request"), /OmDraftChanged/);
    const committed = await f.runtime.omChanges.commit(f.owner.id, "manual", draft.digest, "manual-request");
    assert.notEqual(committed.revision, base);
    assert.equal((await f.runtime.omChanges.commit(f.owner.id, "manual", draft.digest, "manual-request")).revision, committed.revision);
    assert.match(f.runtime.om.document(committed.revision, path), /Reviewed rule/);
    assert.doesNotMatch(f.runtime.om.document(base, path), /Reviewed rule/);
    assert.equal(f.runtime.om.history(`users/${f.owner.id}`).length, 2, "no extra review/adoption commits");
    assert.equal(f.runtime.db.turnsForWork(turnWork.id)[0].omRevision, oldTurn.omRevision);
    assert.equal((await f.runtime.useCases.personalOm(f.owner.id, f.owner.id)).activeRevision, committed.revision);
    await assert.rejects(() => f.runtime.omChanges.own(f.admin.id, f.owner.id), /Forbidden/);
    await assert.rejects(() => f.runtime.useCases.personalOm(f.other.id, f.owner.id), /Forbidden/);
    const reopened = new GitOmWorkspaces(f.runtime.om);
    assert.equal(reopened.workspace(f.owner.id, "manual"), undefined);
  } finally { await f.close(); }
});
test("stale drafts are preserved, can merge or resolve conflicts, and invalid content never advances HEAD", async () => {
  const f = omFixture();
  try {
    const base = f.runtime.om.head(`users/${f.owner.id}`);
    const original = f.runtime.om.document(base, path);
    const first = await f.save(f.owner.id, "manual", path, original + "\nFirst rule.\n");
    const peer = await f.runtime.useCases.openPersonalReflection(f.owner.id, "Alternative method");
    const peerScope = `reflection:${peer.reflection.id}`;
    await f.save(f.owner.id, peerScope, path, original + "\nSecond rule.\n");
    const active = await f.runtime.omChanges.commit(f.owner.id, "manual", first.digest, "first-rule-request");
    const stale = await f.runtime.omChanges.read(f.owner.id, peerScope);
    await assert.rejects(() => f.runtime.omChanges.commit(f.owner.id, stale.scope, stale.digest, "stale-rule-request"), /ActiveRevisionChanged/);
    const merged = await f.runtime.omChanges.rebase(f.owner.id, stale.scope);
    assert.deepEqual(merged.conflicts, [path]);
    await assert.rejects(() => f.runtime.omChanges.commit(f.owner.id, stale.scope, merged.digest, "merge-rule-request"), /OmMergeConflict/);
    const resolved = await f.runtime.omChanges.save(f.owner.id, stale.scope, { baseRevision: active.revision, summary: "Keep both rules", edits: [{ path, content: original + "\nFirst rule.\nSecond rule.\n" }] });
    const result = await f.runtime.omChanges.commit(f.owner.id, stale.scope, resolved.digest, "resolved-rule-request");
    assert.match(f.runtime.om.document(result.revision, path), /First rule\.\nSecond rule/);
    const bad = await f.save(f.owner.id, "manual", "subject-knowledge/invalid.md", "# Missing metadata");
    await assert.rejects(() => f.runtime.omChanges.commit(f.owner.id, "manual", bad.digest, "invalid-rule-request"), /InvalidOperatingModel/);
    assert.equal(f.runtime.om.head(`users/${f.owner.id}`), result.revision);
    assert.equal(f.runtime.drafts.workspace(f.owner.id, "manual")?.edits.length, 1);
    await assert.rejects(() => f.save(f.owner.id, "manual", "../private.md", "not allowed"), /InvalidOmDraft/);
  } finally { await f.close(); }
});
