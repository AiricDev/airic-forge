// Stop the API and back up both OM repository and data before using --apply.
import { DatabaseSync } from 'node:sqlite';
import { resolve, join } from 'node:path';
import { ForgeDatabase } from '../apps/api/dist/database.js';
import { PersonalGitOperatingModel } from '../apps/api/dist/personal-git-om.js';
import { migrateOmDrafts } from '../apps/api/dist/om-migration.js';
const args = process.argv.slice(2);
const value = (flag) => { const index = args.indexOf(flag); if (index < 0 || !args[index + 1] || args[index + 1].startsWith('--')) throw new Error(`Required: ${flag} <directory>`); return resolve(args[index + 1]); };
const project = value('--project');
const data = value('--data');
const apply = args.includes('--apply');
let raw;
let db;
try {
  if (apply) db = new ForgeDatabase(data);
  else {
    raw = new DatabaseSync(join(data, 'forge.sqlite'), { readOnly: true });
    const has = (name) => !!raw.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name);
    db = {
      listUsers: () => raw.prepare('SELECT id FROM users').all(),
      legacyOmDrafts: (owner) => has('om_drafts') ? raw.prepare('SELECT * FROM om_drafts WHERE owner_user_id=?').all(owner).map((row) => ({ ownerUserId: row.owner_user_id, path: row.path, baseRevision: row.base_revision, content: row.content })) : [],
      legacyOmProposals: () => has('proposals') ? raw.prepare('SELECT * FROM proposals ORDER BY created_at, id').all() : [],
      workspace: (owner, scope) => { const row = has('om_workspaces') ? raw.prepare('SELECT snapshot_json FROM om_workspaces WHERE owner_user_id=? AND scope=?').get(owner, scope) : undefined; return row ? JSON.parse(row.snapshot_json) : undefined; },
      omMigrationDone: (source) => has('om_legacy_migrations') && !!raw.prepare('SELECT 1 FROM om_legacy_migrations WHERE source=?').get(source),
    };
  }
  const report = migrateOmDrafts(db, new PersonalGitOperatingModel(project, data, project), !apply);
  console.log(JSON.stringify({ mode: apply ? 'apply' : 'read-only-preview', report }, null, 2));
  if (report.some((item) => item.status === 'needs-manual-recovery')) process.exitCode = 1;
} finally { if (raw) raw.close(); else db?.close(); }
