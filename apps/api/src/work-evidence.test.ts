import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { ForgeUseCases, type AgentRunnerPort, type AppPort } from "@airic-forge/domain";
import { initialCapabilityIds as ids, testCatalog, acknowledgeCheckpoint } from "./test-tool-catalog.js";
import { hashPassword, verifyPassword } from "./auth.js";
import { InMemoryAppSessionStore } from "./app-session-store.js";
import { InMemoryEvidenceSessionStore, LocalEvidenceExtractor } from "./evidence.js";
import { InMemoryPasswordSetupStore } from "./password-setup-store.js";
import { TestRuntime as ForgeRuntime } from "./test-runtime.js";
import { systemPort } from "./system-port.js";
import type { ForgeConfig } from "./config.js";

test("single-report Work binds record number and current-Turn evidence through Git, SQLite and JSONL", async () => {
  const root = mkdtempSync(join(tmpdir(), "airic-forge-stage-five-"));
  const config: ForgeConfig = { port: 0, projectDir: join(root, "project"), dataDir: join(root, "data"), seedProjectDir: resolve(process.cwd(), "../../tests/fixtures/operating-model"), webDistDir: join(root, "web"), appId:"sample-app", appUrl: "http://127.0.0.1:1", organizationId: "synthetic-org", allowedOrigin: "http://localhost:5173", };
  const catalog = testCatalog();
  let recordNo = 1;
  let commands = 0;
  const app: AppPort = {
    bindInput:(id,input)=>{if(input.workspace_id!==undefined&&input.workspace_id!==id)throw Error("CommandTargetMismatch");return {...input,workspace_id:id};},
    prepareCommand:async(_token,id,input)=>{if(input.expected_record_no!==recordNo)throw Error("ExpectedRecordNoMismatch");return {resourceKind:"workspace",resourceId:"fixture",scope:id,targetKind:"item",targetId:"item"};},
    identity: async () => ({ appId: "sample-app", appUserId: "admin", email: "admin@example.com", displayName: "Admin" }),
    discoverTools: async () => catalog,
    resourceContext: async () => ({ resource: { namespace: "sample-app", resourceType: "report", resourceId: "report-1", projectId: "project-1" } }),
    query: async () => ({ assessment: { id: "assessment-1", workspace_id: "report-1", record_no: recordNo } }),
    submitCommand: async (_token, capabilityId, body) => { assert.equal(capabilityId, "entry.update"); assert.equal((body.input as Record<string, unknown>).expected_record_no, recordNo); commands++; recordNo++; return { status: "committed", receipt: { commandId: body.commandId, status: "committed", result: { record_no: recordNo } } }; },
    receipt: async () => undefined,
  };
  let seenEvidence = "";
  const agents: AgentRunnerPort = { runWork: async ({ evidence, tools, scope, userMessage }) => {
    if (userMessage === "Follow up") {
      assert.deepEqual(evidence, []);
      assert.ok(scope.workId && scope.turnId);
      return { text: "Still available" };
    }
    seenEvidence = evidence?.[0]?.text ?? "";
    assert.deepEqual(tools.map((tool) => tool.capability.id), catalog.tools.filter(tool => !["command.context", "command.receipt"].includes(tool.id)).map(tool=>tool.id));
    assert(tools.every((tool) => ids.includes(tool.capability.id)));
    await assert.rejects(() => tools[0].invoke({ workspace_id: "other" }), /CommandTargetMismatch/);
    const save = tools.find((tool) => tool.capability.id === "entry.update")!;
    await assert.rejects(() => save.invoke({ entry_id: "assessment-1", expected_record_no: 0 }), /ExpectedRecordNoMismatch/);
    const result = await save.invoke({ entry_id: "assessment-1", expected_record_no: recordNo, data: {} });
    assert.equal(result.status, "committed");
    return { text: "Draft saved" };
  } };
  const runtime = new ForgeRuntime(config);
  try {
    const evidenceSessions = new InMemoryEvidenceSessionStore();
    const useCases = new ForgeUseCases({ accounts: runtime.db, works: runtime.db, om: runtime.om, app, toolSnapshots: runtime.db, agents, sessions: new InMemoryAppSessionStore(), evidenceExtractor: new LocalEvidenceExtractor(), evidenceSessions, passwordSetups: new InMemoryPasswordSetupStore(), passwordCodec: { hash: hashPassword, verify: verifyPassword }, trajectories: runtime.trajectories, system: systemPort,  });
    const session = await useCases.bootstrap({appId:"sample-app",workType:"document-task", token: "app-token", entityId: "report-1" });
    assert.equal(session.work.workType, "document-task");
    const candidate = catalog;
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
  await assert.rejects(() => extractor.extract("manual.docx", "application/octet-stream", new Uint8Array([1])), /UnsupportedEvidenceType/);
  await assert.rejects(() => extractor.extract("wrong.png", "application/octet-stream", new Uint8Array([1])), /UnsupportedEvidenceType/);
  await assert.rejects(() => extractor.extract("empty.txt", "text/plain", new TextEncoder().encode("  \n")), /EvidenceHasNoReadableText/);
});
