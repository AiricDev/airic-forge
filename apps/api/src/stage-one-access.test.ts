import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { hashPassword } from "./auth.js";
import type { ForgeConfig } from "./config.js";
import { ForgeRuntime } from "./runtime.js";
import { buildServer } from "./server.js";
import { createTestProposal } from "./test-proposal-fixture.js";

test("two users are isolated; an admin can inspect without becoming the OM owner; restart keeps revisions", async () => {
  const root = mkdtempSync(join(tmpdir(), "airic-forge-stage-one-"));
  const config: ForgeConfig = {
    port: 0, projectDir: join(root, "project"), dataDir: join(root, "data"),
    seedProjectDir: resolve(process.cwd(), "../../seed/certlab"),
    webDistDir: join(root, "missing-web"),
    certLabUrl: "http://127.0.0.1:1", organizationId: "synthetic-org", allowedOrigin: "http://localhost:5173",
    initialAdminEmails: new Set(["admin@example.com"]),
  };
  const runtime = new ForgeRuntime(config);
  const alice = runtime.db.ensureUser("  ALICE@example.com ", false);
  const repeated = runtime.db.ensureUser("alice@EXAMPLE.com", false);
  const bob = runtime.db.ensureUser("bob@example.com", false);
  const admin = runtime.db.ensureUser("admin@example.com", true);
  assert.equal(alice.id, repeated.id);
  assert.notEqual(alice.id, bob.id);
  runtime.db.recordAppIdentity("certlab", "app-alice", alice.id, alice.email);
  assert.equal(runtime.db.linkedUserId("certlab", "app-alice"), alice.id);
  assert.throws(() => runtime.db.recordAppIdentity("certlab", "app-alice", bob.id, bob.email), /AppIdentityEmailConflict/);
  assert.equal(runtime.db.linkedUserId("certlab", "app-alice"), alice.id);
  for (const user of [alice, bob, admin]) {
    runtime.om.ensureUserBranch(user.id);
    assert.equal(runtime.db.setInitialPassword(user.id, hashPassword("stage-one-password")), true);
  }
  const catalog = { id: "catalog-1", appId: "certlab", domainRelease: "certlab/v1", digest: "digest-1", acceptedAt: "", capabilities: [
    { id: "report.context", kind: "query" as const, title: "Context", description: "", inputSchema: {}, outputSchema: {} },
  ] };
  runtime.db.saveCandidate(catalog, { paths: { "/airic/v1/queries/report.context": {} } });
  runtime.db.accept("certlab", catalog.digest, admin.id);
  assert.equal(runtime.db.accepted("certlab")?.digest, catalog.digest);
  const bobWork = runtime.db.createWork(bob.id, "certlab", "report-authoring", "report-bob");
  const bobTurn = runtime.db.nextTurn(bobWork.id, runtime.om.head(`users/${bob.id}`), catalog.digest, "context-digest");
  runtime.trajectories.append({ id: "event-bob", workId: bobWork.id, turnId: bobTurn.id, type: "turn.started", at: bobTurn.startedAt, payload: { omRevision: bobTurn.omRevision } });
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
    const draftPath = "work-definitions/report-authoring/method.md";
    const originalMethod = runtime.om.document(aliceOm.json().revision, draftPath);
    const draftContent = `${originalMethod}\n\nA private edit that is not active.\n`;
    const savedDraft = await app.inject({ method: "PUT", url: `/api/v1/om/users/${alice.id}/drafts`, headers: { cookie: aliceCookie }, payload: { path: draftPath, content: draftContent, baseRevision: aliceOm.json().revision } });
    assert.equal(savedDraft.statusCode, 200);
    assert.equal((await runtime.useCases.personalOm(alice.id, alice.id)).activeRevision, aliceOm.json().revision);
    assert.equal(runtime.db.proposalsForUser(alice.id).length, 0);
    assert.equal((await app.inject({ method: "GET", url: `/api/v1/om/users/${bob.id}`, headers: { cookie: aliceCookie } })).statusCode, 403);
    assert.equal((await app.inject({ method: "GET", url: "/api/v1/users", headers: { cookie: aliceCookie } })).statusCode, 403);
    assert.equal((await app.inject({ method: "GET", url: `/api/v1/works/${bobWork.id}`, headers: { cookie: aliceCookie } })).statusCode, 403);
    assert.equal((await app.inject({ method: "POST", url: "/api/v1/proposals", headers: { cookie: aliceCookie }, payload: { source: "manual", reason: "Check ownership" } })).statusCode, 404);
    const proposalId = createTestProposal(runtime, alice.id, "Check ownership", "test").id;
    const bobCookie = await login("bob@example.com");
    assert.equal((await app.inject({ method: "GET", url: `/api/v1/users/${alice.id}/proposals`, headers: { cookie: bobCookie } })).statusCode, 403);
    assert.equal((await app.inject({ method: "GET", url: `/api/v1/proposals/${proposalId}`, headers: { cookie: bobCookie } })).statusCode, 403);
    assert.equal((await app.inject({ method: "PATCH", url: `/api/v1/proposals/${proposalId}/files`, headers: { cookie: bobCookie }, payload: { path: "work-definitions/report-authoring/policy.md", content: "bad" } })).statusCode, 403);
    const adminCookie = await login("admin@example.com");
    const inspected = await app.inject({ method: "GET", url: `/api/v1/om/users/${bob.id}`, headers: { cookie: adminCookie } });
    assert.equal(inspected.statusCode, 200);
    assert.equal(inspected.json().owner.id, bob.id);
    assert.equal((await app.inject({ method: "GET", url: "/api/v1/users", headers: { cookie: adminCookie } })).json().users.length, 3);
    assert.equal((await app.inject({ method: "GET", url: `/api/v1/proposals/${proposalId}`, headers: { cookie: adminCookie } })).json().proposal.ownerUserId, alice.id);
    const history = await app.inject({ method: "GET", url: `/api/v1/works/${bobWork.id}`, headers: { cookie: adminCookie } });
    assert.equal(history.statusCode, 200);
    assert.equal(history.json().work.ownerUserId, bob.id);
    assert.equal(history.json().events[0].id, "event-bob");
    const revision = aliceOm.json().revision as string;
    await app.close(); runtime.db.close();
    const restarted = new ForgeRuntime(config);
    try {
      assert.equal(restarted.db.ensureUser("alice@example.com", false).id, alice.id);
      assert.equal(restarted.db.linkedUserId("certlab", "app-alice"), alice.id);
      assert.equal(restarted.om.head(`users/${alice.id}`), revision);
      assert.equal(restarted.db.accepted("certlab")?.digest, catalog.digest);
      assert.equal(restarted.db.draftsForUser(alice.id)[0]?.content, draftContent);
      assert.equal(restarted.om.head(`users/${alice.id}`), revision);
      assert.equal(restarted.db.work(bobWork.id)?.ownerUserId, bob.id);
      assert.equal(restarted.trajectories.read(bobWork.id)[0]?.id, "event-bob");
    } finally { restarted.db.close(); }
  } finally { rmSync(root, { recursive: true, force: true }); }
});
