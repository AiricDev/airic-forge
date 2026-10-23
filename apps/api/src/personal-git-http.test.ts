import assert from "node:assert/strict";
import test from "node:test";
import { writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { buildServer } from "./server.js";
import { omFixture } from "./om-test-fixture.js";
const exec = promisify(execFile);
const path = "work-definitions/document-task/policy.md";

test("native Git clone/push/pull preserves commits and enforces identity, refs and object isolation", async () => {
  const f = omFixture();
  const app = buildServer(f.runtime);
  try {
    const address = await app.listen({ host: "127.0.0.1", port: 0 });
    const token = await f.runtime.gitAccess.issue(f.owner.id, "Laptop");
    const remote = `${address}/git/personal/${f.owner.id}.git`;
    const askpass = join(f.root, "askpass");
    writeFileSync(askpass, '#!/bin/sh\nprintf "%s\\n" "$FORGE_TEST_TOKEN"\n', { mode: 0o700 });
    const env = { ...process.env, GIT_ASKPASS: askpass, GIT_TERMINAL_PROMPT: "0", FORGE_TEST_TOKEN: token.secret };
    const git = async (args: string[], cwd = f.root) => (await exec("git", ["-c", "credential.helper=", ...args], { cwd, env, timeout: 30_000 })).stdout.trim();
    const local = join(f.root, "local");
    await git(["clone", remote, local]);
    const base = await git(["rev-parse", "HEAD"], local);
    writeFileSync(join(local, path), readFileSync(join(local, path), "utf8") + "\nNative Git improvement.\n");
    await git(["add", path], local); await git(["commit", "-m", "Improve policy"], local);
    const revision = await git(["rev-parse", "HEAD"], local);
    await git(["push", "origin", "main"], local);
    assert.equal(f.runtime.om.head(`users/${f.owner.id}`), revision);
    assert.match(f.runtime.om.document(revision, path), /Native Git improvement/);
    await assert.rejects(git(["push", "--force", "origin", `${base}:main`], local));
    await assert.rejects(git(["push", "origin", "HEAD:refs/heads/users/bob"], local));
    await assert.rejects(git(["push", "origin", "HEAD:refs/tags/unwanted"], local));
    await assert.rejects(git(["ls-remote", `${address}/git/personal/${f.other.id}.git`]));
    const privateDraft = await f.save(f.other.id, "manual", path, f.runtime.om.document(base, path) + "\nPrivate other-user method.\n");
    const privateCommit = await f.runtime.omChanges.commit(f.other.id, "manual", privateDraft.digest, "private-other-commit");
    await assert.rejects(git(["fetch", "origin", privateCommit.revision], local));
    assert.equal(f.runtime.om.head(`users/${f.owner.id}`), revision);
    const web = await f.save(f.owner.id, "manual", path, f.runtime.om.document(revision, path) + "\nWeb improvement.\n");
    const webCommit = await f.runtime.omChanges.commit(f.owner.id, "manual", web.digest, "web-improvement");
    await git(["pull", "--ff-only"], local);
    assert.equal(await git(["rev-parse", "HEAD"], local), webCommit.revision);
    writeFileSync(join(local, "private-workspace.txt"), "Not an OM document");
    await git(["add", "private-workspace.txt"], local); await git(["commit", "-m", "Invalid upload"], local);
    await assert.rejects(git(["push", "origin", "main"], local));
    assert.equal(f.runtime.om.head(`users/${f.owner.id}`), webCommit.revision);
    const adminToken = await f.runtime.gitAccess.issue(f.admin.id, "Admin laptop");
    await assert.rejects(exec("git", ["-c", "credential.helper=", "ls-remote", remote], { cwd: f.root, env: { ...env, FORGE_TEST_TOKEN: adminToken.secret }, timeout: 30_000 }));
    await f.runtime.gitAccess.revoke(f.owner.id, token.token.id);
    await assert.rejects(git(["ls-remote", remote]));
  } finally { await app.close(); await f.close(); }
});

test("Git token endpoints require the owner's session, protect cross-site writes, and never list secrets", async () => {
  const f = omFixture(); const app = buildServer(f.runtime);
  try {
    const cookie = { cookie: `forge_session=${f.runtime.webSessions.issue(f.owner.id)}` };
    assert.equal((await app.inject({ method: "POST", url: "/api/v1/git/tokens", payload: { name: "Laptop" } })).statusCode, 401);
    assert.equal((await app.inject({ method: "POST", url: "/api/v1/git/tokens", headers: { ...cookie, origin: "https://evil.invalid" }, payload: { name: "Laptop" } })).statusCode, 403);
    const issued = await app.inject({ method: "POST", url: "/api/v1/git/tokens", headers: cookie, payload: { name: "Laptop" } });
    assert.equal(issued.statusCode, 200);
    const list = await app.inject({ method: "GET", url: "/api/v1/git/tokens", headers: cookie });
    assert.equal(list.json().tokens.length, 1);
    assert(!list.body.includes(issued.json().secret));
    const expired = await f.runtime.gitAccess.issue(f.other.id, "Expired");
    f.runtime.db.revokeGitToken(f.other.id, expired.token.id, new Date().toISOString());
    await assert.rejects(() => f.runtime.gitAccess.authenticate(expired.secret, f.other.id), /Unauthorized/);
  } finally { await app.close(); await f.close(); }
});

test("remote Git requires HTTPS and only trusts forwarded protocol from a configured proxy", async () => {
  for (const trustedProxy of [undefined, "127.0.0.1"]) {
    const f = omFixture();
    f.runtime.config.publicUrl = "https://forge.example";
    f.runtime.config.trustedProxy = trustedProxy;
    const app = buildServer(f.runtime);
    try {
      const issued = await f.runtime.gitAccess.issue(f.owner.id, "TLS check");
      const request = {
        method: "GET" as const,
        url: `/git/personal/${f.owner.id}.git/info/refs?service=git-upload-pack`,
        headers: { authorization: `Bearer ${issued.secret}`, "x-forwarded-proto": "https" },
      };
      const spoofed = await app.inject({ ...request, remoteAddress: "203.0.113.2" });
      assert.equal(spoofed.statusCode, 409);
      assert.equal(spoofed.body, "GitHttpsRequired");
      const proxy = await app.inject({ ...request, remoteAddress: "127.0.0.1" });
      assert.equal(proxy.statusCode, trustedProxy ? 200 : 409);
    } finally { await app.close(); await f.close(); }
  }
});
