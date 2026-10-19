/** Synthetic integration probe. Input credentials stay in process memory. */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { ForgeUseCases, type AgentRunnerPort, type AppPort } from "@airic-forge/domain";
import { ForgeRuntime } from "./runtime.js";
import { CertLabClient } from "./certlab-client.js";
import { hashPassword, verifyPassword } from "./auth.js";
import { systemPort } from "./system-port.js";

let input = "";
for await (const chunk of process.stdin) input += chunk;
const scene = JSON.parse(input) as { origin: string; token: string; organizationId: string; reportId: string; assessmentId: string; forgeRoot: string };
const root = mkdtempSync(join(tmpdir(), "forge-certlab-live-"));
const client = new CertLabClient(scene.origin, scene.organizationId);
let submissions = 0;
let receiptLookups = 0;
const app: AppPort = {
  identity: (token) => client.identity(token), catalog: (token) => client.catalog(token),
  openApi: (token) => client.openApi(token), reportContext: (token, id, selection) => client.reportContext(token, id, selection),
  query: (token, id, value) => client.query(token, id, value),
  receipt: async (token, locator) => ++receiptLookups === 1 ? undefined : client.receipt(token, locator),
  submitCommand: async (token, id, value) => {
    submissions++;
    const result = await client.submitCommand(token, id, value);
    assert.equal(result.status, "committed");
    return submissions === 1 ? { status: "unknown" } : result;
  },
};
const runtime = new ForgeRuntime({ port: 0, projectDir: join(root, "project"), dataDir: join(root, "data"), seedProjectDir: resolve(scene.forgeRoot, "seed/certlab"), webDistDir: join(root, "web"), certLabUrl: scene.origin, organizationId: scene.organizationId, allowedOrigin: "http://localhost", initialAdminEmails: new Set(["synthetic-engineer@example.invalid"]) });
try {
  const agents: AgentRunnerPort = { runWork: async ({ tools }) => {
    assert.deepEqual(tools.map(tool => tool.capability.id).sort(), catalog.capabilities.map(capability => capability.id).sort());
    assert.ok(!tools.some((tool) => /submit|confirm|issue|send/.test(tool.capability.id)));
    const start = tools.find((tool) => tool.capability.id === "assessment.start")!;
    const save = tools.find((tool) => tool.capability.id === "assessment.save-draft")!;
    if (submissions === 0) {
      assert.equal((await start.invoke({ assessment_id: scene.assessmentId, expected_record_no: 0 })).status, "unknown");
      await assert.rejects(() => save.invoke({ assessment_id: scene.assessmentId, expected_record_no: 1 }), /UnresolvedCommandBlocksFurtherWrites/);
      return { text: "Receipt recovery required" };
    }
    await assert.rejects(() => save.invoke({ assessment_id: scene.assessmentId, expected_record_no: 0, result_fields: {}, rationale: "Synthetic" }), /ExpectedRecordNoMismatch/);
    assert.equal((await save.invoke({ assessment_id: scene.assessmentId, expected_record_no: 1, result_fields: { conformity: "conform", note: "Synthetic fixture" }, rationale: "Synthetic fixture only" })).status, "committed");
    return { text: "Synthetic assessment draft saved" };
  } };
  const useCases = new ForgeUseCases({ accounts: runtime.db, works: runtime.db, om: runtime.om, app, organizationId: scene.organizationId, catalogs: runtime.db, agents, sessions: runtime.sessions, passwordSetups: runtime.passwordSetups, passwordCodec: { hash: hashPassword, verify: verifyPassword }, trajectories: runtime.trajectories, system: systemPort, initialAdminEmails: runtime.config.initialAdminEmails });
  const session = await useCases.bootstrap({ token: scene.token, reportId: scene.reportId });
  const catalog = await useCases.importCatalog(session.ticket);
  await useCases.acceptCatalog(session.ticket, catalog.digest);
  await useCases.startTurn(session.ticket, "Synthetic draft");
  const uncertain = (await useCases.workHistory(session.user.id, session.work.id)).events.find((event) => event.type === "action" && event.payload.status === "unknown")!;
  assert.equal((await useCases.recoverCommand(session.ticket, String(uncertain.payload.commandId))).status, "committed");
  assert.equal(submissions, 1);
  const progress = (await useCases.sessionHistory(session.ticket)).progress;
  await useCases.checkpointFeedback(session.ticket, {
    checkpointId: progress.checkpoint!.id, kind: "approve", note: "Synthetic original receipt verified",
  }, "synthetic-ack");
  await useCases.startTurn(session.ticket, "Continue after receipt recovery");
  const history = await useCases.workHistory(session.user.id, session.work.id);
  const actions = history.events.filter((event) => event.type === "action" && event.payload.status === "committed");
  assert.equal(actions.length, 2);
  assert.equal(submissions, 2);
  assert.equal(JSON.stringify(history).includes(scene.token), false);
  process.stdout.write(JSON.stringify({ status: "passed", submissions, commands: actions.map((event) => event.payload.commandId), capabilities: catalog.capabilities.map((capability) => capability.id), receiptRecoveryWithoutReplay: true, staleVersionRejected: true, tokenAbsentFromHistory: true }));
} finally { runtime.db.close(); rmSync(root, { recursive: true, force: true }); }
