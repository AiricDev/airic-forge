import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { CapabilityCatalog, ForgeUser, OmDraft, OrganizationContribution, ReflectionLens, ReflectionMessage, ReflectionOutcome, ReflectionRecord, ReflectionRun, TurnRecord, UserRole, Work, WorkFeedback, WorkFeedbackKind, WorkListFilters } from "@airic-forge/domain";
import { id, normalizeEmail } from "./ids.js";
import type { OmWorkspace, GitToken } from "@airic-forge/domain";

export class ForgeDatabase {
  readonly #db: DatabaseSync;

  constructor(dataDir: string, options: { migrateMcpCatalogs?: boolean } = {}) {
    mkdirSync(dataDir, { recursive: true });
    this.#db = new DatabaseSync(join(dataDir, "forge.sqlite"));
    const tables = new Set((this.#db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>).map(row => row.name));
    if (tables.has("catalog_candidates") && !tables.has("mcp_catalog_candidates") && !options.migrateMcpCatalogs) {
      this.#db.close();
      throw new Error("McpCatalogMigrationRequired: back up the data root, then run scripts/migrate-mcp-catalogs.mjs --data-dir <absolute-path> --apply");
    }
    this.#db.exec("PRAGMA journal_mode = WAL");
    this.#migrate();
  }

  close(): void { this.#db.close(); }

  legacyOmProposals(): Array<Record<string, unknown>> { return this.#db.prepare("SELECT * FROM proposals ORDER BY created_at, id").all() as Array<Record<string, unknown>>; }
  omMigrationDone(source: string): boolean { return Boolean(this.#db.prepare("SELECT 1 FROM om_legacy_migrations WHERE source=?").get(source)); }
  recordOmMigration(source: string): void { this.#db.prepare("INSERT OR IGNORE INTO om_legacy_migrations (source) VALUES (?)").run(source); }
  saveMigratedWorkspace(source: string, workspace: OmWorkspace): void {
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      this.saveWorkspace(workspace);
      this.#db.prepare("INSERT INTO om_legacy_migrations (source) VALUES (?)").run(source);
      this.#db.exec("COMMIT");
    } catch (error) { this.#db.exec("ROLLBACK"); throw error; }
  }

  workspace(ownerUserId: string, scope: string): OmWorkspace | undefined {
    const row = this.#db.prepare("SELECT snapshot_json FROM om_workspaces WHERE owner_user_id=? AND scope=?").get(ownerUserId, scope) as { snapshot_json: string } | undefined;
    return row ? JSON.parse(row.snapshot_json) as OmWorkspace : undefined;
  }
  workspaces(ownerUserId: string): OmWorkspace[] {
    return (this.#db.prepare("SELECT snapshot_json FROM om_workspaces WHERE owner_user_id=? ORDER BY scope").all(ownerUserId) as Array<{ snapshot_json: string }>).map((row) => JSON.parse(row.snapshot_json) as OmWorkspace);
  }
  saveWorkspace(workspace: OmWorkspace): void {
    this.#db.prepare("INSERT INTO om_workspaces VALUES (?, ?, ?) ON CONFLICT(owner_user_id, scope) DO UPDATE SET snapshot_json=excluded.snapshot_json").run(workspace.ownerUserId, workspace.scope, JSON.stringify(workspace));
  }
  discardWorkspace(ownerUserId: string, scope: string): void {
    const saved = this.workspace(ownerUserId, scope);
    if (scope === "manual" && saved) for (const edit of saved.edits) this.#db.prepare("DELETE FROM om_drafts WHERE owner_user_id=? AND path=? AND content=?").run(ownerUserId, edit.path, edit.content);
    this.#db.prepare("DELETE FROM om_workspaces WHERE owner_user_id=? AND scope=?").run(ownerUserId, scope);
  }
  gitTokens(ownerUserId: string): GitToken[] {
    return (this.#db.prepare("SELECT * FROM git_tokens WHERE owner_user_id=? ORDER BY rowid DESC").all(ownerUserId) as Record<string, unknown>[]).map((row) => this.#gitToken(row));
  }
  saveGitToken(token: GitToken, secretDigest: string): void { this.#db.prepare("INSERT INTO git_tokens VALUES (?, ?, ?, ?, ?, NULL)").run(token.id, token.ownerUserId, token.name, secretDigest, token.expiresAt); }
  gitTokenByDigest(secretDigest: string): GitToken | undefined {
    const row = this.#db.prepare("SELECT * FROM git_tokens WHERE secret_digest=?").get(secretDigest) as Record<string, unknown> | undefined;
    return row ? this.#gitToken(row) : undefined;
  }
  revokeGitToken(ownerUserId: string, tokenId: string, at: string): void { this.#db.prepare("UPDATE git_tokens SET revoked_at=? WHERE owner_user_id=? AND id=?").run(at, ownerUserId, tokenId); }
  #gitToken(row: Record<string, unknown>): GitToken { return { id: String(row.id), ownerUserId: String(row.owner_user_id), name: String(row.name), expiresAt: String(row.expires_at), ...(row.revoked_at ? { revokedAt: String(row.revoked_at) } : {}) }; }

  #migrate(): void {
    this.#db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        role TEXT NOT NULL,
        password_hash TEXT,
        active_branch TEXT NOT NULL,
        created_at TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS app_identities (
        app_id TEXT NOT NULL,
        app_user_id TEXT NOT NULL,
        forge_user_id TEXT NOT NULL REFERENCES users(id),
        email TEXT NOT NULL,
        observed_at TEXT NOT NULL,
        PRIMARY KEY (app_id, app_user_id)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS om_drafts (
        owner_user_id TEXT NOT NULL REFERENCES users(id),
        path TEXT NOT NULL,
        base_revision TEXT NOT NULL,
        content TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (owner_user_id, path)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS om_workspaces (
        owner_user_id TEXT NOT NULL REFERENCES users(id),
        scope TEXT NOT NULL,
        snapshot_json TEXT NOT NULL,
        PRIMARY KEY (owner_user_id, scope)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS git_tokens (
        id TEXT PRIMARY KEY,
        owner_user_id TEXT NOT NULL REFERENCES users(id),
        name TEXT NOT NULL,
        secret_digest TEXT NOT NULL UNIQUE,
        expires_at TEXT NOT NULL,
        revoked_at TEXT
      ) STRICT;
      CREATE TABLE IF NOT EXISTS om_legacy_migrations (source TEXT PRIMARY KEY) STRICT;
      CREATE TABLE IF NOT EXISTS works (
        id TEXT PRIMARY KEY,
        owner_user_id TEXT NOT NULL REFERENCES users(id),
        app_id TEXT NOT NULL,
        work_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS works_lookup ON works(owner_user_id, app_id, work_type, entity_id, status);
      CREATE INDEX IF NOT EXISTS works_page_order ON works(owner_user_id, updated_at DESC, id DESC);
      CREATE TABLE IF NOT EXISTS report_conversations (
        owner_user_id TEXT NOT NULL REFERENCES users(id),
        app_id TEXT NOT NULL,
        work_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        work_id TEXT NOT NULL UNIQUE REFERENCES works(id),
        PRIMARY KEY (owner_user_id, app_id, work_type, entity_id)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        work_id TEXT NOT NULL REFERENCES works(id),
        created_at TEXT NOT NULL,
        last_connected_at TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS turns (
        id TEXT PRIMARY KEY,
        work_id TEXT NOT NULL REFERENCES works(id),
        sequence INTEGER NOT NULL,
        status TEXT NOT NULL,
        om_revision TEXT NOT NULL,
        catalog_digest TEXT NOT NULL,
        context_digest TEXT NOT NULL,
        started_at TEXT NOT NULL,
        completed_at TEXT
      ) STRICT;
      CREATE UNIQUE INDEX IF NOT EXISTS turns_sequence ON turns(work_id, sequence);
      CREATE TABLE IF NOT EXISTS reflections (
        id TEXT PRIMARY KEY,
        work_id TEXT REFERENCES works(id),
        owner_user_id TEXT NOT NULL REFERENCES users(id),
        lens_id TEXT NOT NULL,
        question TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS reflection_lenses (
        id TEXT PRIMARY KEY,
        version INTEGER NOT NULL,
        enabled INTEGER NOT NULL,
        prompt TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS reflection_messages (
        id TEXT PRIMARY KEY,
        reflection_id TEXT NOT NULL REFERENCES reflections(id),
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS reflection_messages_order ON reflection_messages(reflection_id, at);
      CREATE TABLE IF NOT EXISTS reflection_runs (
        id TEXT PRIMARY KEY,
        reflection_id TEXT NOT NULL REFERENCES reflections(id),
        request_id TEXT NOT NULL,
        status TEXT NOT NULL,
        snapshot_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(reflection_id, request_id)
      ) STRICT;
      CREATE UNIQUE INDEX IF NOT EXISTS reflection_run_active
        ON reflection_runs(reflection_id) WHERE status IN ('running', 'cancelling');
      CREATE TABLE IF NOT EXISTS proposals (
        id TEXT PRIMARY KEY,
        work_id TEXT REFERENCES works(id),
        reflection_id TEXT,
        owner_user_id TEXT NOT NULL REFERENCES users(id),
        base_revision TEXT NOT NULL,
        branch_ref TEXT NOT NULL,
        worktree_path TEXT NOT NULL,
        status TEXT NOT NULL,
        source TEXT NOT NULL,
        reason TEXT NOT NULL,
        evidence TEXT NOT NULL,
        reviewed_revision TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS proposals_work_order ON proposals(work_id, created_at DESC, id DESC);
      CREATE TABLE IF NOT EXISTS organization_contributions (
        id TEXT PRIMARY KEY,
        author_user_id TEXT NOT NULL REFERENCES users(id),
        source_revision TEXT NOT NULL,
        base_main_revision TEXT NOT NULL,
        reason TEXT NOT NULL,
        evidence TEXT NOT NULL,
        status TEXT NOT NULL,
        selected_paths_json TEXT NOT NULL,
        candidate_branch TEXT,
        candidate_worktree TEXT,
        reviewed_revision TEXT,
        accepted_revision TEXT,
        accepted_at TEXT,
        created_at TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS work_feedback (
        id TEXT PRIMARY KEY,
        work_id TEXT NOT NULL REFERENCES works(id),
        owner_user_id TEXT NOT NULL REFERENCES users(id),
        kind TEXT NOT NULL,
        note TEXT NOT NULL,
        at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS work_feedback_work ON work_feedback(work_id, at);
      CREATE TABLE IF NOT EXISTS mcp_catalog_candidates (
        app_id TEXT NOT NULL,
        digest TEXT NOT NULL,
        catalog_json TEXT NOT NULL,
        imported_at TEXT NOT NULL,
        PRIMARY KEY (app_id, digest)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS mcp_accepted_catalogs (
        app_id TEXT PRIMARY KEY,
        digest TEXT NOT NULL,
        accepted_by TEXT NOT NULL REFERENCES users(id),
        accepted_at TEXT NOT NULL,
        FOREIGN KEY (app_id, digest) REFERENCES mcp_catalog_candidates(app_id, digest)
      ) STRICT;
    `);
    const proposalColumns = this.#db.prepare("PRAGMA table_info(proposals)").all() as Array<{ name: string }>;
    if (!proposalColumns.some((column) => column.name === "source")) {
      this.#db.exec(`
        BEGIN;
        CREATE TABLE proposals_v2 (
          id TEXT PRIMARY KEY,
          work_id TEXT REFERENCES works(id),
          reflection_id TEXT,
          owner_user_id TEXT NOT NULL REFERENCES users(id),
          base_revision TEXT NOT NULL,
          branch_ref TEXT NOT NULL,
          worktree_path TEXT NOT NULL,
          status TEXT NOT NULL,
          source TEXT NOT NULL,
          reason TEXT NOT NULL,
          evidence TEXT NOT NULL,
          reviewed_revision TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        ) STRICT;
        INSERT INTO proposals_v2 SELECT id, work_id, reflection_id, owner_user_id, base_revision, branch_ref, worktree_path, status, 'reflection', '', '', NULL, created_at, updated_at FROM proposals;
        DROP TABLE proposals;
        ALTER TABLE proposals_v2 RENAME TO proposals;
        COMMIT;
      `);
    }
    const upgradedColumns = this.#db.prepare("PRAGMA table_info(proposals)").all() as Array<{ name: string }>;
    const workColumns = this.#db.prepare("PRAGMA table_info(works)").all() as Array<{ name: string }>;
    if (!workColumns.some((column) => column.name === "entity_title")) this.#db.exec("ALTER TABLE works ADD COLUMN entity_title TEXT");
    for (const column of ["goal", "app_user_id", "selection_json"]) if (!workColumns.some((item) => item.name === column)) this.#db.exec(`ALTER TABLE works ADD COLUMN ${column} TEXT`);
    if (!upgradedColumns.some((column) => column.name === "reviewed_revision")) this.#db.exec("ALTER TABLE proposals ADD COLUMN reviewed_revision TEXT");
    if (!upgradedColumns.some((column) => column.name === "upstream_revision")) this.#db.exec("ALTER TABLE proposals ADD COLUMN upstream_revision TEXT");
    const reflectionColumns = new Set((this.#db.prepare("PRAGMA table_info(reflections)").all() as Array<{ name: string }>).map((column) => column.name));
    for (const [name, ddl] of Object.entries({ lens_version: "INTEGER NOT NULL DEFAULT 1", lens_prompt: "TEXT NOT NULL DEFAULT ''", evidence_ids_json: "TEXT NOT NULL DEFAULT '[]'", om_revision: "TEXT NOT NULL DEFAULT ''", outcome: "TEXT", analysis: "TEXT", attribution: "TEXT", suggestion_markdown: "TEXT" })) {
      if (!reflectionColumns.has(name)) this.#db.exec(`ALTER TABLE reflections ADD COLUMN ${name} ${ddl}`);
    }
    const reflectionMessageColumns = new Set((this.#db.prepare("PRAGMA table_info(reflection_messages)").all() as Array<{ name: string }>).map((column) => column.name));
    if (!reflectionMessageColumns.has("context_json")) this.#db.exec("ALTER TABLE reflection_messages ADD COLUMN context_json TEXT");
    const columns = this.#db.prepare("PRAGMA table_info(reflections)").all() as Array<{ name: string; type: string; notnull: number; pk: number; dflt_value: string | null }>;
    if (columns.find((column) => column.name === "work_id")?.notnull) {
      const schema = this.#db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='reflections'").get() as { sql: string };
      const replacement = schema.sql.replace(/^(CREATE\s+TABLE\s+)(?:"reflections"|reflections)/i, "$1reflections_nullable").replace(/(\bwork_id\s+TEXT)\s+NOT\s+NULL/i, "$1");
      const dependents = this.#db.prepare("SELECT sql FROM sqlite_master WHERE tbl_name='reflections' AND type IN ('index', 'trigger') AND sql IS NOT NULL").all() as Array<{ sql: string }>;
      const foreignKeys = (this.#db.prepare("PRAGMA foreign_keys").get() as { foreign_keys: number }).foreign_keys;
      this.#db.exec("PRAGMA foreign_keys = OFF");
      try {
        this.#db.exec("BEGIN IMMEDIATE");
        try {
          this.#db.exec(`${replacement}; INSERT INTO reflections_nullable SELECT * FROM reflections;
            DROP TABLE reflections; ALTER TABLE reflections_nullable RENAME TO reflections;`);
          for (const dependent of dependents) this.#db.exec(dependent.sql);
          if (this.#db.prepare("PRAGMA foreign_key_check").all().length) throw new Error("ReflectionMigrationForeignKeyViolation");
          this.#db.exec("COMMIT");
        } catch (error) { this.#db.exec("ROLLBACK"); throw error; }
      } finally { this.#db.exec(`PRAGMA foreign_keys = ${foreignKeys ? "ON" : "OFF"}`); }
    }
    const defaults = [
      ["domain-knowledge", "Summarize reusable domain knowledge grounded in the selected Work events. If evidence supports a durable fact, propose one Subject Knowledge markdown file with YAML front matter (id, title, summary, topics). The front matter id must equal the markdown filename stem, and the knowledge will be listed in the Work Definition's knowledge.available. Otherwise return analysis only."],
      ["delegation-gap", "Identify a repeatable delegation or method gap grounded in the selected Work events. If evidence supports a narrow behavioral improvement, propose an edit to a Work Definition markdown document. Otherwise return analysis only."],
      ["api-suggestion", "Identify a missing App capability grounded in the selected Work events. Produce a human-readable API suggestion only when evidence supports a concrete gap. Never propose OM edits or imply that the capability already exists."],
    ] as const;
    for (const [lensId, prompt] of defaults) this.#db.prepare("INSERT OR IGNORE INTO reflection_lenses (id, version, enabled, prompt) VALUES (?, 1, 1, ?)").run(lensId, prompt);
  }

  legacyOmDrafts(ownerUserId: string): OmDraft[] {
    return (this.#db.prepare("SELECT * FROM om_drafts WHERE owner_user_id=? ORDER BY updated_at DESC, path").all(ownerUserId) as Array<Record<string, unknown>>)
      .map((row) => ({ ownerUserId: String(row.owner_user_id), path: String(row.path), baseRevision: String(row.base_revision), content: String(row.content), updatedAt: String(row.updated_at) }));
  }

  draftsForUser(ownerUserId: string): OmDraft[] {
    const draft = this.workspace(ownerUserId, "manual");
    return draft ? draft.edits.filter((edit) => edit.content !== null).map((edit) => ({ ownerUserId, path: edit.path, content: edit.content!, baseRevision: draft.baseRevision, updatedAt: "" })) : [];
  }
  saveDraft(draft: OmDraft): void {
    const current = this.workspace(draft.ownerUserId, "manual");
    if (current?.baseRevision && current.baseRevision !== draft.baseRevision) throw new Error("OmDraftBaseChanged");
    this.saveWorkspace({ ownerUserId: draft.ownerUserId, scope: "manual", baseRevision: draft.baseRevision, summary: current?.summary || "Update personal OM", conflicts: [], edits: [...(current?.edits ?? []).filter((edit) => edit.path !== draft.path), { path: draft.path, content: draft.content }] });
  }
  discardDraft(ownerUserId: string, path: string): void {
    const current = this.workspace(ownerUserId, "manual");
    if (current) this.saveWorkspace({ ...current, edits: current.edits.filter((edit) => edit.path !== path) });
  }

  ensureUser(email: string, isInitialAdmin: boolean): ForgeUser {
    const normalized = normalizeEmail(email);
    const existing = this.#db.prepare("SELECT * FROM users WHERE email = ?").get(normalized) as Record<string, unknown> | undefined;
    if (existing) return this.#user(existing);
    const user = { id: id("usr"), email: normalized, role: isInitialAdmin ? "admin" : "user" as UserRole, activeBranch: "", createdAt: new Date().toISOString() };
    user.activeBranch = `users/${user.id}`;
    this.#db.prepare("INSERT INTO users (id, email, role, active_branch, created_at) VALUES (?, ?, ?, ?, ?)").run(user.id, user.email, user.role, user.activeBranch, user.createdAt);
    return { ...user, passwordConfigured: false };
  }

  recordAppIdentity(appId: string, appUserId: string, userId: string, email: string): void {
    const linked = this.linkedUserId(appId, appUserId);
    if (linked && linked !== userId) throw new Error("AppIdentityEmailConflict");
    this.#db.prepare(`INSERT INTO app_identities (app_id, app_user_id, forge_user_id, email, observed_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(app_id, app_user_id) DO UPDATE SET forge_user_id=excluded.forge_user_id, email=excluded.email, observed_at=excluded.observed_at`).run(appId, appUserId, userId, normalizeEmail(email), new Date().toISOString());
  }

  linkedUserId(appId: string, appUserId: string): string | undefined {
    const row = this.#db.prepare("SELECT forge_user_id FROM app_identities WHERE app_id=? AND app_user_id=?").get(appId, appUserId) as { forge_user_id?: string } | undefined;
    return row?.forge_user_id;
  }

  userByEmail(email: string): ForgeUser | undefined {
    const row = this.#db.prepare("SELECT * FROM users WHERE email=?").get(normalizeEmail(email)) as Record<string, unknown> | undefined;
    return row ? this.#user(row) : undefined;
  }

  userById(userId: string): ForgeUser | undefined {
    const row = this.#db.prepare("SELECT * FROM users WHERE id=?").get(userId) as Record<string, unknown> | undefined;
    return row ? this.#user(row) : undefined;
  }

  listUsers(): ForgeUser[] {
    const rows = this.#db.prepare("SELECT * FROM users ORDER BY email").all() as Record<string, unknown>[];
    return rows.map((row) => this.#user(row));
  }

  passwordHash(email: string): string | undefined {
    const row = this.#db.prepare("SELECT password_hash FROM users WHERE email=?").get(normalizeEmail(email)) as { password_hash?: string } | undefined;
    return row?.password_hash;
  }

  setInitialPassword(userId: string, passwordHash: string): boolean { return this.#db.prepare("UPDATE users SET password_hash=? WHERE id=? AND password_hash IS NULL").run(passwordHash, userId).changes === 1; }

  saveCandidate(catalog: CapabilityCatalog): void {
    const serialized = JSON.stringify({ ...catalog, acceptedAt: "" });
    const existing = this.#db.prepare("SELECT catalog_json FROM mcp_catalog_candidates WHERE app_id=? AND digest=?").get(catalog.appId, catalog.digest) as { catalog_json: string } | undefined;
    if (existing && existing.catalog_json !== serialized) throw new Error("CatalogDigestCollision");
    this.#db.prepare("INSERT OR IGNORE INTO mcp_catalog_candidates (app_id, digest, catalog_json, imported_at) VALUES (?, ?, ?, ?)")
      .run(catalog.appId, catalog.digest, serialized, new Date().toISOString());
  }

  candidate(appId: string, digest: string): CapabilityCatalog | undefined {
    const row = this.#db.prepare("SELECT catalog_json FROM mcp_catalog_candidates WHERE app_id=? AND digest=?").get(appId, digest) as { catalog_json: string } | undefined;
    return row ? JSON.parse(row.catalog_json) as CapabilityCatalog : undefined;
  }

  candidates(appId: string): CapabilityCatalog[] {
    return (this.#db.prepare("SELECT catalog_json FROM mcp_catalog_candidates WHERE app_id=? ORDER BY imported_at DESC, digest DESC").all(appId) as Array<{ catalog_json: string }>).map((row) => JSON.parse(row.catalog_json) as CapabilityCatalog);
  }

  accept(appId: string, digest: string, acceptedBy: string): void {
    if (!this.candidate(appId, digest)) throw new Error("CatalogCandidateNotFound");
    this.#db.prepare(`INSERT INTO mcp_accepted_catalogs (app_id, digest, accepted_by, accepted_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(app_id) DO UPDATE SET digest=excluded.digest, accepted_by=excluded.accepted_by, accepted_at=excluded.accepted_at`)
      .run(appId, digest, acceptedBy, new Date().toISOString());
  }

  accepted(appId: string): CapabilityCatalog | undefined {
    const row = this.#db.prepare("SELECT c.catalog_json, a.accepted_at FROM mcp_accepted_catalogs a JOIN mcp_catalog_candidates c ON c.app_id=a.app_id AND c.digest=a.digest WHERE a.app_id=?")
      .get(appId) as { catalog_json: string; accepted_at: string } | undefined;
    return row ? { ...(JSON.parse(row.catalog_json) as CapabilityCatalog), acceptedAt: row.accepted_at } : undefined;
  }

  userForWork(workId: string): string | undefined {
    const row = this.#db.prepare("SELECT owner_user_id FROM works WHERE id=?").get(workId) as { owner_user_id?: string } | undefined;
    return row?.owner_user_id;
  }

  worksPage(filters: WorkListFilters, offset: number, limit: number): { works: Work[]; total: number } {
    const clauses: string[] = []; const values: string[] = [];
    if (filters.ownerUserId) { clauses.push("owner_user_id=?"); values.push(filters.ownerUserId); }
    if (filters.workType) { clauses.push("work_type=?"); values.push(filters.workType); }
    if (filters.status) { clauses.push("status=?"); values.push(filters.status); }
    const where = clauses.length ? ` WHERE ${clauses.join(" AND ")}` : "";
    const total = (this.#db.prepare(`SELECT COUNT(*) AS total FROM works${where}`).get(...values) as { total: number }).total;
    const rows = this.#db.prepare(`SELECT * FROM works${where} ORDER BY updated_at DESC, id DESC LIMIT ? OFFSET ?`).all(...values, limit, offset) as Record<string, unknown>[];
    return { works: rows.map((row) => this.#work(row)), total };
  }

  work(workId: string): Work | undefined {
    const row = this.#db.prepare("SELECT * FROM works WHERE id=?").get(workId) as Record<string, unknown> | undefined;
    return row ? this.#work(row) : undefined;
  }

  setWorkEntityTitle(workId: string, title: string): void {
    this.#db.prepare("UPDATE works SET entity_title=? WHERE id=?").run(title, workId);
  }

  turnsForWork(workId: string): TurnRecord[] {
    return (this.#db.prepare("SELECT * FROM turns WHERE work_id=? ORDER BY sequence").all(workId) as Record<string, unknown>[]).map((row) => ({
      id: String(row.id), workId: String(row.work_id), sequence: Number(row.sequence), status: String(row.status),
      omRevision: String(row.om_revision), catalogDigest: String(row.catalog_digest), contextDigest: String(row.context_digest), startedAt: String(row.started_at),
    }));
  }

  activeWork(ownerUserId: string, appId: string, workType: string, entityId: string): Work | undefined {
    const row = this.#db.prepare("SELECT * FROM works WHERE owner_user_id=? AND app_id=? AND work_type=? AND entity_id=? AND status='active' ORDER BY updated_at DESC, id DESC LIMIT 1").get(ownerUserId, appId, workType, entityId) as Record<string, unknown> | undefined;
    return row ? this.#work(row) : undefined;
  }

  createWork(ownerUserId: string, appId: string, workType: string, entityId: string, binding?: { goal: string; appUserId: string; selection?: Record<string, unknown> }): Work {
    const now = new Date().toISOString(); const work = { id: id("wrk"), owner_user_id: ownerUserId, app_id: appId, work_type: workType, entity_id: entityId, status: "active", created_at: now, updated_at: now };
    this.#db.prepare("INSERT INTO works (id, owner_user_id, app_id, work_type, entity_id, status, created_at, updated_at, goal, app_user_id, selection_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(...Object.values(work), binding?.goal ?? null, binding?.appUserId ?? null, binding ? JSON.stringify(binding.selection ?? {}) : null);
    return this.work(work.id)!;
  }

  ensureReportWork(ownerUserId: string, appId: string, workType: string, entityId: string, binding: { goal: string; appUserId: string }): Work {
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      const bound = this.#db.prepare("SELECT work_id FROM report_conversations WHERE owner_user_id=? AND app_id=? AND work_type=? AND entity_id=?").get(ownerUserId, appId, workType, entityId) as { work_id: string } | undefined;
      if (bound) { const work = this.work(bound.work_id)!; this.#db.exec("COMMIT"); return work; }
      const row = this.#db.prepare("SELECT * FROM works WHERE owner_user_id=? AND app_id=? AND work_type=? AND entity_id=? AND app_user_id=? AND status='active' ORDER BY updated_at DESC, id DESC LIMIT 1").get(ownerUserId, appId, workType, entityId, binding.appUserId) as Record<string, unknown> | undefined;
      const work = row ? this.#work(row) : this.createWork(ownerUserId, appId, workType, entityId, binding);
      this.#db.prepare("INSERT INTO report_conversations (owner_user_id, app_id, work_type, entity_id, work_id) VALUES (?, ?, ?, ?, ?)").run(ownerUserId, appId, workType, entityId, work.id);
      this.#db.exec("COMMIT");
      return work;
    } catch (error) { this.#db.exec("ROLLBACK"); throw error; }
  }

  createOrTouchSession(workId: string): { id: string } {
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      const now = new Date().toISOString();
      const existing = this.#db.prepare("SELECT id FROM sessions WHERE work_id=? ORDER BY last_connected_at DESC, id DESC LIMIT 1").get(workId) as { id: string } | undefined;
      const sessionId = existing?.id ?? id("ses");
      if (existing) this.#db.prepare("UPDATE sessions SET last_connected_at=? WHERE id=?").run(now, sessionId);
      else this.#db.prepare("INSERT INTO sessions (id, work_id, created_at, last_connected_at) VALUES (?, ?, ?, ?)").run(sessionId, workId, now, now);
      this.#db.exec("COMMIT");
      return { id: sessionId };
    } catch (error) { this.#db.exec("ROLLBACK"); throw error; }
  }

  nextTurn(workId: string, omRevision: string, catalogDigest: string, contextDigest: string): TurnRecord {
    const now = new Date().toISOString(); const row = this.#db.prepare("SELECT COALESCE(MAX(sequence), 0) AS sequence FROM turns WHERE work_id=?").get(workId) as { sequence: number };
    const turn = { id: id("trn"), work_id: workId, sequence: row.sequence + 1, status: "running", om_revision: omRevision, catalog_digest: catalogDigest, context_digest: contextDigest, started_at: now };
    this.#db.prepare("INSERT INTO turns (id, work_id, sequence, status, om_revision, catalog_digest, context_digest, started_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(turn.id, turn.work_id, turn.sequence, turn.status, turn.om_revision, turn.catalog_digest, turn.context_digest, turn.started_at); return { id: turn.id, workId: turn.work_id, sequence: turn.sequence, status: turn.status, omRevision: turn.om_revision, catalogDigest: turn.catalog_digest, contextDigest: turn.context_digest, startedAt: turn.started_at };
  }

  completeTurn(turnId: string, status: "completed" | "failed" | "cancelled"): void { this.#db.prepare("UPDATE turns SET status=?, completed_at=? WHERE id=?").run(status, new Date().toISOString(), turnId); }
  interruptWorkTurns(): void { this.#db.prepare("UPDATE turns SET status='interrupted', completed_at=? WHERE status='running'").run(new Date().toISOString()); }
  completeWork(workId: string): void { this.#db.prepare("UPDATE works SET status='completed', updated_at=? WHERE id=?").run(new Date().toISOString(), workId); }

  lenses(): ReflectionLens[] { return (this.#db.prepare("SELECT * FROM reflection_lenses ORDER BY id").all() as Record<string, unknown>[]).map((row) => this.#lens(row)); }
  lens(lensId: string): ReflectionLens | undefined { const row = this.#db.prepare("SELECT * FROM reflection_lenses WHERE id=?").get(lensId) as Record<string, unknown> | undefined; return row ? this.#lens(row) : undefined; }
  updateLens(lensId: string, enabled: boolean, prompt: string): ReflectionLens {
    this.#db.prepare("UPDATE reflection_lenses SET version=version+1, enabled=?, prompt=? WHERE id=?").run(enabled ? 1 : 0, prompt, lensId);
    const lens = this.lens(lensId); if (!lens) throw new Error("UnknownReflectionLens"); return lens;
  }
  private createReflection(input: Omit<ReflectionRecord, "id" | "status" | "outcome" | "analysis" | "attribution" | "suggestionMarkdown">): ReflectionRecord {
    const now = new Date().toISOString(); const reflectionId = id("rfl");
    this.#db.prepare("INSERT INTO reflections (id, work_id, owner_user_id, lens_id, question, status, created_at, updated_at, lens_version, lens_prompt, evidence_ids_json, om_revision) VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?)")
      .run(reflectionId, input.workId ?? null, input.ownerUserId, input.lensId, input.question, now, now, input.lensVersion, input.lensPrompt, JSON.stringify(input.evidenceEventIds), input.omRevision);
    return { ...input, id: reflectionId, status: "active" };
  }
  openReflection(input: Omit<ReflectionRecord, "id" | "status" | "outcome" | "analysis" | "attribution" | "suggestionMarkdown">, introduction: string): ReflectionRecord {
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      const existing = input.workId ? this.#db.prepare("SELECT * FROM reflections WHERE work_id=? ORDER BY created_at, rowid LIMIT 1").get(input.workId) as Record<string, unknown> | undefined : undefined;
      const reflection = existing ? this.#reflection(existing) : this.createReflection(input);
      const hasMessages = this.#db.prepare("SELECT 1 FROM reflection_messages WHERE reflection_id=? LIMIT 1").get(reflection.id);
      if (!hasMessages) this.appendReflectionMessage(reflection.id, "agent", introduction);
      this.#db.exec("COMMIT");
      return reflection;
    } catch (error) {
      this.#db.exec("ROLLBACK");
      throw error;
    }
  }
  reflection(reflectionId: string): ReflectionRecord | undefined { const row = this.#db.prepare("SELECT * FROM reflections WHERE id=?").get(reflectionId) as Record<string, unknown> | undefined; return row ? this.#reflection(row) : undefined; }
  reflectionRun(runId: string): ReflectionRun | undefined {
    const row = this.#db.prepare("SELECT snapshot_json FROM reflection_runs WHERE id=?").get(runId) as { snapshot_json: string } | undefined;
    return row ? JSON.parse(row.snapshot_json) as ReflectionRun : undefined;
  }
  reflectionRunForRequest(reflectionId: string, requestId: string): ReflectionRun | undefined {
    const row = this.#db.prepare("SELECT snapshot_json FROM reflection_runs WHERE reflection_id=? AND request_id=?").get(reflectionId, requestId) as { snapshot_json: string } | undefined;
    return row ? JSON.parse(row.snapshot_json) as ReflectionRun : undefined;
  }
  currentReflectionRun(reflectionId: string): ReflectionRun | undefined {
    const row = this.#db.prepare("SELECT snapshot_json FROM reflection_runs WHERE reflection_id=? ORDER BY created_at DESC, rowid DESC LIMIT 1").get(reflectionId) as { snapshot_json: string } | undefined;
    return row ? JSON.parse(row.snapshot_json) as ReflectionRun : undefined;
  }
  createReflectionRun(input: Omit<ReflectionRun, "userMessage">): ReflectionRun {
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      const userMessage = this.appendReflectionMessage(input.reflectionId, "user", input.message);
      const run = { ...input, userMessage };
      this.#db.prepare("INSERT INTO reflection_runs (id, reflection_id, request_id, status, snapshot_json, created_at) VALUES (?, ?, ?, ?, ?, ?)")
        .run(run.id, run.reflectionId, run.requestId, run.status, JSON.stringify(run), run.createdAt);
      this.#db.exec("COMMIT");
      return run;
    } catch (error) { this.#db.exec("ROLLBACK"); throw error; }
  }
  saveReflectionRun(run: ReflectionRun): void {
    this.#db.prepare("UPDATE reflection_runs SET status=?, snapshot_json=? WHERE id=?").run(run.status, JSON.stringify(run), run.id);
  }
  interruptReflectionRuns(now: string): void {
    const rows = this.#db.prepare("SELECT snapshot_json FROM reflection_runs WHERE status IN ('running', 'cancelling')").all() as Array<{ snapshot_json: string }>;
    for (const row of rows) {
      const run = JSON.parse(row.snapshot_json) as ReflectionRun;
      run.status = "interrupted"; run.error = "ReflectionInterrupted"; run.sequence++; run.updatedAt = now;
      this.saveReflectionRun(run);
    }
  }
  reflectionsForWork(workId: string): ReflectionRecord[] { return (this.#db.prepare("SELECT * FROM reflections WHERE work_id=? ORDER BY created_at DESC").all(workId) as Record<string, unknown>[]).map((row) => this.#reflection(row)); }
  reflectionsForUser(ownerUserId: string): ReflectionRecord[] { return (this.#db.prepare("SELECT * FROM reflections WHERE owner_user_id=? ORDER BY updated_at DESC, id DESC").all(ownerUserId) as Record<string, unknown>[]).map((row) => this.#reflection(row)); }
  setReflectionRevision(reflectionId: string, revision: string): void { this.#db.prepare("UPDATE reflections SET om_revision=? WHERE id=?").run(revision, reflectionId); }
  reflectionMessages(reflectionId: string): ReflectionMessage[] { return (this.#db.prepare("SELECT * FROM reflection_messages WHERE reflection_id=? ORDER BY at, rowid").all(reflectionId) as Record<string, unknown>[]).map((row) => ({ id: String(row.id), reflectionId, role: row.role as ReflectionMessage["role"], content: String(row.content), at: String(row.at), ...(row.context_json ? JSON.parse(String(row.context_json)) as Pick<ReflectionMessage, "lensId" | "lensVersion" | "citedEventIds"> : {}) })); }
  appendReflectionMessage(reflectionId: string, role: ReflectionMessage["role"], content: string, context?: { lensId: string; lensVersion: number; citedEventIds: string[] }): ReflectionMessage {
    const message = { id: id("msg"), reflectionId, role, content, at: new Date().toISOString(), ...context };
    this.#db.prepare("INSERT INTO reflection_messages (id, reflection_id, role, content, at, context_json) VALUES (?, ?, ?, ?, ?, ?)").run(message.id, reflectionId, role, content, message.at, context ? JSON.stringify(context) : null); return message;
  }
  setReflectionResult(reflectionId: string, result: { status: string; outcome?: ReflectionOutcome; analysis?: string; attribution?: string; suggestionMarkdown?: string }): void {
    if (result.status === "failed") { this.#db.prepare("UPDATE reflections SET status='failed', updated_at=? WHERE id=?").run(new Date().toISOString(), reflectionId); return; }
    this.#db.prepare("UPDATE reflections SET status=?, outcome=?, analysis=?, attribution=?, suggestion_markdown=COALESCE(?, suggestion_markdown), updated_at=? WHERE id=?")
      .run(result.status, result.outcome ?? null, result.analysis ?? null, result.attribution ?? null, result.suggestionMarkdown ?? null, new Date().toISOString(), reflectionId);
  }
  setReflectionContext(reflectionId: string, lens: ReflectionLens, evidenceEventIds: string[]): void {
    this.#db.prepare("UPDATE reflections SET lens_id=?, lens_version=?, lens_prompt=?, evidence_ids_json=?, updated_at=? WHERE id=?")
      .run(lens.id, lens.version, lens.prompt, JSON.stringify(evidenceEventIds), new Date().toISOString(), reflectionId);
  }
  #user(row: Record<string, unknown>): ForgeUser { return { id: String(row.id), email: String(row.email), role: row.role as UserRole, passwordConfigured: typeof row.password_hash === "string", activeBranch: String(row.active_branch), createdAt: String(row.created_at) }; }
  #lens(row: Record<string, unknown>): ReflectionLens { return { id: String(row.id) as ReflectionLens["id"], version: Number(row.version), enabled: Number(row.enabled) === 1, prompt: String(row.prompt) }; }
  #reflection(row: Record<string, unknown>): ReflectionRecord { return { id: String(row.id), ...(row.work_id == null ? {} : { workId: String(row.work_id) }), ownerUserId: String(row.owner_user_id), lensId: String(row.lens_id), lensVersion: Number(row.lens_version), lensPrompt: String(row.lens_prompt), question: String(row.question), evidenceEventIds: JSON.parse(String(row.evidence_ids_json)) as string[], omRevision: String(row.om_revision), status: String(row.status), ...(row.outcome ? { outcome: row.outcome as ReflectionOutcome } : {}), ...(row.analysis ? { analysis: String(row.analysis) } : {}), ...(row.attribution ? { attribution: String(row.attribution) } : {}), ...(row.suggestion_markdown ? { suggestionMarkdown: String(row.suggestion_markdown) } : {}) }; }
  #work(row: Record<string, unknown>): Work { return { id: String(row.id), ownerUserId: String(row.owner_user_id), appId: String(row.app_id) as Work["appId"], workType: String(row.work_type) as Work["workType"], entityId: String(row.entity_id), ...(typeof row.entity_title === "string" ? { entityTitle: row.entity_title } : {}), ...(typeof row.goal === "string" ? { goal: row.goal } : {}), ...(typeof row.app_user_id === "string" ? { appUserId: row.app_user_id } : {}), ...(typeof row.selection_json === "string" ? { selection: JSON.parse(row.selection_json) as Record<string, unknown> } : {}), status: row.status === "completed" ? "completed" : "active", createdAt: String(row.created_at), updatedAt: String(row.updated_at) }; }

  createContribution(record: OrganizationContribution): void {
    this.#db.prepare("INSERT INTO organization_contributions (id, author_user_id, source_revision, base_main_revision, reason, evidence, status, selected_paths_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(record.id, record.authorUserId, record.sourceRevision, record.baseMainRevision, record.reason, record.evidence, record.status, JSON.stringify(record.selectedPaths), record.createdAt);
  }
  contribution(id: string): OrganizationContribution | undefined {
    const row = this.#db.prepare("SELECT * FROM organization_contributions WHERE id=?").get(id) as Record<string, unknown> | undefined;
    return row ? this.#contribution(row) : undefined;
  }
  contributions(): OrganizationContribution[] {
    return (this.#db.prepare("SELECT * FROM organization_contributions ORDER BY created_at DESC").all() as Record<string, unknown>[]).map((row) => this.#contribution(row));
  }
  #contribution(row: Record<string, unknown>): OrganizationContribution {
    return { id: String(row.id), authorUserId: String(row.author_user_id), sourceRevision: String(row.source_revision), baseMainRevision: String(row.base_main_revision), reason: String(row.reason), evidence: String(row.evidence), status: row.status as OrganizationContribution["status"], selectedPaths: JSON.parse(String(row.selected_paths_json)) as string[], ...(row.candidate_branch ? { candidateBranch: String(row.candidate_branch) } : {}), ...(row.candidate_worktree ? { candidateWorktree: String(row.candidate_worktree) } : {}), ...(row.reviewed_revision ? { reviewedRevision: String(row.reviewed_revision) } : {}), ...(row.accepted_revision ? { acceptedRevision: String(row.accepted_revision) } : {}), createdAt: String(row.created_at) };
  }

  recordFeedback(feedback: WorkFeedback): void {
    const owner = this.userForWork(feedback.workId);
    if (owner !== feedback.ownerUserId) throw new Error("FeedbackOwnerMismatch");
    this.#db.prepare("INSERT INTO work_feedback (id, work_id, owner_user_id, kind, note, at) VALUES (?, ?, ?, ?, ?, ?)").run(feedback.id, feedback.workId, feedback.ownerUserId, feedback.kind, feedback.note, feedback.at);
  }
  feedbackForWork(workId: string): WorkFeedback[] {
    return (this.#db.prepare("SELECT * FROM work_feedback WHERE work_id=? ORDER BY at").all(workId) as Record<string, unknown>[]).map((row) => ({ id: String(row.id), workId: String(row.work_id), ownerUserId: String(row.owner_user_id), kind: row.kind as WorkFeedbackKind, note: String(row.note), at: String(row.at) }));
  }
  activityCounts() {
    const count = (sql: string): number => Number((this.#db.prepare(sql).get() as { n: number }).n);
    const medianHours = (sql: string): number | null => {
      const values = (this.#db.prepare(sql).all() as Array<{ start_at: string; end_at: string }>).map((row) => (Date.parse(row.end_at) - Date.parse(row.start_at)) / 3_600_000).filter((value) => Number.isFinite(value) && value >= 0).sort((a, b) => a - b);
      if (!values.length) return null;
      const mid = Math.floor(values.length / 2);
      return values.length % 2 ? values[mid] : (values[mid - 1] + values[mid]) / 2;
    };
    return {
      works: count("SELECT COUNT(*) AS n FROM works"), completedWorks: count("SELECT COUNT(*) AS n FROM works WHERE status='completed'"), turns: count("SELECT COUNT(*) AS n FROM turns"), reflections: count("SELECT COUNT(*) AS n FROM reflections"),
      legacyPersonalProposals: count("SELECT COUNT(*) AS n FROM proposals WHERE source!='organization-sync'"), legacyAdoptedPersonalProposals: count("SELECT COUNT(*) AS n FROM proposals WHERE source!='organization-sync' AND status='adopted'"),
      legacySynchronizedProposals: count("SELECT COUNT(*) AS n FROM proposals WHERE source='organization-sync' AND status='adopted'"),
      legacyMedianPersonalProposalHours: medianHours("SELECT created_at AS start_at, updated_at AS end_at FROM proposals WHERE source!='organization-sync' AND status='adopted'"),
    };
  }
  feedbackCounts(): Record<WorkFeedbackKind, number> {
    const counts = { "required-human-decision": 0, "avoidable-correction": 0, "knowledge-helpful": 0, "work-outcome-correct": 0, "work-outcome-incorrect": 0 };
    for (const row of this.#db.prepare("SELECT kind, COUNT(*) AS n FROM work_feedback GROUP BY kind").all() as Array<{ kind: WorkFeedbackKind; n: number }>) if (row.kind in counts) counts[row.kind] = Number(row.n);
    return counts;
  }
}
