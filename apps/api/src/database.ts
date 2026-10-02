import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { CapabilityCatalog, ForgeUser, ProposalRecord, ReflectionRecord, TurnRecord, UserRole, Work } from "@airic-forge/domain";
import { id, normalizeEmail } from "./ids.js";

export class ForgeDatabase {
  readonly #db: DatabaseSync;

  constructor(dataDir: string) {
    mkdirSync(dataDir, { recursive: true });
    this.#db = new DatabaseSync(join(dataDir, "forge.sqlite"));
    this.#db.exec("PRAGMA journal_mode = WAL");
    this.#migrate();
  }

  close(): void { this.#db.close(); }

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
        work_id TEXT NOT NULL REFERENCES works(id),
        owner_user_id TEXT NOT NULL REFERENCES users(id),
        lens_id TEXT NOT NULL,
        question TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;
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
      CREATE TABLE IF NOT EXISTS catalog_candidates (
        app_id TEXT NOT NULL,
        digest TEXT NOT NULL,
        catalog_json TEXT NOT NULL,
        openapi_json TEXT NOT NULL,
        imported_at TEXT NOT NULL,
        PRIMARY KEY (app_id, digest)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS accepted_catalogs (
        app_id TEXT PRIMARY KEY,
        digest TEXT NOT NULL,
        accepted_by TEXT NOT NULL REFERENCES users(id),
        accepted_at TEXT NOT NULL,
        FOREIGN KEY (app_id, digest) REFERENCES catalog_candidates(app_id, digest)
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
    if (!upgradedColumns.some((column) => column.name === "reviewed_revision")) this.#db.exec("ALTER TABLE proposals ADD COLUMN reviewed_revision TEXT");
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

  saveCandidate(catalog: CapabilityCatalog, openApi: Record<string, unknown>): void {
    const serialized = JSON.stringify({ ...catalog, acceptedAt: "" });
    const existing = this.#db.prepare("SELECT catalog_json FROM catalog_candidates WHERE app_id=? AND digest=?").get(catalog.appId, catalog.digest) as { catalog_json: string } | undefined;
    if (existing && existing.catalog_json !== serialized) throw new Error("CatalogDigestCollision");
    this.#db.prepare("INSERT OR IGNORE INTO catalog_candidates (app_id, digest, catalog_json, openapi_json, imported_at) VALUES (?, ?, ?, ?, ?)")
      .run(catalog.appId, catalog.digest, serialized, JSON.stringify(openApi), new Date().toISOString());
  }

  candidate(appId: string, digest: string): CapabilityCatalog | undefined {
    const row = this.#db.prepare("SELECT catalog_json FROM catalog_candidates WHERE app_id=? AND digest=?").get(appId, digest) as { catalog_json: string } | undefined;
    return row ? JSON.parse(row.catalog_json) as CapabilityCatalog : undefined;
  }

  accept(appId: string, digest: string, acceptedBy: string): void {
    if (!this.candidate(appId, digest)) throw new Error("CatalogCandidateNotFound");
    this.#db.prepare(`INSERT INTO accepted_catalogs (app_id, digest, accepted_by, accepted_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(app_id) DO UPDATE SET digest=excluded.digest, accepted_by=excluded.accepted_by, accepted_at=excluded.accepted_at`)
      .run(appId, digest, acceptedBy, new Date().toISOString());
  }

  accepted(appId: string): CapabilityCatalog | undefined {
    const row = this.#db.prepare("SELECT c.catalog_json, a.accepted_at FROM accepted_catalogs a JOIN catalog_candidates c ON c.app_id=a.app_id AND c.digest=a.digest WHERE a.app_id=?")
      .get(appId) as { catalog_json: string; accepted_at: string } | undefined;
    return row ? { ...(JSON.parse(row.catalog_json) as CapabilityCatalog), acceptedAt: row.accepted_at } : undefined;
  }

  userForWork(workId: string): string | undefined {
    const row = this.#db.prepare("SELECT owner_user_id FROM works WHERE id=?").get(workId) as { owner_user_id?: string } | undefined;
    return row?.owner_user_id;
  }

  worksForUser(ownerUserId: string): Work[] {
    return (this.#db.prepare("SELECT * FROM works WHERE owner_user_id=? ORDER BY updated_at DESC").all(ownerUserId) as Record<string, unknown>[]).map((row) => this.#work(row));
  }

  work(workId: string): Work | undefined {
    const row = this.#db.prepare("SELECT * FROM works WHERE id=?").get(workId) as Record<string, unknown> | undefined;
    return row ? this.#work(row) : undefined;
  }

  turnsForWork(workId: string): TurnRecord[] {
    return (this.#db.prepare("SELECT * FROM turns WHERE work_id=? ORDER BY sequence").all(workId) as Record<string, unknown>[]).map((row) => ({
      id: String(row.id), workId: String(row.work_id), sequence: Number(row.sequence), status: String(row.status),
      omRevision: String(row.om_revision), catalogDigest: String(row.catalog_digest), contextDigest: String(row.context_digest), startedAt: String(row.started_at),
    }));
  }

  activeWork(ownerUserId: string, appId: string, workType: string, entityId: string): Work | undefined {
    const row = this.#db.prepare("SELECT * FROM works WHERE owner_user_id=? AND app_id=? AND work_type=? AND entity_id=? AND status='active' ORDER BY updated_at DESC LIMIT 1").get(ownerUserId, appId, workType, entityId) as Record<string, unknown> | undefined;
    return row ? this.#work(row) : undefined;
  }

  createWork(ownerUserId: string, appId: string, workType: string, entityId: string): Work {
    const now = new Date().toISOString(); const work = { id: id("wrk"), owner_user_id: ownerUserId, app_id: appId, work_type: workType, entity_id: entityId, status: "active", created_at: now, updated_at: now };
    this.#db.prepare("INSERT INTO works (id, owner_user_id, app_id, work_type, entity_id, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(...Object.values(work));
    return this.#work(work);
  }

  createOrTouchSession(workId: string): { id: string } {
    const now = new Date().toISOString();
    const existing = this.#db.prepare("SELECT * FROM sessions WHERE work_id=? ORDER BY last_connected_at DESC LIMIT 1").get(workId) as Record<string, unknown> | undefined;
    if (existing) { this.#db.prepare("UPDATE sessions SET last_connected_at=? WHERE id=?").run(now, String(existing.id)); return { id: String(existing.id) }; }
    const session = { id: id("ses"), work_id: workId, created_at: now, last_connected_at: now };
    this.#db.prepare("INSERT INTO sessions (id, work_id, created_at, last_connected_at) VALUES (?, ?, ?, ?)").run(...Object.values(session)); return { id: session.id };
  }

  nextTurn(workId: string, omRevision: string, catalogDigest: string, contextDigest: string): TurnRecord {
    const now = new Date().toISOString(); const row = this.#db.prepare("SELECT COALESCE(MAX(sequence), 0) AS sequence FROM turns WHERE work_id=?").get(workId) as { sequence: number };
    const turn = { id: id("trn"), work_id: workId, sequence: row.sequence + 1, status: "running", om_revision: omRevision, catalog_digest: catalogDigest, context_digest: contextDigest, started_at: now };
    this.#db.prepare("INSERT INTO turns (id, work_id, sequence, status, om_revision, catalog_digest, context_digest, started_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(turn.id, turn.work_id, turn.sequence, turn.status, turn.om_revision, turn.catalog_digest, turn.context_digest, turn.started_at); return { id: turn.id, workId: turn.work_id, sequence: turn.sequence, status: turn.status, omRevision: turn.om_revision, catalogDigest: turn.catalog_digest, contextDigest: turn.context_digest, startedAt: turn.started_at };
  }

  completeTurn(turnId: string, status: "completed" | "failed"): void { this.#db.prepare("UPDATE turns SET status=?, completed_at=? WHERE id=?").run(status, new Date().toISOString(), turnId); }
  completeWork(workId: string): void { this.#db.prepare("UPDATE works SET status='completed', updated_at=? WHERE id=?").run(new Date().toISOString(), workId); }

  createReflection(workId: string, ownerUserId: string, lensId: string, question: string): ReflectionRecord {
    const now = new Date().toISOString(); const reflection = { id: id("rfl"), work_id: workId, owner_user_id: ownerUserId, lens_id: lensId, question, status: "active", created_at: now, updated_at: now };
    this.#db.prepare("INSERT INTO reflections (id, work_id, owner_user_id, lens_id, question, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(reflection.id, reflection.work_id, reflection.owner_user_id, reflection.lens_id, reflection.question, reflection.status, reflection.created_at, reflection.updated_at);
    return { id: reflection.id, workId, ownerUserId, lensId, question, status: reflection.status };
  }

  createProposal(input: ProposalRecord): ProposalRecord {
    const now = new Date().toISOString(); const proposal = { id: input.id, work_id: input.workId ?? null, reflection_id: input.reflectionId ?? null, owner_user_id: input.ownerUserId, base_revision: input.baseRevision, branch_ref: input.branchRef, worktree_path: input.worktreePath, status: input.status, source: input.source, reason: input.reason, evidence: input.evidence, reviewed_revision: input.reviewedRevision ?? null, created_at: now, updated_at: now };
    this.#db.prepare("INSERT INTO proposals (id, work_id, reflection_id, owner_user_id, base_revision, branch_ref, worktree_path, status, source, reason, evidence, reviewed_revision, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(...Object.values(proposal));
    return input;
  }

  proposal(proposalId: string): ProposalRecord | undefined { const row = this.#db.prepare("SELECT * FROM proposals WHERE id=?").get(proposalId) as Record<string, unknown> | undefined; return row ? this.#proposal(row) : undefined; }
  proposalsForUser(ownerUserId: string): ProposalRecord[] { return (this.#db.prepare("SELECT * FROM proposals WHERE owner_user_id=? ORDER BY created_at DESC").all(ownerUserId) as Record<string, unknown>[]).map((row) => this.#proposal(row)); }
  updateProposalBase(proposalId: string, baseRevision: string): void { this.#db.prepare("UPDATE proposals SET base_revision=?, reviewed_revision=NULL, updated_at=? WHERE id=? AND status='open'").run(baseRevision, new Date().toISOString(), proposalId); }
  setProposalReview(proposalId: string, revision: string | undefined): void { this.#db.prepare("UPDATE proposals SET reviewed_revision=?, updated_at=? WHERE id=? AND status='open'").run(revision ?? null, new Date().toISOString(), proposalId); }
  adoptProposal(proposalId: string): void { this.#db.prepare("UPDATE proposals SET status='adopted', updated_at=? WHERE id=?").run(new Date().toISOString(), proposalId); }

  #user(row: Record<string, unknown>): ForgeUser { return { id: String(row.id), email: String(row.email), role: row.role as UserRole, passwordConfigured: typeof row.password_hash === "string", activeBranch: String(row.active_branch), createdAt: String(row.created_at) }; }
  #work(row: Record<string, unknown>): Work { return { id: String(row.id), ownerUserId: String(row.owner_user_id), appId: "certreporter", workType: "report-authoring", entityId: String(row.entity_id), status: row.status === "completed" ? "completed" : "active", createdAt: String(row.created_at), updatedAt: String(row.updated_at) }; }
  #proposal(row: Record<string, unknown>): ProposalRecord { return { id: String(row.id), ...(row.reflection_id == null ? {} : { reflectionId: String(row.reflection_id) }), ...(row.work_id == null ? {} : { workId: String(row.work_id) }), ownerUserId: String(row.owner_user_id), baseRevision: String(row.base_revision), branchRef: String(row.branch_ref), worktreePath: String(row.worktree_path), status: String(row.status), source: String(row.source), reason: String(row.reason), evidence: String(row.evidence), ...(row.reviewed_revision == null ? {} : { reviewedRevision: String(row.reviewed_revision) }) }; }
}
