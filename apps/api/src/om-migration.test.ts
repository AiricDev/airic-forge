import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { migrateOmDrafts } from "./om-migration.js";
import { omFixture } from "./om-test-fixture.js";
test("legacy candidates migrate without adoption, collisions are archived and applied migrations never resurrect", async () => {
  const f = omFixture();
  try {
    const base = f.runtime.om.head(`users/${f.owner.id}`);
    const work = f.runtime.db.createWork(f.owner.id, "certlab", "report-authoring", "report");
    const { reflection } = await f.runtime.useCases.openWorkReflection(f.owner.id, work.id);
    const path = "work-definitions/report-authoring/policy.md";
    const raw = new DatabaseSync(join(f.config.dataDir, "forge.sqlite"));
    try {
      for (const id of ["legacy-a", "legacy-b"]) {
        const candidate = f.runtime.om.createProposal(f.owner.id, id, base);
        f.runtime.om.writeProposalFile(candidate.worktree, path, f.runtime.om.document(base, path) + `\n${id} improvement.\n`);
        raw.prepare("INSERT INTO proposals (id, reflection_id, owner_user_id, base_revision, branch_ref, worktree_path, status, source, reason, evidence, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'open', 'reflection', ?, '', 'now', 'now')").run(id, reflection.id, f.owner.id, base, candidate.branch, candidate.worktree, id);
      }
    } finally { raw.close(); }
    const preview = migrateOmDrafts(f.runtime.db, f.runtime.om);
    assert.equal(preview.length, 2);
    assert.equal(f.runtime.db.workspaces(f.owner.id).length, 0);
    const applied = migrateOmDrafts(f.runtime.db, f.runtime.om, false);
    assert.equal(applied.length, 2);
    assert.equal(f.runtime.db.workspaces(f.owner.id).length, 2);
    assert.equal(f.runtime.om.head(`users/${f.owner.id}`), base);
    const draft = await f.runtime.omChanges.read(f.owner.id, `reflection:${reflection.id}`);
    await f.runtime.omChanges.commit(f.owner.id, draft.scope, draft.digest, "migrated-commit-request");
    assert.deepEqual(migrateOmDrafts(f.runtime.db, f.runtime.om, false), []);
    assert.equal(f.runtime.db.workspace(f.owner.id, draft.scope), undefined);
    assert.equal(f.runtime.db.workspace(f.owner.id, "archive:legacy-b")?.edits.length, 1);
    assert.equal(f.runtime.db.legacyOmProposals().length, 2, "historical records remain intact");
  } finally { await f.close(); }
});
