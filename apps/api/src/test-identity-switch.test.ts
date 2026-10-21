import { testUser } from "./test-users.js";
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { ForgeRuntime } from "./runtime.js";
import { buildServer } from "./server.js";
import type { ForgeConfig } from "./config.js";

test("test identity switch requires an explicit flag and the original admin session", async () => {
  const root = mkdtempSync(join(tmpdir(), "airic-forge-test-identity-"));
  const config: ForgeConfig = {
    port: 0, projectDir: join(root, "project"), dataDir: join(root, "data"),
    seedProjectDir: resolve(process.cwd(), "../../seed/certlab"), webDistDir: join(root, "web"),
    certLabUrl: "http://127.0.0.1:1", organizationId: "synthetic-org", allowedOrigin: "http://localhost:5173",
    testIdentitySwitch: false,
  };
  const runtime = new ForgeRuntime(config);
  const app = buildServer(runtime);
  try {
    const admin = testUser(runtime.db, "admin@example.com", true);
    const member = testUser(runtime.db, "member@example.com", false);
    const adminToken = runtime.webSessions.issue(admin.id);
    const memberToken = runtime.webSessions.issue(member.id);
    const switchTo = (token: string, userId: string) => app.inject({ method: "POST", url: "/api/v1/auth/test-identity", headers: { cookie: `forge_session=${token}` }, payload: { userId } });

    assert.equal((await switchTo(adminToken, member.id)).statusCode, 404);
    assert.equal(runtime.webSessions.userId(adminToken), admin.id);
    config.testIdentitySwitch = true;
    assert.equal((await switchTo(memberToken, admin.id)).statusCode, 403);
    assert.equal((await switchTo(adminToken, "missing")).statusCode, 404);

    const switched = await switchTo(adminToken, member.id);
    assert.equal(switched.statusCode, 200);
    assert.equal(switched.json().user.id, member.id);
    assert.equal(runtime.webSessions.userId(adminToken), member.id);
    assert.equal(runtime.webSessions.originalUserId(adminToken), admin.id);
    const me = await app.inject({ method: "GET", url: "/api/v1/auth/me", headers: { cookie: `forge_session=${adminToken}` } });
    assert.equal(me.json().user.id, member.id);
    assert.equal(me.json().testIdentitySwitch.originalUserId, admin.id);
    const adminOnly = await app.inject({ method: "GET", url: "/api/v1/users", headers: { cookie: `forge_session=${adminToken}` } });
    assert.equal(adminOnly.statusCode, 403);
    assert.equal((await switchTo(adminToken, admin.id)).statusCode, 200);
    assert.equal(runtime.webSessions.userId(adminToken), admin.id);
    runtime.webSessions.revoke(adminToken);
    assert.equal((await switchTo(adminToken, member.id)).statusCode, 401);
  } finally { await app.close(); runtime.db.close(); rmSync(root, { recursive: true, force: true }); }
});
