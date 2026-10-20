import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { migrateOmDrafts } from "./om-migration.js";
import { omFixture } from "./om-test-fixture.js";
import { ForgeDatabase } from "./database.js";

test("upgrading a populated Work-linked reflection preserves child references and foreign keys", async () => {
  const f = omFixture();
  let upgraded: ForgeDatabase | undefined;
  try {
    const work = f.runtime.db.createWork(f.owner.id, "certlab", "report-authoring", "report");
    const { reflection } = await f.runtime.useCases.openWorkReflection(f.owner.id, work.id);
    const raw = new DatabaseSync(join(f.config.dataDir, "forge.sqlite"));
    try {
      raw.prepare("INSERT INTO reflection_messages (id, reflection_id, role, content, at) VALUES ('migration-message', ?, 'user', 'Existing discussion', 'now')").run(reflection.id);
      raw.prepare("INSERT INTO reflection_runs (id, reflection_id, request_id, status, snapshot_json, created_at) VALUES ('migration-run', ?, 'migration-request', 'completed', '{}', 'now')").run(reflection.id);
      const { sql } = raw.prepare("SELECT sql FROM sqlite_master WHERE name='reflections'").get() as { sql: string };
      const legacy = sql.replace(/^(CREATE\s+TABLE\s+)(?:"reflections"|reflections)/i, "$1reflections_legacy").replace(/\bwork_id\s+TEXT/i, "work_id TEXT NOT NULL");
      raw.exec(`PRAGMA foreign_keys=OFF; BEGIN; ${legacy};
        INSERT INTO reflections_legacy SELECT * FROM reflections;
        DROP TABLE reflections; ALTER TABLE reflections_legacy RENAME TO reflections; COMMIT; PRAGMA foreign_keys=ON;`);
      upgraded = new ForgeDatabase(f.config.dataDir);
      assert.deepEqual(raw.prepare("PRAGMA foreign_key_check").all(), []);
      assert.equal((raw.prepare("SELECT content FROM reflection_messages WHERE id='migration-message'").get() as { content: string }).content, "Existing discussion");
      assert.equal((raw.prepare("SELECT reflection_id FROM reflection_runs WHERE id='migration-run'").get() as { reflection_id: string }).reflection_id, reflection.id);
      const foreignKeys = raw.prepare("PRAGMA foreign_key_list(reflections)").all() as Array<{ table: string }>;
      assert.deepEqual(foreignKeys.map((key) => key.table).sort(), ["users", "works"]);
      const columns = raw.prepare("PRAGMA table_info(reflections)").all() as Array<{ name: string; notnull: number }>;
      assert.equal(columns.find((column) => column.name === "work_id")?.notnull, 0);
      raw.prepare("INSERT INTO reflections (id, work_id, owner_user_id, lens_id, question, status, created_at, updated_at) VALUES ('independent-after-upgrade', NULL, ?, 'conversation', 'Independent', 'open', 'now', 'now')").run(f.owner.id);
      assert.throws(() => upgraded!.createWork("missing-owner", "certlab", "report-authoring", "invalid"), /FOREIGN KEY/);
    } finally { raw.close(); }
  } finally { upgraded?.close(); await f.close(); }
});

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
