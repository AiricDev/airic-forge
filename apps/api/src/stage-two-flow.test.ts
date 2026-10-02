import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { ForgeUseCases, type CapabilityCatalog, type CertReporterPort, type AgentRunnerPort } from "@airic-forge/domain";
import { hashPassword, verifyPassword } from "./auth.js";
import { InMemoryAppSessionStore } from "./app-session-store.js";
import type { ForgeConfig } from "./config.js";
import { InMemoryPasswordSetupStore } from "./password-setup-store.js";
import { ForgeRuntime } from "./runtime.js";
import { systemPort } from "./system-port.js";

test("accepted catalog and real Git/SQLite/JSONL keep a report command and its Turn across restart", async () => {
  const root = mkdtempSync(join(tmpdir(), "airic-forge-stage-two-"));
  const config: ForgeConfig = { port: 0, projectDir: join(root, "project"), dataDir: join(root, "data"), seedProjectDir: resolve(process.cwd(), "../../seed/project"), webDistDir: join(root, "web"), certReporterUrl: "http://127.0.0.1:1", allowedOrigin: "http://localhost:5173", initialAdminEmails: new Set(["author@example.com"]) };
  const ids = ["report.context", "report.read", "report.gaps", "report.update-master", "report.update-data"];
  const catalog: CapabilityCatalog = { id: "catalog", appId: "certreporter", domainRelease: "certreporter/v1", digest: "accepted-catalog", acceptedAt: "", capabilities: ids.map((id) => ({ id, kind: id.startsWith("report.update") ? "command" : "query", title: id, description: "", inputSchema: {}, outputSchema: {} })) };
  let revision = 3;
  let submissions = 0;
  const receipts = new Map<string, Record<string, unknown>>();
  const app: CertReporterPort = {
    identity: async () => ({ appId: "certreporter", appUserId: "author", email: "AUTHOR@example.com", displayName: "Author" }),
    catalog: async () => structuredClone(catalog),
    openApi: async () => ({ paths: Object.fromEntries(catalog.capabilities.map((item) => [`/airic/v1/${item.kind === "command" ? "commands" : "queries"}/${item.id}`, {}])) }),
    reportContext: async (_token, reportId) => ({ resource: { namespace: "certreporter", resourceType: "report", resourceId: reportId, revision: String(revision) } }),
    query: async () => ({}),
    submitCommand: async (_token, capabilityId, body) => {
      assert.equal(capabilityId, "report.update-master");
      assert.equal((body.input as Record<string, unknown>).expectedRevision, revision);
      submissions++;
      revision++;
      const receipt = { commandId: body.commandId, status: "committed", result: { revision } };
      receipts.set(String(body.commandId), receipt);
      return { status: "committed", receipt };
    },
    receipt: async (_token, commandId) => receipts.get(commandId),
  };
  const agents: AgentRunnerPort = { runWork: async ({ context, documents, tools, onText }) => {
    assert.equal((context.resource as Record<string, unknown>).revision, "3");
    assert.deepEqual(documents.map((item) => item.id), ["policy", "method", "recovery"]);
    assert.deepEqual(tools.map((item) => item.capability.id), ids);
    const output = await tools.find((item) => item.capability.id === "report.update-master")!.invoke({ reportId: "report-1", fields: { project_name: "Checked" }, expectedRevision: 3 });
    assert.equal(output.status, "committed");
    onText?.("Saved");
    return { text: "Saved" };
  } };
  const compose = (runtime: ForgeRuntime) => new ForgeUseCases({ accounts: runtime.db, works: runtime.db, om: runtime.om, certReporter: app, catalogs: runtime.db, agents, sessions: new InMemoryAppSessionStore(), passwordSetups: new InMemoryPasswordSetupStore(), passwordCodec: { hash: hashPassword, verify: verifyPassword }, trajectories: runtime.trajectories, system: systemPort, initialAdminEmails: config.initialAdminEmails });
  const runtime = new ForgeRuntime(config);
  try {
    const useCases = compose(runtime);
    const bootstrap = await useCases.bootstrap({ token: "app-token", reportId: "report-1" });
    await assert.rejects(() => useCases.startTurn(bootstrap.ticket, "before acceptance"), /CapabilityCatalogNotAccepted/);
    const candidate = await useCases.importCatalog(bootstrap.ticket);
    await useCases.acceptCatalog(bootstrap.ticket, candidate.digest);
    let streamed = "";
    const result = await useCases.startTurn(bootstrap.ticket, "Save the project name", (text) => { streamed += text; });
    assert.equal(result.reply, "Saved");
    assert.equal(streamed, "Saved");
    assert.equal(submissions, 1);
    catalog.digest = "changed-catalog";
    await assert.rejects(() => useCases.startTurn(bootstrap.ticket, "after catalog drift"), /CapabilityCatalogChanged/);
    assert.equal(submissions, 1);
    assert.equal((await runtime.db.turnsForWork(bootstrap.work.id)).length, 1);
    catalog.digest = candidate.digest;
    const originalHead = result.turn.omRevision;
    const workId = bootstrap.work.id;
    await useCases.disconnectAcp(bootstrap.ticket);
    runtime.db.close();
    const restarted = new ForgeRuntime(config);
    try {
      const resumed = compose(restarted);
      const again = await resumed.bootstrap({ token: "new-app-token", reportId: "report-1" });
      assert.equal(again.work.id, workId);
      const history = await resumed.workHistory(again.user.id, workId);
      assert.equal(history.turns[0].omRevision, originalHead);
      assert.equal(history.turns[0].catalogDigest, candidate.digest);
      const action = history.events.find((event) => event.type === "action" && event.payload.status === "committed");
      assert.equal((action?.payload.receipt as Record<string, unknown> | undefined)?.status, "committed");
      assert.equal(submissions, 1);
      await assert.rejects(() => useCases.startTurn(bootstrap.ticket, "again"), /AppSessionExpired/);
    } finally { restarted.db.close(); }
  } finally { rmSync(root, { recursive: true, force: true }); }
});
