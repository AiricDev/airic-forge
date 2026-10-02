import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import test from "node:test";
import { CertReporterClient } from "./certreporter-client.js";

const TOKEN = "fixture-bearer";
const REPORT = "report-1";

async function fixture() {
  const receipts = new Map<string, Record<string, unknown>>();
  let commandExecutions = 0;
  let lastSelection: unknown;
  let revoked = false;
  const send = (res: ServerResponse, status: number, value: unknown) => {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(value));
  };
  const body = async (req: IncomingMessage): Promise<Record<string, unknown>> => {
    let raw = "";
    for await (const chunk of req) raw += String(chunk);
    return JSON.parse(raw) as Record<string, unknown>;
  };
  const server = createServer(async (req, res) => {
    if (revoked || req.headers.authorization !== `Bearer ${TOKEN}`) { send(res, 401, { error: "Unauthorized" }); return; }
    const path = req.url ?? "";
    if (req.method === "GET" && path === "/api/v1/users/me/") { send(res, 200, { id: "app-user-1", email: "  USER@Example.com ", name: "Report author" }); return; }
    if (req.method === "GET" && path === "/airic/v1/manifest") {
      send(res, 200, { protocolVersion: "airic-domain/v1", domain: { id: "certreporter", release: "certreporter/v1", digest: "catalog-digest-1" }, capabilities: [
        { id: "report.context", kind: "query", title: "Context", description: "", inputSchema: {}, outputSchema: {} },
        { id: "report.update-master", kind: "command", title: "Update", description: "", inputSchema: {}, outputSchema: {} },
      ] }); return;
    }
    if (req.method === "GET" && path === "/airic/v1/openapi") { send(res, 200, { openapi: "3.1.0", paths: { "/airic/v1/queries/report.context": { post: { operationId: "report.context" } }, "/airic/v1/commands/report.update-master": { post: { operationId: "report.update-master" } } } }); return; }
    if (req.method === "POST" && path === "/airic/v1/queries/report.context") {
      const request = await body(req); const input = request.input as Record<string, unknown>;
      if (request.expectedDomainRelease !== "certreporter/v1" || input?.reportId !== REPORT) { send(res, 403, { error: "ReportNotAccessible" }); return; }
      lastSelection = input.selection;
      send(res, 200, { schemaVersion: "airic-cognitive/v1", resource: { namespace: "certreporter", resourceType: "report", resourceId: REPORT, revision: "3" }, projectionDigest: "context-digest-1", facts: [], gaps: [], blockers: [], allowedNextActions: [] }); return;
    }
    if (req.method === "POST" && path === "/airic/v1/commands/report.update-master") {
      const request = await body(req);
      const input = request.input as Record<string, unknown>;
      if (request.expectedDomainRelease !== "certreporter/v1" || !request.workId || !request.actionId || !request.commandId || input?.reportId !== REPORT || input.expectedRevision !== 3) { send(res, 400, { error: "InvalidCommand" }); return; }
      const commandId = String(request.commandId);
      let receipt = receipts.get(commandId);
      if (!receipt) {
        commandExecutions++;
        receipt = { commandId, status: "committed", result: { report: { id: REPORT, revision: 4 } } };
        receipts.set(commandId, receipt);
      }
      if (commandId === "lost-response") { res.destroy(); return; }
      send(res, 200, receipt); return;
    }
    if (req.method === "GET" && path.startsWith("/airic/v1/commands/receipts/")) {
      const receipt = receipts.get(decodeURIComponent(path.split("/").at(-1) ?? ""));
      send(res, receipt ? 200 : 404, receipt ?? { error: "ReceiptNotFound" }); return;
    }
    send(res, 404, { error: "NotFound" });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Fixture did not bind");
  return {
    client: new CertReporterClient(`http://127.0.0.1:${address.port}`),
    revoke: () => { revoked = true; },
    executions: () => commandExecutions,
    selection: () => lastSelection,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}

test("CertReporter contract: identity, catalog, OpenAPI and authoritative report context", async () => {
  const app = await fixture();
  try {
    assert.equal((await app.client.identity(TOKEN)).email, "user@example.com");
    const catalog = await app.client.catalog(TOKEN);
    assert.match(catalog.digest, /^[a-f0-9]{64}$/);
    assert.equal(catalog.digest, (await app.client.catalog(TOKEN)).digest);
    assert.notEqual(catalog.digest, "catalog-digest-1");
    assert.equal((await app.client.openApi(TOKEN)).openapi, "3.1.0");
    const selection = { scope: "report" };
    const context = await app.client.reportContext(TOKEN, REPORT, selection);
    assert.equal((context.resource as Record<string, unknown>).resourceId, REPORT);
    assert.deepEqual(app.selection(), selection);
    await assert.rejects(() => app.client.reportContext(TOKEN, "other-report"), /403/);
    await assert.rejects(() => app.client.identity("invalid"), /401/);
  } finally { await app.close(); }
});

test("CertReporter contract: lost command response recovers by commandId without replay", async () => {
  const app = await fixture();
  try {
    const command = { commandId: "lost-response", workId: "work-1", actionId: "action-1", expectedDomainRelease: "certreporter/v1", input: { reportId: REPORT, fields: { project_name: "Updated" }, expectedRevision: 3 } };
    await assert.rejects(() => app.client.command(TOKEN, "report.update-master", command));
    assert.equal((await app.client.receipt(TOKEN, "lost-response"))?.status, "committed");
    assert.equal(app.executions(), 1);
    app.revoke();
    await assert.rejects(() => app.client.receipt(TOKEN, "lost-response"), /401/);
  } finally { await app.close(); }
});
