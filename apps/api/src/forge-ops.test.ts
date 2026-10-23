import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { initializeInstance } from "./forge-ops.js";
import { loadConfig } from "./config.js";
import { ForgeRuntime } from "./runtime.js";
import { checkAgentResources } from "./agent-resources.js";
import { createTestOmCommit } from "./om-commit-fixture.js";

test("explicit initialization validates a seed, records provenance and never overwrites runtime OM on repeat", async () => {
  const root = mkdtempSync(join(tmpdir(), "forge-init-"));
  const config = { ...loadConfig({}), projectDir: join(root, "project"), dataDir: join(root, "data"), organizationId: "synthetic" };
  try {
    await checkAgentResources(config, true);
    const first = await initializeInstance(config, resolve("../../seed/certlab")); assert.equal(first.initialized, true);
    const runtime = new ForgeRuntime(config);
    const user = runtime.db.ensureUser("owner@example.invalid"); runtime.om.ensureUserBranch(user.id);
    const path = "work-definitions/report-authoring/policy.md";
    const committed = await createTestOmCommit(runtime, user.id, [{ path, content: runtime.om.document(first.revision, path) + "\nOrganization experience.\n" }], "Personal method");
    runtime.db.close();
    const next = await initializeInstance(config, "/unavailable-new-release-seed"); assert.equal(next.initialized, false);
    const reopened = new ForgeRuntime(config);
    assert.equal(reopened.om.head(`users/${user.id}`), committed.revision); reopened.db.close();
  } finally { rmSync(root, { recursive: true, force: true }); }
});
