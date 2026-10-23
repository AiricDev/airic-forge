import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { ForgeDatabase } from "./database.js";
import { verifyPassword } from "./auth.js";

const cli = join(import.meta.dirname, "set-user-password-cli.js");
const run = (args: string[], input: string | Buffer = "", env: NodeJS.ProcessEnv = {}) => spawnSync(process.execPath, [cli, ...args], { input, encoding: "utf8", env: { ...process.env, ...env }, timeout: 10_000 });

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "forge password cli "));
  const db = new ForgeDatabase(root);
  const user = db.ensureUser("existing@example.invalid");
  db.recordAppIdentity("sample-app", "synthetic-app-user", user.id, user.email);
  db.close();
  return { root, user, args: ["--email", " EXISTING@example.invalid ", "--data-dir", root, "--password-stdin"], close: () => rmSync(root, { recursive: true, force: true }) };
}

test("CLI sets and resets an existing password without changing the account, identity or role", () => {
  const f = fixture();
  try {
    let previous: string | undefined;
    for (const password of ["Synthetic password one", "  Synthetic password two  "]) {
      const result = run(f.args, `${password}\n`);
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /Password updated/);
      assert(!`${result.stdout}${result.stderr}`.includes(password));
      const db = new ForgeDatabase(f.root);
      try {
        const current = db.passwordHash(f.user.email)!;
        assert(verifyPassword(password, current));
        if (previous) assert(!verifyPassword(previous, current));
        assert.notEqual(current, password);
        assert.deepEqual(db.userByEmail(f.user.email), { ...f.user, passwordConfigured: true });
        assert.equal(db.linkedUserId("sample-app", "synthetic-app-user"), f.user.id);
        assert.equal(db.listUsers().length, 1);
        assert.equal(db.setInitialPassword(f.user.id, "should-not-replace"), false);
      } finally { db.close(); }
      previous = password;
    }
  } finally { f.close(); }
});

test("CLI refuses missing users, weak, multiline, oversized and malformed UTF-8 inputs without changing a password", () => {
  const f = fixture();
  try {
    const setup = run(f.args, "Synthetic original password\n");
    assert.equal(setup.status, 0);
    const before = new ForgeDatabase(f.root);
    const original = before.passwordHash(f.user.email);
    before.close();
    const cases: Array<{ args: string[]; input: string | Buffer; error: RegExp }> = [
      { args: ["--email", "missing@example.invalid", "--data-dir", f.root, "--password-stdin"], input: "Synthetic replacement password\n", error: /user not found/ },
      { args: f.args, input: "short\n", error: /at least 12/ },
      { args: f.args, input: "Synthetic replacement\nExtra line\n", error: /exactly one/ },
      { args: f.args, input: "s".repeat(4097), error: /4096/ },
      { args: f.args, input: Buffer.from([0xff]), error: /UTF-8/ },
    ];
    for (const { args, input, error } of cases) {
      const result = run(args, input);
      assert.equal(result.status, 1);
      assert.match(result.stderr, error);
      assert.equal(result.stdout, "");
      const db = new ForgeDatabase(f.root);
      try {
        assert.equal(db.passwordHash(f.user.email), original);
        assert.equal(db.listUsers().length, 1);
      } finally { db.close(); }
    }
  } finally { f.close(); }
});

test("CLI rejects password arguments without echoing their values and requires a terminal by default", () => {
  const f = fixture();
  try {
    const secret = "Synthetic-do-not-print";
    const rejected = run([...f.args, "--password", secret]);
    assert.equal(rejected.status, 1);
    assert(!`${rejected.stdout}${rejected.stderr}`.includes(secret));
    assert.match(rejected.stderr, /Invalid arguments/);
    const noTerminal = run(f.args.filter(arg => arg !== "--password-stdin"), secret);
    assert.equal(noTerminal.status, 1);
    assert.match(noTerminal.stderr, /terminal is required/);
    const db = new ForgeDatabase(f.root);
    try { assert(!db.passwordHash(f.user.email)); } finally { db.close(); }
  } finally { f.close(); }
});

test("CLI uses configured data, refuses to initialize missing data, and help does not require a database", () => {
  const f = fixture();
  try {
    const configured = run(["--email", f.user.email, "--password-stdin"], "Synthetic configured password\r\n", { FORGE_DATA_DIR: f.root });
    assert.equal(configured.status, 0, configured.stderr);
    const missing = join(f.root, "absent");
    const rejected = run(["--email", f.user.email, "--data-dir", missing, "--password-stdin"], "Synthetic unused password\n");
    assert.equal(rejected.status, 1);
    assert.match(rejected.stderr, /No existing Forge database/);
    assert(!existsSync(missing));
    const usage = run(["--help"], "", { FORGE_DATA_DIR: missing });
    assert.equal(usage.status, 0);
    assert.match(usage.stdout, /Usage:/);
    assert(!existsSync(missing));
  } finally { f.close(); }
});

test("local password maintenance does not initialize or migrate the application's schema", () => {
  const root = mkdtempSync(join(tmpdir(), "forge-password-schema-"));
  try {
    const path = join(root, "forge.sqlite");
    const original = new DatabaseSync(path);
    original.exec("CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT, role TEXT, active_branch TEXT, created_at TEXT, password_hash TEXT); INSERT INTO users VALUES ('synthetic-user', 'existing@example.invalid', 'user', 'users/synthetic-user', '2026-10-21', NULL);");
    const schema = original.prepare("SELECT name, sql FROM sqlite_master ORDER BY name").all();
    const journal = original.prepare("PRAGMA journal_mode").get();
    original.close();
    const result = run(["--email", "existing@example.invalid", "--data-dir", root, "--password-stdin"], "Synthetic schema-safe password\n");
    assert.equal(result.status, 0, result.stderr);
    const check = new DatabaseSync(path);
    try {
      assert.deepEqual(check.prepare("SELECT name, sql FROM sqlite_master ORDER BY name").all(), schema);
      assert.deepEqual(check.prepare("PRAGMA journal_mode").get(), journal);
      const row = check.prepare("SELECT password_hash FROM users").get() as { password_hash: string };
      assert(verifyPassword("Synthetic schema-safe password", row.password_hash));
    } finally { check.close(); }
  } finally { rmSync(root, { recursive: true, force: true }); }
});
