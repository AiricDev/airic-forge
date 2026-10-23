import { isDeepStrictEqual } from "node:util";
import { mkdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { AppToolSnapshot, ForgeUser, ReflectionLens, ReflectionMessage, ReflectionOutcome, ReflectionRecord, ReflectionRun, TurnRecord, UserRole, Work, WorkFeedback, WorkFeedbackKind, WorkListFilters } from "@airic-forge/domain";
import { changedUser, validateUserChange, type UserChange, type UserDetail, type UserAdminEvent } from "@airic-forge/domain";
import { id, normalizeEmail } from "./ids.js";
import type { GitToken } from "@airic-forge/domain";

export class ForgeDatabase {
  readonly #db: DatabaseSync;

  constructor(dataDir: string, options: { existingOnly?: boolean } = {}) {
    const path = join(dataDir, "forge.sqlite");
    if (options.existingOnly) {
      if (!statSync(path).isFile()) throw new Error("ExistingForgeDatabaseRequired");
    } else mkdirSync(dataDir, { recursive: true });
    this.#db = new DatabaseSync(path);
    // Local maintenance must not initialize schema or change journal mode.
    if (options.existingOnly) return;
    this.#db.exec("PRAGMA busy_timeout = 5000");
    this.#db.exec("PRAGMA journal_mode = WAL");
    this.#initializeSchema();
  }

  close(): void { this.#db.close(); }

  gitTokens(ownerUserId: string): GitToken[] {
    return (this.#db.prepare("SELECT * FROM git_tokens WHERE owner_user_id=? ORDER BY rowid DESC").all(ownerUserId) as Record<string, unknown>[]).map((row) => this.#gitToken(row));
  }
  saveGitToken(token: GitToken, secretDigest: string): void {
    const result = this.#db.prepare("INSERT INTO git_tokens SELECT ?, ?, ?, ?, ?, NULL FROM users WHERE id=? AND status='active'").run(token.id, token.ownerUserId, token.name, secretDigest, token.expiresAt, token.ownerUserId);
    if (result.changes !== 1) throw new Error("Unauthorized");
  }
  gitTokenByDigest(secretDigest: string): GitToken | undefined {
    const row = this.#db.prepare("SELECT * FROM git_tokens WHERE secret_digest=?").get(secretDigest) as Record<string, unknown> | undefined;
    return row ? this.#gitToken(row) : undefined;
  }
  revokeGitToken(ownerUserId: string, tokenId: string, at: string): void { this.#db.prepare("UPDATE git_tokens SET revoked_at=? WHERE owner_user_id=? AND id=?").run(at, ownerUserId, tokenId); }
  #gitToken(row: Record<string, unknown>): GitToken { return { id: String(row.id), ownerUserId: String(row.owner_user_id), name: String(row.name), expiresAt: String(row.expires_at), ...(row.revoked_at ? { revokedAt: String(row.revoked_at) } : {}) }; }

  #initializeSchema(): void {
    this.#db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        role TEXT NOT NULL,
        password_hash TEXT,
        active_branch TEXT NOT NULL,
        created_at TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','draining','disabled')),
        version INTEGER NOT NULL DEFAULT 0 CHECK(version >= 0)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS user_admin_events (
        id TEXT PRIMARY KEY, actor_user_id TEXT, target_user_id TEXT NOT NULL REFERENCES users(id),
        request_id TEXT NOT NULL, reason TEXT NOT NULL, before_json TEXT NOT NULL, after_json TEXT NOT NULL,
        at TEXT NOT NULL, input_json TEXT NOT NULL, response_json TEXT NOT NULL, UNIQUE(actor_user_id,request_id)
      ) STRICT;
      CREATE TRIGGER IF NOT EXISTS immutable_user_admin_update BEFORE UPDATE ON user_admin_events BEGIN SELECT RAISE(ABORT,'UserAdminHistoryImmutable'); END;
      CREATE TRIGGER IF NOT EXISTS immutable_user_admin_delete BEFORE DELETE ON user_admin_events BEGIN SELECT RAISE(ABORT,'UserAdminHistoryImmutable'); END;
      CREATE TABLE IF NOT EXISTS app_identities (
        app_id TEXT NOT NULL,
        app_user_id TEXT NOT NULL,
        forge_user_id TEXT NOT NULL REFERENCES users(id),
        email TEXT NOT NULL,
        observed_at TEXT NOT NULL,
        PRIMARY KEY (app_id, app_user_id)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS git_tokens (
        id TEXT PRIMARY KEY,
        owner_user_id TEXT NOT NULL REFERENCES users(id),
        name TEXT NOT NULL,
        secret_digest TEXT NOT NULL UNIQUE,
        expires_at TEXT NOT NULL,
        revoked_at TEXT
      ) STRICT;
      CREATE TABLE IF NOT EXISTS works (
        id TEXT PRIMARY KEY,
        owner_user_id TEXT NOT NULL REFERENCES users(id),
        app_id TEXT NOT NULL,
        work_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        entity_title TEXT,
        goal TEXT,
        app_user_id TEXT,
        selection_json TEXT,
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
        lens_version INTEGER NOT NULL DEFAULT 1,
        lens_prompt TEXT NOT NULL DEFAULT '',
        evidence_ids_json TEXT NOT NULL DEFAULT '[]',
        om_revision TEXT NOT NULL DEFAULT '',
        outcome TEXT,
        analysis TEXT,
        attribution TEXT,
        suggestion_markdown TEXT,
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
        context_json TEXT,
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
      CREATE TABLE IF NOT EXISTS work_feedback (
        id TEXT PRIMARY KEY,
        work_id TEXT NOT NULL REFERENCES works(id),
        owner_user_id TEXT NOT NULL REFERENCES users(id),
        kind TEXT NOT NULL,
        note TEXT NOT NULL,
        at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS work_feedback_work ON work_feedback(work_id, at);
      CREATE TABLE IF NOT EXISTS mcp_tool_snapshots (
        app_id TEXT NOT NULL, digest TEXT NOT NULL, snapshot_json TEXT NOT NULL, discovered_at TEXT NOT NULL,
        PRIMARY KEY (app_id,digest)
      ) STRICT;
      CREATE TRIGGER IF NOT EXISTS immutable_mcp_tool_snapshot_update BEFORE UPDATE ON mcp_tool_snapshots BEGIN SELECT RAISE(ABORT,'ToolSnapshotImmutable'); END;
      CREATE TRIGGER IF NOT EXISTS immutable_mcp_tool_snapshot_delete BEFORE DELETE ON mcp_tool_snapshots BEGIN SELECT RAISE(ABORT,'ToolSnapshotImmutable'); END;
    `);
    const defaults = [
      ["domain-knowledge", "Summarize reusable domain knowledge grounded in the selected Work events. If evidence supports a durable fact, propose one Subject Knowledge markdown file with YAML front matter (id, title, summary, topics). The front matter id must equal the markdown filename stem, and the knowledge will be listed in the Work Definition's knowledge.available. Otherwise return analysis only."],
      ["delegation-gap", "Identify a repeatable delegation or method gap grounded in the selected Work events. If evidence supports a narrow behavioral improvement, propose an edit to a Work Definition markdown document. Otherwise return analysis only."],
      ["api-suggestion", "Identify a missing App capability grounded in the selected Work events. Produce a human-readable API suggestion only when evidence supports a concrete gap. Never propose OM edits or imply that the capability already exists."],
    ] as const;
    for (const [lensId, prompt] of defaults) this.#db.prepare("INSERT OR IGNORE INTO reflection_lenses (id, version, enabled, prompt) VALUES (?, 1, 1, ?)").run(lensId, prompt);
  }

  ensureUser(email: string): ForgeUser {
    const normalized = normalizeEmail(email);
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      const existing = this.userByEmail(normalized);
      if (existing) { this.#db.exec("COMMIT"); return existing; }
      const first = !(this.#db.prepare("SELECT 1 FROM users LIMIT 1").get());
      const user: ForgeUser = { id: id("usr"), email: normalized, role: first ? "admin" : "user", status: "active", version: 0, passwordConfigured: false, activeBranch: "", createdAt: new Date().toISOString() };
      user.activeBranch = `users/${user.id}`;
      this.#db.prepare("INSERT INTO users (id, email, role, active_branch, created_at, status, version) VALUES (?, ?, ?, ?, ?, ?, ?)").run(user.id, user.email, user.role, user.activeBranch, user.createdAt, user.status, user.version);
      if (first) this.#appendUserEvent(null, user.id, "initial-administrator", "First verified App user", { ...user, role: "user" }, user, "bootstrap");
      this.#db.exec("COMMIT"); return user;
    } catch (error) { this.#db.exec("ROLLBACK"); throw error; }
  }

  #appendUserEvent(actorId: string | null, targetId: string, requestId: string, reason: string, before: ForgeUser, after: ForgeUser, input: string): void {
    const snapshot = (user: ForgeUser) => JSON.stringify({ role: user.role, status: user.status, version: user.version });
    this.#db.prepare("INSERT INTO user_admin_events VALUES (?,?,?,?,?,?,?,?,?,?)").run(id("uae"), actorId, targetId, requestId, reason, snapshot(before), snapshot(after), new Date().toISOString(), input, JSON.stringify(after));
  }

  userDetail(userId: string, page: number): UserDetail {
    const user = this.userById(userId); if (!user) throw new Error("UserNotFound");
    const identities = (this.#db.prepare("SELECT app_id,app_user_id,email FROM app_identities WHERE forge_user_id=? ORDER BY app_id,app_user_id").all(userId) as Record<string, unknown>[]).map(row => ({ appId: String(row.app_id), appUserId: String(row.app_user_id), email: String(row.email) }));
    const rows = this.#db.prepare("SELECT * FROM user_admin_events WHERE target_user_id=? ORDER BY rowid DESC LIMIT 20 OFFSET ?").all(userId, (page - 1) * 20) as Record<string, unknown>[];
    const history: UserAdminEvent[] = rows.map(row => ({ id: String(row.id), actorUserId: row.actor_user_id === null ? null : String(row.actor_user_id), targetUserId: userId, requestId: String(row.request_id), reason: String(row.reason), before: JSON.parse(String(row.before_json)), after: JSON.parse(String(row.after_json)), at: String(row.at) }));
    const total = Number((this.#db.prepare("SELECT COUNT(*) AS count FROM user_admin_events WHERE target_user_id=?").get(userId) as { count: number }).count);
    return { user, identities, history, page, total };
  }

  changeUser(actorId: string, userId: string, input: UserChange, inFlight: boolean): ForgeUser {
    validateUserChange(input);
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      const actor = this.userById(actorId), target = this.userById(userId);
      if (actor?.role !== "admin" || actor.status !== "active") throw new Error("Forbidden");
      if (!target) throw new Error("UserNotFound");
      const fingerprint = JSON.stringify({ userId, expectedVersion: input.expectedVersion, reason: input.reason, role: input.role ?? null, enabled: input.enabled ?? null });
      const prior = this.#db.prepare("SELECT target_user_id,input_json,response_json FROM user_admin_events WHERE actor_user_id=? AND request_id=?").get(actorId,input.requestId) as { target_user_id: string; input_json: string; response_json: string } | undefined;
      if (prior) {
        if (prior.input_json !== fingerprint || prior.target_user_id !== userId) throw new Error("UserRequestConflict");
        this.#db.exec("COMMIT"); return JSON.parse(prior.response_json) as ForgeUser;
      }
      const admins = Number((this.#db.prepare("SELECT COUNT(*) AS count FROM users WHERE role='admin' AND status='active'").get() as { count: number }).count);
      const result = changedUser(actor, target, input, admins, inFlight);
      const updated = this.#db.prepare("UPDATE users SET role=?,status=?,version=? WHERE id=? AND version=?").run(result.role,result.status,result.version,userId,input.expectedVersion);
      if (updated.changes !== 1) throw new Error("UserVersionConflict");
      if (result.status !== "active") this.#db.prepare("UPDATE git_tokens SET revoked_at=? WHERE owner_user_id=? AND revoked_at IS NULL").run(new Date().toISOString(),userId);
      this.#appendUserEvent(actorId,userId,input.requestId,input.reason,target,result,fingerprint);
      this.#db.exec("COMMIT"); return result;
    } catch (error) { this.#db.exec("ROLLBACK"); throw error; }
  }

  finishUserDrain(userId: string): boolean {
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      const before = this.userById(userId);
      if (!before || before.status !== "draining") { this.#db.exec("COMMIT"); return false; }
      const after = { ...before, status: "disabled" as const, version: before.version + 1 };
      this.#db.prepare("UPDATE users SET status='disabled',version=version+1 WHERE id=?").run(userId);
      this.#appendUserEvent(null,userId,id("drain"),"Accepted executions have settled",before,after,"drain");
      this.#db.exec("COMMIT"); return true;
    } catch (error) { this.#db.exec("ROLLBACK"); throw error; }
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

  replacePassword(userId: string, passwordHash: string): boolean { return this.#db.prepare("UPDATE users SET password_hash=? WHERE id=?").run(passwordHash, userId).changes === 1; }

  recordToolSnapshot(snapshot: AppToolSnapshot): void {
    const serialized = JSON.stringify({ ...snapshot, discoveredAt: "" });
    const existing = this.#db.prepare("SELECT snapshot_json FROM mcp_tool_snapshots WHERE app_id=? AND digest=?").get(snapshot.appId,snapshot.digest) as {snapshot_json:string}|undefined;
    if (existing && !isDeepStrictEqual(JSON.parse(existing.snapshot_json), JSON.parse(serialized))) throw new Error("ToolSnapshotDigestCollision");
    this.#db.prepare("INSERT OR IGNORE INTO mcp_tool_snapshots VALUES (?,?,?,?)").run(snapshot.appId,snapshot.digest,serialized,snapshot.discoveredAt || new Date().toISOString());
  }

  toolSnapshot(appId: string, digest: string): AppToolSnapshot | undefined {
    const row = this.#db.prepare("SELECT snapshot_json,discovered_at FROM mcp_tool_snapshots WHERE app_id=? AND digest=?").get(appId,digest) as {snapshot_json:string;discovered_at:string}|undefined;
    return row ? { ...JSON.parse(row.snapshot_json), discoveredAt:row.discovered_at } as AppToolSnapshot : undefined;
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
  #user(row: Record<string, unknown>): ForgeUser { return { id: String(row.id), email: String(row.email), role: row.role as UserRole, status: row.status as ForgeUser["status"], version: Number(row.version), passwordConfigured: typeof row.password_hash === "string", activeBranch: String(row.active_branch), createdAt: String(row.created_at) }; }
  #lens(row: Record<string, unknown>): ReflectionLens { return { id: String(row.id) as ReflectionLens["id"], version: Number(row.version), enabled: Number(row.enabled) === 1, prompt: String(row.prompt) }; }
  #reflection(row: Record<string, unknown>): ReflectionRecord { return { id: String(row.id), ...(row.work_id == null ? {} : { workId: String(row.work_id) }), ownerUserId: String(row.owner_user_id), lensId: String(row.lens_id), lensVersion: Number(row.lens_version), lensPrompt: String(row.lens_prompt), question: String(row.question), evidenceEventIds: JSON.parse(String(row.evidence_ids_json)) as string[], omRevision: String(row.om_revision), status: String(row.status), ...(row.outcome ? { outcome: row.outcome as ReflectionOutcome } : {}), ...(row.analysis ? { analysis: String(row.analysis) } : {}), ...(row.attribution ? { attribution: String(row.attribution) } : {}), ...(row.suggestion_markdown ? { suggestionMarkdown: String(row.suggestion_markdown) } : {}) }; }
  #work(row: Record<string, unknown>): Work { return { id: String(row.id), ownerUserId: String(row.owner_user_id), appId: String(row.app_id) as Work["appId"], workType: String(row.work_type) as Work["workType"], entityId: String(row.entity_id), ...(typeof row.entity_title === "string" ? { entityTitle: row.entity_title } : {}), ...(typeof row.goal === "string" ? { goal: row.goal } : {}), ...(typeof row.app_user_id === "string" ? { appUserId: row.app_user_id } : {}), ...(typeof row.selection_json === "string" ? { selection: JSON.parse(row.selection_json) as Record<string, unknown> } : {}), status: row.status === "completed" ? "completed" : "active", createdAt: String(row.created_at), updatedAt: String(row.updated_at) }; }

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
    return {
      works: count("SELECT COUNT(*) AS n FROM works"), completedWorks: count("SELECT COUNT(*) AS n FROM works WHERE status='completed'"), turns: count("SELECT COUNT(*) AS n FROM turns"), reflections: count("SELECT COUNT(*) AS n FROM reflections"),
    };
  }
  feedbackCounts(): Record<WorkFeedbackKind, number> {
    const counts = { "required-human-decision": 0, "avoidable-correction": 0, "knowledge-helpful": 0, "work-outcome-correct": 0, "work-outcome-incorrect": 0 };
    for (const row of this.#db.prepare("SELECT kind, COUNT(*) AS n FROM work_feedback GROUP BY kind").all() as Array<{ kind: WorkFeedbackKind; n: number }>) if (row.kind in counts) counts[row.kind] = Number(row.n);
    return counts;
  }
}
