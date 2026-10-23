import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { initializeInstance } from "./forge-ops.js";
import { backupDeployment, restoreDeployment, verifyDeployment } from "./deployment-state.js";
import { openNativeSession } from "./pi-native-session.js";
import { loadConfig } from "./config.js";
import { ForgeRuntime } from "./runtime.js";
import { acquireServiceLock } from "./service-lock.js";

test("offline snapshot verifies integrity and relocates Git drafts and the explicitly bound native session", async () => {
  const root = mkdtempSync(join(tmpdir(), "forge-snapshot-"));
  const config = { ...loadConfig({}), projectDir: join(root, "original/project"), dataDir: join(root, "original/data"), organizationId: "synthetic", modelProvider: "deepseek", modelId: "deepseek-flash", modelApiKey: "synthetic" };
  try {
    await initializeInstance(config, resolve("../../seed/certlab"));
    const runtime = new ForgeRuntime(config); const user = runtime.db.ensureUser("owner@example.invalid"); runtime.om.ensureUserBranch(user.id);
    const revision = runtime.om.head(user.activeBranch);
    await runtime.omChanges.save(user.id, "manual", { baseRevision: revision, edits: [{ path: "work-definitions/report-authoring/policy.md", content: "Unfinished draft" }], summary: "Preserve work" });
    runtime.db.close();
    const args = { scope: { organizationId: "synthetic", ownerUserId: user.id, workId: "work", turnId: "turn", omRevision: revision, catalogDigest: "tools" }, kind: "work" as const, id: "work", tools: [], instructions: "Read", documents: [] };
    const first = await openNativeSession(config, args); first.session.sessionManager.appendMessage({ role: "user", content: "Continue original source", timestamp: 0 });
    const sessionId = first.session.sessionId; writeFileSync(join(first.cwd, "progress.md"), "Original revision page 4; next inspect diagram."); await first.close();
    const app = join(root, "app-backup"); mkdirSync(app); writeFileSync(join(app, "manifest.json"), JSON.stringify({ status: "complete" }));
    const target = join(root, "snapshot"); const release = acquireServiceLock(config.dataDir);
    assert.throws(() => backupDeployment(config, target, app), /ForgeServiceRunning/); release();
    backupDeployment(config, target, app); verifyDeployment(target);
    const recovered = { ...config, projectDir: join(root, "recovered/project"), dataDir: join(root, "recovered/data") };
    assert.throws(() => restoreDeployment({ ...recovered, deploymentId: "other-version" }, target), /RestoreDeploymentVersionMismatch/);
    restoreDeployment(recovered, target);
    const reopened = new ForgeRuntime(recovered);
    assert.equal(reopened.om.head(user.activeBranch), revision);
    assert.equal(reopened.drafts.workspace(user.id, "manual")?.edits[0].content, "Unfinished draft"); reopened.db.close();
    const resumed = await openNativeSession(recovered, args);
    assert.equal(resumed.session.sessionId, sessionId); assert.match(readFileSync(join(resumed.cwd, "progress.md"), "utf8"), /page 4/); await resumed.close();
    assert.throws(() => restoreDeployment(recovered, target), /RestoreTargetMustNotExist/);
    writeFileSync(join(target, "app/manifest.json"), "{}"); assert.throws(() => verifyDeployment(target), /SnapshotChecksumMismatch/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
