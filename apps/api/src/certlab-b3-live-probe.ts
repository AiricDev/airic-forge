/** Synthetic B3 probe, credentials remain in process memory and loopback HTTP. */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { ForgeUseCases, type AgentRunnerPort, type AppPort } from "@airic-forge/domain";
import { ForgeRuntime } from "./runtime.js";
import { CertLabClient } from "./certlab-client.js";
import { hashPassword, verifyPassword } from "./auth.js";
import { systemPort } from "./system-port.js";

let text = "";
for await (const chunk of process.stdin) text += chunk;
const scene = JSON.parse(text) as { origin: string; token: string; organizationId: string; reportId: string; assessmentId: string; forgeRoot: string };
const root = mkdtempSync(join(tmpdir(), "forge-certlab-b3-live-"));
const client = new CertLabClient(scene.origin, scene.organizationId);
let submissions = 0;
let lostCreation = false;
let suppressRecovery = true;
let taskId = "";
const app: AppPort = {
  identity: (token) => client.identity(token), catalog: (token) => client.catalog(token),
  openApi: (token) => client.openApi(token), reportContext: (token, id) => client.reportContext(token, id),
  query: (token, id, input) => client.query(token, id, input),
  prepareCommand: (token, id, input) => client.prepareCommand(token, id, input),
  receipt: (token, locator) => suppressRecovery ? Promise.resolve(undefined) : client.receipt(token, locator),
  submitCommand: async (token, id, input, locator) => {
    submissions++;
    const result = await client.submitCommand(token, id, input, locator);
    assert.equal(result.status, "committed", JSON.stringify(result));
    if (id === "test-task.create" && !lostCreation) {
      lostCreation = true;
      return { status: "unknown" };
    }
    return result;
  },
};
const runtime = new ForgeRuntime({ port: 0, projectDir: join(root, "project"), dataDir: join(root, "data"),
  seedProjectDir: resolve(scene.forgeRoot, "seed/certlab"), webDistDir: join(root, "web"),
  certLabUrl: scene.origin, organizationId: scene.organizationId, allowedOrigin: "http://localhost",
  initialAdminEmails: new Set(["synthetic-engineer@example.invalid"]) });
try {
  let turns = 0;
  const agents: AgentRunnerPort = { runWork: async ({ tools, checkpoint, context }) => {
    turns++;
    const invoke = (id: string, input: Record<string, unknown>) => tools.find((tool) => tool.capability.id === id)!.invoke(input);
    if (turns === 1) {
      assert.equal((await invoke("assessment.start", { assessment_id: scene.assessmentId, expected_record_no: 0 })).status, "committed");
      const created = await invoke("test-task.create", { assessment_id: scene.assessmentId,
        expected_record_no: 1, requirements: "Actual physical PE-1 test required",
        asset_revision_ids: [], register_blocker: true });
      assert.equal(created.status, "unknown");
      await assert.rejects(() => invoke("finding.create", {}), /UnresolvedCommandBlocksFurtherWrites/);
      await checkpoint!({ summary: "Original test creation result unknown", eventIds: [String(created.actionEventId)],
        selfCheck: "No physical measurement fabricated", uncertainties: ["Original command must be reconciled"],
        nextStep: "Read original receipt, do not repeat creation", remainingWork: ["Test, assessment and human confirmation"],
        waitFor: "external", resumeCondition: "Engineer verifies original command and actual test requirements" });
      return { text: "Waiting, goal not completed" };
    }
    assert.equal((context.workProgress as { feedback: unknown[] }).feedback.length, 1);
    const item = (await invoke("work-item.context", { item_kind: "test-task", item_id: taskId })).item as Record<string, unknown>;
    const report = await invoke("report.context", {});
    const generated = await invoke("test-plan.generate", { expected_version: (report.project as { version: number }).version });
    assert.equal(generated.status, "committed");
    const plan = ((generated.receipt as { receipt: { response: Record<string, unknown> } }).receipt.response);
    assert.equal(plan.status, "queued");
    assert.equal((plan.snapshot as { tasks: unknown[] }).tasks.length, 2);
    const output = await invoke("output.context", { job_kind: "test-plan", object_id: plan.id });
    assert.equal(output.status, "queued");
    const completed = await invoke("work-item.complete", { item_kind: "test-task", item_id: taskId,
      expected_version: item.version, mode: "no_longer_needed", source: "Synthetic engineer explicit instruction",
      note: "Alternate actual verification is required, not a passed measurement",
      expected_assessments: (item.waiting_assessments as Record<string, unknown>[]).map((row) => ({
        assessment_id: row.assessment_id, expected_record_no: row.expected_record_no, blocker_keys: row.blocker_keys,
      })) });
    assert.equal(completed.status, "committed");
    const current = (await invoke("assessment.context", { assessment_id: scene.assessmentId })).assessment as Record<string, unknown>;
    assert.equal(current.record_no, 3);
    assert.equal(current.status, "assessing");
    const finding = await invoke("finding.create", { assessment_id: scene.assessmentId,
      expected_record_no: current.record_no, kind: "clarification", description: "Sample identity needs a real return",
      requirements: "Provide actual sample information", asset_revision_ids: [], register_blocker: false });
    assert.equal(finding.status, "committed");
    await checkpoint!({ summary: "Original effects verified; document job remains queued",
      eventIds: [String(output.observationEventId), String(completed.actionEventId), String(finding.actionEventId)],
      selfCheck: "Item completion is not professional confirmation; job acceptance is not output success",
      uncertainties: ["Actual test and sample evidence remain unverified"], nextStep: "Human checks actual return and output",
      remainingWork: ["Actual test", "Professional confirmation", "Delivery"], waitFor: "human",
      resumeCondition: "Actual evidence and fixed output are checked; human performs exclusive actions" });
    return { text: "Goal remains incomplete" };
  } };
  const useCases = new ForgeUseCases({ accounts: runtime.db, works: runtime.db, om: runtime.om, app,
    organizationId: scene.organizationId, catalogs: runtime.db, agents, sessions: runtime.sessions,
    passwordSetups: runtime.passwordSetups, passwordCodec: { hash: hashPassword, verify: verifyPassword },
    trajectories: runtime.trajectories, system: systemPort, initialAdminEmails: runtime.config.initialAdminEmails });
  const session = await useCases.bootstrap({ token: scene.token, reportId: scene.reportId });
  const head = runtime.om.head(`users/${session.user.id}`);
  const catalog = await useCases.importCatalog(session.ticket);
  await useCases.acceptCatalog(session.ticket, catalog.digest);
  await useCases.startTurn(session.ticket, "Register required actual test");
  let history = await useCases.sessionHistory(session.ticket);
  assert.equal(history.progress.waiting, true);
  await assert.rejects(() => useCases.startTurn(session.ticket, "Blind continue"), /WorkAwaitingFeedback/);
  suppressRecovery = false;
  const recovered = await useCases.recoverCommand(session.ticket, history.unresolvedCommands[0].commandId);
  assert.equal(recovered.status, "committed");
  taskId = ((recovered.receipt as { receipt: { response: { test_task: { id: string } } } }).receipt.response.test_task.id);
  assert.equal(submissions, 2);
  await useCases.checkpointFeedback(session.ticket, { checkpointId: history.progress.checkpoint!.id,
    kind: "resume", note: "Original receipt verified; alternate verification still required" }, "synthetic-resume");
  await useCases.startTurn(session.ticket, "Continue original goal, never fabricate a measurement");
  history = await useCases.sessionHistory(session.ticket);
  assert.equal(history.progress.waiting, true);
  assert.equal(history.work.status, "active");
  assert.equal(history.work.goal, "Original physical PE-1 goal");
  assert.equal(runtime.om.head(`users/${session.user.id}`), head);
  assert.equal(submissions, 5);
  assert.equal(JSON.stringify(history).includes(scene.token), false);
  process.stdout.write(JSON.stringify({ status: "passed", submissions, taskId,
    commands: history.events.filter((event) => event.type === "action" && event.payload.status === "committed")
      .map((event) => event.payload.commandId), originalCreationRecoveredWithoutReplay: true,
    checkpointFeedbackResumedSameGoal: true, jobQueuedNotSuccess: true, allProjectTasksFrozen: true,
    manualConfirmationPreserved: true, activeOmUnchanged: true, tokenAbsentFromHistory: true }));
} finally { runtime.db.close(); rmSync(root, { recursive: true, force: true }); }
