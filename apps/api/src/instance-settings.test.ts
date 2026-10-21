import assert from "node:assert/strict";
import test from "node:test";
import { join } from "node:path";
import { CertLabClient } from "./certlab-client.js";
import { omFixture } from "./om-test-fixture.js";
import { buildServer } from "./server.js";

test("integration settings describe the configured App's MCP endpoint and transport", () => {
  const client = new CertLabClient("https://app.example:8443/", "organization-one");
  assert.deepEqual(client.describeIntegration(), {
    appId: "certlab", organizationId: "organization-one", baseUrl: "https://app.example:8443",
    mcpUrl: "https://app.example:8443/mcp", transport: "streamable-http",
  });
});

test("only administrators can read effective instance storage and integration settings, without secrets", async () => {
  const f = omFixture();
  const app = buildServer(f.runtime);
  try {
    f.runtime.config.modelApiKey = "private-model-key-must-not-appear";
    const read = (id?: string) => app.inject({ method: "GET", url: "/api/v1/instance-settings",
      ...(id ? { headers: { cookie: `forge_session=${f.runtime.webSessions.issue(id)}` } } : {}) });
    assert.equal((await read()).statusCode, 401);
    const forbidden = await read(f.owner.id);
    assert.equal(forbidden.statusCode, 403);
    assert(!forbidden.body.includes(f.config.dataDir));
    const response = await read(f.admin.id);
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), {
      operatingModel: { repositoryPath: f.config.projectDir, dataPath: f.config.dataDir, personalWorktreesPath: join(f.config.dataDir, "worktrees", "users") },
      integration: { appId: "certlab", organizationId: f.config.organizationId, baseUrl: f.config.certLabUrl,
        mcpUrl: `${f.config.certLabUrl}/mcp`, transport: "streamable-http", },
    });
    assert(!response.body.includes("private-model-key-must-not-appear"));
    assert(!response.body.includes("modelApiKey"));
  } finally { await app.close(); await f.close(); }
});
