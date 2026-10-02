import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { hashPassword } from "./auth.js";
import type { ForgeConfig } from "./config.js";
import { ForgeRuntime } from "./runtime.js";
import { buildServer } from "./server.js";

test("two users are isolated; an admin can inspect without becoming the OM owner; restart keeps revisions", async () => {
  const root = mkdtempSync(join(tmpdir(), "airic-forge-stage-one-"));
  const config: ForgeConfig = {
    port: 0, projectDir: join(root, "project"), dataDir: join(root, "data"),
    seedProjectDir: resolve(process.cwd(), "../../seed/project"),
    webDistDir: join(root, "missing-web"),
    certReporterUrl: "http://127.0.0.1:1", allowedOrigin: "http://localhost:5173",
    initialAdminEmails: new Set(["admin@example.com"]),
  };
  const runtime = new ForgeRuntime(config);
  const alice = runtime.db.ensureUser("  ALICE@example.com ", false);
  const repeated = runtime.db.ensureUser("alice@EXAMPLE.com", false);
  const bob = runtime.db.ensureUser("bob@example.com", false);
  const admin = runtime.db.ensureUser("admin@example.com", true);
  assert.equal(alice.id, repeated.id);
  assert.notEqual(alice.id, bob.id);
  runtime.db.recordAppIdentity("certreporter", "app-alice", alice.id, alice.email);
  assert.equal(runtime.db.linkedUserId("certreporter", "app-alice"), alice.id);
  assert.throws(() => runtime.db.recordAppIdentity("certreporter", "app-alice", bob.id, bob.email), /AppIdentityEmailConflict/);
  assert.equal(runtime.db.linkedUserId("certreporter", "app-alice"), alice.id);
  for (const user of [alice, bob, admin]) {
    runtime.om.ensureUserBranch(user.id);
    assert.equal(runtime.db.setInitialPassword(user.id, hashPassword("stage-one-password")), true);
  }
  const app = buildServer(runtime);
  const login = async (email: string) => {
    const response = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { email, password: "stage-one-password" } });
    assert.equal(response.statusCode, 200);
    return response.headers["set-cookie"] as string;
  };
  try {
    assert.equal((await app.inject({ method: "GET", url: `/api/v1/om/users/${bob.id}` })).statusCode, 401);
    const aliceCookie = await login("ALICE@example.com");
    const aliceOm = await app.inject({ method: "GET", url: `/api/v1/om/users/${alice.id}`, headers: { cookie: aliceCookie } });
    assert.equal(aliceOm.statusCode, 200);
    assert.ok(aliceOm.json().files.includes("work-definitions/report-authoring/work.yml"));
    assert.equal((await app.inject({ method: "GET", url: `/api/v1/om/users/${bob.id}`, headers: { cookie: aliceCookie } })).statusCode, 403);
    assert.equal((await app.inject({ method: "GET", url: "/api/v1/users", headers: { cookie: aliceCookie } })).statusCode, 403);
    const adminCookie = await login("admin@example.com");
    const inspected = await app.inject({ method: "GET", url: `/api/v1/om/users/${bob.id}`, headers: { cookie: adminCookie } });
    assert.equal(inspected.statusCode, 200);
    assert.equal(inspected.json().owner.id, bob.id);
    assert.equal((await app.inject({ method: "GET", url: "/api/v1/users", headers: { cookie: adminCookie } })).json().users.length, 3);
    const revision = aliceOm.json().revision as string;
    await app.close(); runtime.db.close();
    const restarted = new ForgeRuntime(config);
    try {
      assert.equal(restarted.db.ensureUser("alice@example.com", false).id, alice.id);
      assert.equal(restarted.db.linkedUserId("certreporter", "app-alice"), alice.id);
      assert.equal(restarted.om.head(`users/${alice.id}`), revision);
    } finally { restarted.db.close(); }
  } finally { rmSync(root, { recursive: true, force: true }); }
});
