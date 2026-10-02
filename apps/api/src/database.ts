import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { ForgeUser, UserRole } from "@airic-forge/domain";
import { id, normalizeEmail } from "./ids.js";

export class ForgeDatabase {
  readonly #db: DatabaseSync;

  constructor(dataDir: string) {
    mkdirSync(dataDir, { recursive: true });
    this.#db = new DatabaseSync(join(dataDir, "forge.sqlite"));
    this.#db.exec("PRAGMA journal_mode = WAL");
    this.#migrate();
  }

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
        work_id TEXT NOT NULL REFERENCES works(id),
        reflection_id TEXT NOT NULL,
        owner_user_id TEXT NOT NULL REFERENCES users(id),
        base_revision TEXT NOT NULL,
        branch_ref TEXT NOT NULL,
        worktree_path TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;
    `);
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
    this.#db.prepare(`INSERT INTO app_identities (app_id, app_user_id, forge_user_id, email, observed_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(app_id, app_user_id) DO UPDATE SET forge_user_id=excluded.forge_user_id, email=excluded.email, observed_at=excluded.observed_at`).run(appId, appUserId, userId, normalizeEmail(email), new Date().toISOString());
  }

  userByEmail(email: string): ForgeUser | undefined {
    const row = this.#db.prepare("SELECT * FROM users WHERE email=?").get(normalizeEmail(email)) as Record<string, unknown> | undefined;
    return row ? this.#user(row) : undefined;
  }

  passwordHash(email: string): string | undefined {
    const row = this.#db.prepare("SELECT password_hash FROM users WHERE email=?").get(normalizeEmail(email)) as { password_hash?: string } | undefined;
    return row?.password_hash;
  }

  setPassword(userId: string, passwordHash: string): void { this.#db.prepare("UPDATE users SET password_hash=? WHERE id=?").run(passwordHash, userId); }

  userForWork(workId: string): string | undefined {
    const row = this.#db.prepare("SELECT owner_user_id FROM works WHERE id=?").get(workId) as { owner_user_id?: string } | undefined;
    return row?.owner_user_id;
  }

  activeWork(ownerUserId: string, appId: string, workType: string, entityId: string): Record<string, unknown> | undefined {
    return this.#db.prepare("SELECT * FROM works WHERE owner_user_id=? AND app_id=? AND work_type=? AND entity_id=? AND status='active' ORDER BY updated_at DESC LIMIT 1").get(ownerUserId, appId, workType, entityId) as Record<string, unknown> | undefined;
  }

  createWork(ownerUserId: string, appId: string, workType: string, entityId: string): Record<string, unknown> {
    const now = new Date().toISOString(); const work = { id: id("wrk"), owner_user_id: ownerUserId, app_id: appId, work_type: workType, entity_id: entityId, status: "active", created_at: now, updated_at: now };
    this.#db.prepare("INSERT INTO works (id, owner_user_id, app_id, work_type, entity_id, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(...Object.values(work));
    return work;
  }

  createOrTouchSession(workId: string): Record<string, unknown> {
    const now = new Date().toISOString();
    const existing = this.#db.prepare("SELECT * FROM sessions WHERE work_id=? ORDER BY last_connected_at DESC LIMIT 1").get(workId) as Record<string, unknown> | undefined;
    if (existing) { this.#db.prepare("UPDATE sessions SET last_connected_at=? WHERE id=?").run(now, String(existing.id)); return { ...existing, last_connected_at: now }; }
    const session = { id: id("ses"), work_id: workId, created_at: now, last_connected_at: now };
    this.#db.prepare("INSERT INTO sessions (id, work_id, created_at, last_connected_at) VALUES (?, ?, ?, ?)").run(...Object.values(session)); return session;
  }

  nextTurn(workId: string, omRevision: string, catalogDigest: string, contextDigest: string): Record<string, unknown> {
    const now = new Date().toISOString(); const row = this.#db.prepare("SELECT COALESCE(MAX(sequence), 0) AS sequence FROM turns WHERE work_id=?").get(workId) as { sequence: number };
    const turn = { id: id("trn"), work_id: workId, sequence: row.sequence + 1, status: "running", om_revision: omRevision, catalog_digest: catalogDigest, context_digest: contextDigest, started_at: now };
    this.#db.prepare("INSERT INTO turns (id, work_id, sequence, status, om_revision, catalog_digest, context_digest, started_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(turn.id, turn.work_id, turn.sequence, turn.status, turn.om_revision, turn.catalog_digest, turn.context_digest, turn.started_at); return turn;
  }

  completeTurn(turnId: string, status: "completed" | "failed"): void { this.#db.prepare("UPDATE turns SET status=?, completed_at=? WHERE id=?").run(status, new Date().toISOString(), turnId); }
  completeWork(workId: string): void { this.#db.prepare("UPDATE works SET status='completed', updated_at=? WHERE id=?").run(new Date().toISOString(), workId); }

  createReflection(workId: string, ownerUserId: string, lensId: string, question: string): Record<string, unknown> {
    const now = new Date().toISOString(); const reflection = { id: id("rfl"), work_id: workId, owner_user_id: ownerUserId, lens_id: lensId, question, status: "active", created_at: now, updated_at: now };
    this.#db.prepare("INSERT INTO reflections (id, work_id, owner_user_id, lens_id, question, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(reflection.id, reflection.work_id, reflection.owner_user_id, reflection.lens_id, reflection.question, reflection.status, reflection.created_at, reflection.updated_at);
    return reflection;
  }

  createProposal(proposalId: string, reflectionId: string, workId: string, ownerUserId: string, baseRevision: string, branchRef: string, worktreePath: string): Record<string, unknown> {
    const now = new Date().toISOString(); const proposal = { id: proposalId, work_id: workId, reflection_id: reflectionId, owner_user_id: ownerUserId, base_revision: baseRevision, branch_ref: branchRef, worktree_path: worktreePath, status: "open", created_at: now, updated_at: now };
    this.#db.prepare("INSERT INTO proposals (id, work_id, reflection_id, owner_user_id, base_revision, branch_ref, worktree_path, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(proposal.id, proposal.work_id, proposal.reflection_id, proposal.owner_user_id, proposal.base_revision, proposal.branch_ref, proposal.worktree_path, proposal.status, proposal.created_at, proposal.updated_at);
    return proposal;
  }

  proposal(proposalId: string): Record<string, unknown> | undefined { return this.#db.prepare("SELECT * FROM proposals WHERE id=?").get(proposalId) as Record<string, unknown> | undefined; }
  adoptProposal(proposalId: string): void { this.#db.prepare("UPDATE proposals SET status='adopted', updated_at=? WHERE id=?").run(new Date().toISOString(), proposalId); }

  #user(row: Record<string, unknown>): ForgeUser { return { id: String(row.id), email: String(row.email), role: row.role as UserRole, passwordConfigured: typeof row.password_hash === "string", activeBranch: String(row.active_branch), createdAt: String(row.created_at) }; }
}
