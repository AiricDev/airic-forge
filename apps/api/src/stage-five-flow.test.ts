import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { ForgeUseCases, type AgentRunnerPort, type AppPort } from "@airic-forge/domain";
import { initialCapabilityIds as ids, testCatalog, acknowledgeCheckpoint } from "./certlab-test-catalog.js";
import { hashPassword, verifyPassword } from "./auth.js";
import { InMemoryAppSessionStore } from "./app-session-store.js";
import { InMemoryEvidenceSessionStore, LocalEvidenceExtractor } from "./evidence.js";
import { InMemoryPasswordSetupStore } from "./password-setup-store.js";
import { ForgeRuntime } from "./runtime.js";
import { systemPort } from "./system-port.js";
import type { ForgeConfig } from "./config.js";

test("single-report Work binds record number and current-Turn evidence through Git, SQLite and JSONL", async () => {
  const root = mkdtempSync(join(tmpdir(), "airic-forge-stage-five-"));
  const config: ForgeConfig = { port: 0, projectDir: join(root, "project"), dataDir: join(root, "data"), seedProjectDir: resolve(process.cwd(), "../../seed/certlab"), webDistDir: join(root, "web"), certLabUrl: "http://127.0.0.1:1", organizationId: "synthetic-org", allowedOrigin: "http://localhost:5173", initialAdminEmails: new Set(["admin@example.com"]) };
  const catalog = testCatalog();
  let recordNo = 1;
  let commands = 0;
  const app: AppPort = {
    identity: async () => ({ appId: "certlab", appUserId: "admin", email: "admin@example.com", displayName: "Admin" }),
    catalog: async () => catalog,
    openApi: async () => ({ paths: Object.fromEntries(catalog.capabilities.map((item) => [`/airic/v1/${item.kind === "command" ? "commands" : "queries"}/${item.id}`, {}])) }),
    reportContext: async () => ({ resource: { namespace: "certlab", resourceType: "report", resourceId: "report-1", projectId: "project-1" } }),
    query: async () => ({ assessment: { id: "assessment-1", report_id: "report-1", record_no: recordNo } }),
    submitCommand: async (_token, capabilityId, body) => { assert.equal(capabilityId, "assessment.save-draft"); assert.equal((body.input as Record<string, unknown>).expected_record_no, recordNo); commands++; recordNo++; return { status: "committed", receipt: { commandId: body.commandId, status: "committed", result: { record_no: recordNo } } }; },
    receipt: async () => undefined,
  };
  let seenEvidence = "";
  const agents: AgentRunnerPort = { runWork: async ({ evidence, tools, conversation, userMessage }) => {
    if (userMessage === "Follow up") {
      assert.deepEqual(evidence, []);
      assert.ok(conversation?.some((item) => item.role === "agent" && item.text === "Draft saved"));
      return { text: "Still available" };
    }
    seenEvidence = evidence?.[0]?.text ?? "";
    assert.equal(tools.length, ids.length);
    await assert.rejects(() => tools[0].invoke({ report_id: "other" }), /CommandTargetMismatch/);
    const save = tools.find((tool) => tool.capability.id === "assessment.save-draft")!;
    await assert.rejects(() => save.invoke({ assessment_id: "assessment-1", expected_record_no: 0 }), /ExpectedRecordNoMismatch/);
    const result = await save.invoke({ assessment_id: "assessment-1", expected_record_no: recordNo, data: {} });
    assert.equal(result.status, "committed");
    return { text: "Draft saved" };
  } };
  const runtime = new ForgeRuntime(config);
  try {
    const evidenceSessions = new InMemoryEvidenceSessionStore();
    const useCases = new ForgeUseCases({ accounts: runtime.db, works: runtime.db, om: runtime.om, app, catalogs: runtime.db, agents, sessions: new InMemoryAppSessionStore(), evidenceExtractor: new LocalEvidenceExtractor(), evidenceSessions, passwordSetups: new InMemoryPasswordSetupStore(), passwordCodec: { hash: hashPassword, verify: verifyPassword }, trajectories: runtime.trajectories, system: systemPort, initialAdminEmails: config.initialAdminEmails });
    await assert.rejects(() => useCases.bootstrap({ token: "app-token", workType: "report-type-definition", entityId: "type-1" }), /UnsupportedAppContext/);
    const session = await useCases.bootstrap({ token: "app-token", reportId: "report-1", goal: "Save draft" });
    assert.equal(session.work.workType, "report-authoring");
    const candidate = await useCases.importCatalog(session.ticket);
    await useCases.acceptCatalog(session.ticket, candidate.digest);
    const uploaded = await useCases.attachEvidence(session.ticket, "reference.txt", "text/plain", new TextEncoder().encode("Source fact for this turn"));
    const result = await useCases.startTurn(session.ticket, "Save draft", undefined, [uploaded.digest]);
    assert.equal(result.reply, "Draft saved");
    assert.equal(seenEvidence, "Source fact for this turn");
    assert.equal(commands, 1);
    const history = await useCases.workHistory(session.user.id, session.work.id);
    assert.equal(history.events.filter((event) => event.type === "action" && event.payload.status === "committed").length, 1);
    assert.equal(JSON.stringify(history).includes("Source fact for this turn"), false);
    assert.throws(() => evidenceSessions.take(session.ticket, [uploaded.digest]), /EvidenceNotAvailable/);
    await acknowledgeCheckpoint(useCases, session.ticket);
    const followUp = await useCases.startTurn(session.ticket, "Follow up");
    assert.equal(followUp.reply, "Still available");
  } finally { runtime.db.close(); rmSync(root, { recursive: true, force: true }); }
});

test("evidence extraction rejects unsupported and unreadable files", async () => {
  const extractor = new LocalEvidenceExtractor();
  await assert.rejects(() => extractor.extract("wrong.png", "application/octet-stream", new Uint8Array([1])), /UnsupportedEvidenceType/);
  await assert.rejects(() => extractor.extract("empty.txt", "text/plain", new TextEncoder().encode("  \n")), /EvidenceHasNoReadableText/);
});
