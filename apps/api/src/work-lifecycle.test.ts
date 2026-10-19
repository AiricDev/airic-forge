import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { ForgeUseCases, type AgentRunnerPort, type WorkContextPorts } from "@airic-forge/domain";
import { ForgeDatabase } from "./database.js";
import { ForgeRuntime } from "./runtime.js";
import { testCatalog } from "./certlab-test-catalog.js";
import { hashPassword, verifyPassword } from "./auth.js";
import { systemPort } from "./system-port.js";
import { buildServer } from "./server.js";

function fixture(agents: AgentRunnerPort, workContext?: WorkContextPorts) {
  const root = mkdtempSync(join(tmpdir(), "forge-work-lifecycle-"));
  const runtime = new ForgeRuntime({ port: 0, projectDir: join(root, "project"), dataDir: join(root, "data"), seedProjectDir: resolve("../../seed/certlab"), webDistDir: join(root, "web"), certLabUrl: "http://127.0.0.1:1", organizationId: "synthetic-org", allowedOrigin: "http://localhost", initialAdminEmails: new Set() });
  let email = "author@example.invalid";
  let actorId = "author";
  let submissions = 0;
  runtime.app.identity = async () => ({ appId: "certlab", organizationId: "synthetic-org", appUserId: actorId, email, displayName: "Author" });
  runtime.app.reportContext = async (_token, id) => ({ resource: { namespace: "certlab", resourceType: "report", resourceId: id, projectId: "project" } });
  runtime.app.catalog = async () => testCatalog();
  runtime.app.query = async () => ({ assessment: { id: "assessment", report_id: "report", record_no: submissions } });
  const useCases = new ForgeUseCases({ accounts: runtime.db, works: runtime.db, om: runtime.om, app: runtime.app, organizationId: "synthetic-org", catalogs: runtime.db, agents, workContext, sessions: runtime.sessions, passwordSetups: runtime.passwordSetups, passwordCodec: { hash: hashPassword, verify: verifyPassword }, trajectories: runtime.trajectories, system: systemPort, initialAdminEmails: new Set() });
  const owner = runtime.db.ensureUser(email, false);
  const catalog = testCatalog(); runtime.db.saveCandidate(catalog, {}); runtime.db.accept("certlab", catalog.digest, owner.id);
  return { root, runtime, useCases, submitted: () => submissions, changeActor: (id: string) => { actorId = id; }, changeEmail: (value: string) => { email = value; }, commit: () => ++submissions, close: () => { runtime.db.close(); rmSync(root, { recursive: true, force: true }); } };
}

test("report bootstrap resume binds the original actor, report and owner", async () => {
  const f = fixture({ runWork: async () => ({ text: "Done" }) });
  try {
    const first = await f.useCases.bootstrap({ token: "synthetic", reportId: "report" });
    const resumed = await f.useCases.bootstrap({ token: "synthetic", reportId: "report", workId: first.work.id });
    assert.equal(resumed.work.id, first.work.id);
    assert.equal(resumed.work.goal, first.work.goal);
    assert.equal((await f.useCases.appWorks("synthetic", "report")).works.length, 1);
    await assert.rejects(() => f.useCases.bootstrap({ token: "synthetic", reportId: "other", workId: first.work.id }), /WorkBindingMismatch/);
    f.changeEmail("different@example.invalid");
    await assert.rejects(() => f.useCases.bootstrap({ token: "synthetic", reportId: "report", workId: first.work.id }), /AppIdentityEmailConflict/);
    assert.equal(f.runtime.db.work(first.work.id)?.ownerUserId, first.user.id);
  } finally { f.close(); }
});

test("report bootstrap restores one durable Work/session under concurrent opens and keeps reports and owners separate", async () => {
  let runs = 0;
  const f = fixture({ runWork: async () => { runs++; return { text: "Read only" }; } });
  try {
    const [first, again] = await Promise.all([f.useCases.bootstrap({ token: "synthetic", entityId: "report", workType: "report-authoring" }), f.useCases.bootstrap({ token: "synthetic", reportId: "report" })]);
    assert.equal(first.work.id, again.work.id);
    assert.equal(first.session.id, again.session.id);
    const wd = f.runtime.om.workDefinition(first.activeRevision, "report-authoring");
    assert.equal(first.work.goal, wd.description);
    assert.equal(runs, 0);
    assert.equal((await f.useCases.sessionHistory(again.ticket)).turns.length, 0);
    await f.useCases.startTurn(first.ticket, "Read only");
    const restored = await f.useCases.bootstrap({ token: "new-token", reportId: "report" });
    assert.equal(restored.work.id, first.work.id);
    assert.equal((await f.useCases.sessionHistory(restored.ticket)).turns.length, 1);
    assert.equal(runs, 1);
    const other = await f.useCases.bootstrap({ token: "synthetic", reportId: "another-report" });
    assert.notEqual(other.work.id, first.work.id);
    const reopened = new ForgeDatabase(join(f.root, "data"));
    try {
      assert.equal(reopened.ensureReportWork(first.user.id, "certlab", "report-authoring", "report", { goal: "must not replace", appUserId: "author" }).id, first.work.id);
      assert.equal(reopened.createOrTouchSession(first.work.id).id, first.session.id);
    } finally { reopened.close(); }
    f.changeActor("another-author"); f.changeEmail("another@example.invalid");
    const separateOwner = await f.useCases.bootstrap({ token: "other-token", reportId: "report" });
    assert.notEqual(separateOwner.work.id, first.work.id);
    await assert.rejects(() => f.useCases.bootstrap({ token: "other-token", reportId: "report", workId: first.work.id }), /WorkBindingMismatch/);
  } finally { f.close(); }
});

test("first report open pins an existing Work without merging or following later unrelated Works", async () => {
  const f = fixture({ runWork: async () => ({ text: "Done" }) });
  try {
    const owner = f.runtime.db.userByEmail("author@example.invalid")!;
    for (const goal of ["Grounding", "Labels"]) f.runtime.db.createWork(owner.id, "certlab", "report-authoring", "report", { goal, appUserId: "author" });
    const latest = f.runtime.db.activeWork(owner.id, "certlab", "report-authoring", "report")!;
    const selected = await f.useCases.bootstrap({ token: "synthetic", reportId: "report" });
    assert.equal(selected.work.id, latest.id);
    assert.equal(selected.work.goal, latest.goal);
    const unrelated = f.runtime.db.createWork(owner.id, "certlab", "report-authoring", "report", { goal: "Separate old work", appUserId: "author" });
    assert.equal((await f.useCases.bootstrap({ token: "synthetic", reportId: "report" })).work.id, selected.work.id);
    await assert.rejects(() => f.useCases.bootstrap({ token: "synthetic", reportId: "report", workId: unrelated.id }), /WorkBindingMismatch/);
    assert.equal((await f.useCases.appWorks("synthetic", "report")).works.length, 3);
  } finally { f.close(); }
});

test("material observations keep the original revision/page while bytes and full text stay transient", async () => {
  let current = "v1";
  const pixels = "transient-pixels";
  const fullText = "transient-secret-material-text";
  const f = fixture({ runWork: async ({ tools }) => {
    const result = await tools.find((tool) => tool.capability.id === "asset.read")!.invoke({ revision_id: "v1", page: 2 });
    assert.equal(result.text, fullText);
    assert.deepEqual(result.image, { mimeType: "image/png", data: pixels });
    return { text: "Read original page. Unverified; human review required." };
  } });
  f.runtime.app.query = async (_token, _id, input) => ({ status: "ready", source: {
    revision_id: input.revision_id, page: input.page, sha256: "original-digest",
    current_revision_id: current, is_current: current === input.revision_id },
    text: fullText, image: { mimeType: "image/png", data: pixels }, warnings: ["unverified"] });
  try {
    const session = await f.useCases.bootstrap({ token: "synthetic", reportId: "report" });
    await f.useCases.startTurn(session.ticket, "Read v1");
    current = "v2";
    const history = await f.useCases.sessionHistory(session.ticket);
    const observed = history.events.find((event) => event.type === "observation")!;
    assert.deepEqual((observed.payload.result as Record<string, unknown>).source, {
      revision_id: "v1", page: 2, sha256: "original-digest", current_revision_id: "v1", is_current: true });
    assert(!JSON.stringify(history).includes(pixels));
    assert(!JSON.stringify(history).includes(fullText));
    assert.equal(history.progress.waiting, true);
    assert.equal(f.submitted(), 0);
  } finally { f.close(); }
});

test("stop waits for an in-flight command, preserves its committed receipt and prevents later tools", async () => {
  let ready!: () => void; const started = new Promise<void>((resolve) => { ready = resolve; });
  let release!: () => void; const gate = new Promise<void>((resolve) => { release = resolve; });
  const f = fixture({ runWork: async ({ tools }) => {
    const tool = tools.find((item) => item.capability.id === "assessment.start")!;
    const committed = await tool.invoke({ assessment_id: "assessment", expected_record_no: 0 });
    assert.equal(committed.status, "committed");
    await assert.rejects(() => tool.invoke({ assessment_id: "assessment", expected_record_no: 1 }));
    return { text: "Must not become a completed reply" };
  } });
  f.runtime.app.submitCommand = async (_token, _id, body) => {
    ready(); await gate; f.commit();
    return { status: "committed", receipt: { commandId: body.commandId, status: "committed" } };
  };
  try {
    const session = await f.useCases.bootstrap({ token: "synthetic", reportId: "report" });
    const running = f.useCases.startTurn(session.ticket, "Start");
    const failed = assert.rejects(() => running);
    await started;
    const stopped = f.useCases.cancelTurn(session.ticket);
    assert.equal((await f.useCases.sessionHistory(session.ticket)).running, true);
    release();
    const history = await stopped; await failed;
    assert.equal(history.running, false);
    assert.equal(history.turns[0].status, "cancelled");
    assert.equal(f.submitted(), 1);
    assert.equal(history.events.filter((event) => event.type === "action" && event.payload.status === "committed").length, 1);
    assert.equal(history.events.some((event) => event.type === "turn.completed"), false);
    assert.equal(JSON.stringify(history).includes("synthetic"), false);
  } finally { f.close(); }
});

test("cancelled partial text remains durable and does not become a complete response", async () => {
  let ready!: () => void; const started = new Promise<void>((resolve) => { ready = resolve; });
  const f = fixture({ runWork: async ({ signal, onText }) => {
    onText?.("Partial reply"); ready();
    await new Promise<void>((_resolve, reject) => { signal!.addEventListener("abort", () => reject(new Error("Stopped")), { once: true }); });
    return { text: "unreachable" };
  } });
  try {
    const session = await f.useCases.bootstrap({ token: "synthetic", reportId: "report" });
    const running = f.useCases.startTurn(session.ticket, "Read"); const failed = assert.rejects(() => running);
    await started;
    const history = await f.useCases.cancelTurn(session.ticket); await failed;
    assert.equal(history.events.filter((event) => event.payload.agentTextDelta === "Partial reply").length, 1);
    assert.equal(history.events.some((event) => event.type === "turn.completed"), false);
    await f.useCases.disconnectAcp(session.ticket);
    const resumed = await f.useCases.bootstrap({ token: "synthetic", reportId: "report", workId: session.work.id });
    assert.equal((await f.useCases.sessionHistory(resumed.ticket)).turns.length, 1);
    assert.equal(f.submitted(), 0);
  } finally { f.close(); }
});

test("repeating the same accepted prompt ID returns the original Turn without a second execution", async () => {
  let calls = 0;
  const f = fixture({ runWork: async () => { calls++; return { text: "Original reply" }; } });
  try {
    const session = await f.useCases.bootstrap({ token: "synthetic", reportId: "report" });
    const first = await f.useCases.startTurn(session.ticket, "Read", undefined, [], "prompt-one");
    const replay = await f.useCases.startTurn(session.ticket, "Read", undefined, [], "prompt-one");
    assert.equal(first.turn.id, replay.turn.id);
    assert.equal(calls, 1);
    await assert.rejects(() => f.useCases.startTurn(session.ticket, "Changed input", undefined, [], "prompt-one"), /PromptRequestConflict/);
    assert.equal((await f.useCases.sessionHistory(session.ticket)).turns.length, 1);
  } finally { f.close(); }
});

test("restart marks an abandoned Turn interrupted and preserves original goal and pending command locator", async () => {
  const f = fixture({ runWork: async () => ({ text: "unused" }) });
  try {
    const session = await f.useCases.bootstrap({ token: "synthetic", reportId: "report" });
    const turn = f.runtime.db.nextTurn(session.work.id, f.runtime.om.head(`users/${session.user.id}`), "accepted", "context");
    f.runtime.trajectories.append({ id: "pending", workId: session.work.id, turnId: turn.id, type: "action", at: systemPort.now(), payload: { commandId: "original-key", status: "pending", capabilityId: "assessment.start", locator: { commandId: "original-key", reportId: "report", assessmentId: "assessment", capabilityId: "assessment.start", resourceKind: "project", resourceId: "project", scope: "assessment.start" } } });
    const restart = new ForgeRuntime(f.runtime.config);
    try {
      assert.equal(restart.db.turnsForWork(session.work.id)[0].status, "interrupted");
      assert.equal(restart.db.work(session.work.id)?.goal, session.work.goal);
      assert.equal(restart.trajectories.read(session.work.id)[0].payload.commandId, "original-key");
      assert.equal(f.submitted(), 0);
    } finally { restart.db.close(); }
  } finally { f.close(); }
});

test("real ACP snapshots and repeated RPC IDs preserve one Turn and the same server-owned messages", async () => {
  let calls = 0;
  const f = fixture({ runWork: async ({ onText, onModelStatus, tools }) => { calls++; onModelStatus?.(); await tools.find(tool => tool.capability.id === "assessment.context")!.invoke({ assessment_id: "assessment" }); onText?.("Partial"); return { text: "Saved server reply" }; } });
  const updates: Record<string, unknown>[] = [];
  Object.assign(f.runtime, { useCases: f.useCases });
  const server = buildServer(f.runtime);
  let socket: WebSocket | undefined;
  const rpc = (id: string, method: string, params: Record<string, unknown> = {}) => new Promise<Record<string, unknown>>((resolveRpc, reject) => {
    const timer = setTimeout(() => reject(new Error("RPC timeout")), 5000);
    socket!.onmessage = (event) => {
      const response = JSON.parse(String(event.data)) as Record<string, unknown>;
      if (response.method === "session/update") updates.push(response.params as Record<string, unknown>);
      if (response.id === id) { clearTimeout(timer); resolveRpc(response); }
    };
    socket!.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
  });
  try {
    const session = await f.useCases.bootstrap({ token: "synthetic", reportId: "report" });
    const address = await server.listen({ host: "127.0.0.1", port: 0 });
    socket = new WebSocket(address.replace(/^http/, "ws") + "/acp");
    await new Promise<void>((resolveOpen, reject) => { socket!.onopen = () => resolveOpen(); socket!.onerror = () => reject(new Error("Socket failed")); });
    assert.ok((await rpc("new", "session/new", { ticket: session.ticket })).result);
    const original = await rpc("same-prompt", "session/prompt", { message: "Read" });
    const replay = await rpc("same-prompt", "session/prompt", { message: "Read" });
    assert.deepEqual(original.result, replay.result);
    assert.equal(calls, 1);
    const progress = updates.filter(event => event.phase === "activity").map(event => event.activity as Record<string, unknown>);
    assert(progress.some(event => event.phase === "model" && event.status === "running"));
    assert(progress.some(event => event.capabilityId === "assessment.context" && event.status === "completed"));
    assert(!JSON.stringify(progress).includes("record_no"));
    const history = (await rpc("history", "session/history")).result as { turns: unknown[]; events: { type: string }[] };
    assert.equal(history.turns.length, 1);
    assert.equal(history.events.filter((event) => event.type === "turn.started").length, 1);
  } finally { socket?.close(); await server.close(); f.close(); }
});

test("checkpoints stop business calls; explicit scoped feedback resumes fresh facts without adopting OM", async () => {
  let turns = 0;
  const f = fixture({ runWork: async ({ tools, checkpoint, context }) => {
    turns++;
    const read = tools.find((item) => item.capability.id === "assessment.context")!;
    const observed = await read.invoke({ assessment_id: "assessment" });
    if (turns > 1) {
      assert.equal((context.workProgress as { feedback: unknown[] }).feedback.length, 1);
      assert.equal((observed.assessment as { record_no: number }).record_no, 1);
    }
    const input = { summary: "Actual current facts", eventIds: [String(observed.observationEventId)],
      selfCheck: "Read actual object and version, no professional confirmation",
      uncertainties: ["Physical measurements are still missing"], nextStep: "Request actual test",
      remainingWork: ["Measurement", "Human confirmation"], waitFor: "external" as const,
      resumeCondition: "Actual return arrives and engineer resumes this Work" };
    await assert.rejects(() => checkpoint!({ ...input, eventIds: ["invented"] }), /CheckpointEvidenceNotFound/);
    await checkpoint!(input);
    await assert.rejects(() => read.invoke({ assessment_id: "assessment" }), /WorkAwaitingFeedback/);
    return { text: "Step finished, goal is waiting" };
  } });
  try {
    const session = await f.useCases.bootstrap({ token: "synthetic", reportId: "report" });
    const head = f.runtime.om.head(`users/${session.user.id}`);
    await f.useCases.startTurn(session.ticket, "Read original", undefined, [], "first");
    const history = await f.useCases.sessionHistory(session.ticket);
    assert.equal(history.progress.waiting, true);
    assert.equal(history.work.status, "active");
    await assert.rejects(() => f.useCases.startTurn(session.ticket, "Continue without feedback"), /WorkAwaitingFeedback/);
    const feedback = { checkpointId: history.progress.checkpoint!.id, kind: "knowledge" as const,
      note: "Actual sample measurement arrived; verify the return, not this statement", checkAt: "phase" as const };
    const accepted = await f.useCases.checkpointFeedback(session.ticket, feedback, "feedback-one");
    assert.equal(accepted.progress.waiting, false);
    await f.useCases.checkpointFeedback(session.ticket, feedback, "feedback-one");
    await assert.rejects(() => f.useCases.checkpointFeedback(session.ticket, { ...feedback, note: "Changed" }, "feedback-one"), /FeedbackRequestConflict/);
    assert.equal((await f.useCases.sessionHistory(session.ticket)).events.filter((event) => event.type === "work.feedback").length, 1);
    f.commit();
    await f.useCases.startTurn(session.ticket, "Resume original goal");
    assert.equal(f.runtime.om.head(`users/${session.user.id}`), head);
    assert.equal((await f.useCases.sessionHistory(session.ticket)).work.goal, session.work.goal);
    assert.equal(turns, 2);
  } finally { f.close(); }
});

test("B3 command preparation persists the original scoped locator and never replays a lost creation", async () => {
  let submissions = 0;
  const f = fixture({ runWork: async ({ tools }) => {
    const create = tools.find((tool) => tool.capability.id === "test-task.create")!;
    const result = await create.invoke({ assessment_id: "assessment", expected_record_no: 0,
      requirements: "Actual PE-1 measurement required", asset_revision_ids: [], register_blocker: true });
    assert.equal(result.status, "unknown");
    await assert.rejects(() => create.invoke({ assessment_id: "assessment" }), /UnresolvedCommandBlocksFurtherWrites/);
    return { text: "Unknown original command, no repeated creation" };
  } });
  f.runtime.app.prepareCommand = async () => ({ resourceKind: "project", resourceId: "project",
    scope: "test_task.create:assessment", targetKind: "assessment", targetId: "assessment" });
  f.runtime.app.submitCommand = async () => { submissions++; throw new Error("Lost response"); };
  f.runtime.app.receipt = async (_token, locator) => {
    assert.equal(locator.targetId, "assessment"); assert.equal(locator.scope, "test_task.create:assessment");
    return undefined;
  };
  try {
    const session = await f.useCases.bootstrap({ token: "synthetic", reportId: "report" });
    await f.useCases.startTurn(session.ticket, "Register test");
    const history = await f.useCases.sessionHistory(session.ticket);
    assert.equal(history.unresolvedCommands.length, 1);
    const original = history.unresolvedCommands[0].commandId;
    await f.useCases.recoverCommand(session.ticket, original);
    assert.equal(submissions, 1);
    assert.equal((await f.useCases.sessionHistory(session.ticket)).progress.waiting, true);
  } finally { f.close(); }
});

test("100-Turn Work retains corrections/current facts and pauses without replay when summary fails", async () => {
  const cache = new Map<string, import("@airic-forge/domain").ContextSummary>();
  let calls = 0, runs = 0, fail = false, writes = 0, expectedGoal = "";
  const context: WorkContextPorts = {
    // This fixture intentionally exercises compaction independently of the 256k production default.
    inputTokens: 32000,
    summaries: {read: async key => cache.get(key), write: async (key, summary) => {cache.set(key, summary);}},
    summarizer: {modelFingerprint: "synthetic-model", summarize: async ({messages}) => {
      calls++; if (fail) throw new Error("ContextSummaryFailed");
      return `讨论来源 ${messages[0].eventId} 至 ${messages.at(-1)!.eventId}，尚未专业确认。`;
    }},
  };
  const f = fixture({runWork: async input => {
    runs++;
    assert.equal(input.context.workGoal, expectedGoal);
    assert.equal(input.context.currentMarker, runs);
    if (runs > 1) assert.ok(JSON.stringify(input.context.workFacts).includes("exact human correction"));
    assert.ok(input.readHistory && (await input.readHistory(0, 1)).length === (runs > 1 ? 1 : 0));
    if (runs === 1) {
      const result = await input.tools.find(t => t.capability.id === "assessment.start")!.invoke({assessment_id:"assessment",expected_record_no:0});
      assert.equal(result.status,"committed");
    }
    return {text:`Round ${runs}: ` + "讨论实际限制并保持待核对。".repeat(60)};
  }}, context);
  f.runtime.app.reportContext = async (_token, id) => ({resource:{namespace:"certlab",resourceType:"report",resourceId:id,projectId:"project"},currentMarker:runs+1});
  f.runtime.app.submitCommand = async (_token, _id, body) => {writes++;return {status:"committed",receipt:{commandId:body.commandId,status:"committed"}};};
  try {
    const session = await f.useCases.bootstrap({token:"synthetic",reportId:"report"});
    expectedGoal = session.work.goal!;
    for(let index=0; index<100; index++) {
      await f.useCases.startTurn(session.ticket, `继续核对 ${index}`);
      const snapshot=await f.useCases.sessionHistory(session.ticket);
      await f.useCases.checkpointFeedback(session.ticket,{checkpointId:snapshot.progress.checkpoint!.id,kind:index===0?"correct":"approve",note:index===0?"exact human correction":"checked"},`ack-${index}`);
    }
    const before=await f.useCases.sessionHistory(session.ticket);
    assert.ok(calls>0 && cache.size>0); assert.equal(writes,1);
    fail=true;cache.clear();
    await assert.rejects(()=>f.useCases.startTurn(session.ticket,"继续原目标"),/ContextSummaryFailed/);
    const after=await f.useCases.sessionHistory(session.ticket);
    const activity = after.events.filter(event => event.turnId === after.turns.at(-1)?.id).map(event => event.payload.activity).filter(Boolean).at(-1) as {phase: string; status: string; code: string};
    assert.equal(activity.phase, "context"); assert.equal(activity.status, "failed"); assert.equal(activity.code, "ContextSummaryFailed");

    assert.equal(runs,100);assert.equal(writes,1);
    assert.deepEqual(after.events.filter(e=>before.events.some(old=>old.id===e.id)),before.events);
    assert.equal(after.turns.at(-1)!.status,"failed");
    assert.ok(after.events.some(e=>e.payload.contextStatus==="failed"));assert.equal(cache.size,0);
  } finally {f.close();}
});

test("missing independent workspace is explicit JSON 404 while App bootstrap remains usable",async()=>{
  const f=fixture({runWork:async()=>({text:"ready"})}),server=buildServer(f.runtime);
  server.log.level="silent";
  try {
    const missing=await server.inject({method:"GET",url:"/works/anything"});
    assert.equal(missing.statusCode,404);assert.equal(missing.json().error,"WebWorkspaceNotBuilt");
    const bootstrap=await server.inject({method:"POST",url:"/api/v1/app-sessions/bootstrap",headers:{authorization:"Bearer synthetic"},payload:{appId:"certlab",workType:"report-authoring",entityId:"report"}});
    assert.equal(bootstrap.statusCode,201);assert.equal(bootstrap.json().workspaceAvailable,false);assert.ok(bootstrap.json().ticket);
    const obsoleteGoal = await server.inject({method:"POST",url:"/api/v1/app-sessions/bootstrap",headers:{authorization:"Bearer synthetic"},payload:{appId:"certlab",workType:"report-authoring",entityId:"report",goal:"Split this report"}});
    assert.equal(obsoleteGoal.statusCode, 400);
  } finally {await server.close();f.close();}
});

test("failed model initialization is reported at its exact stage and restored from Work history", async () => {
  const f = fixture({ runWork: async () => { throw new Error("ForgeModelNotConfigured"); } });
  try {
    const session = await f.useCases.bootstrap({ token: "synthetic", reportId: "report" });
    const activities: Array<{ phase: string; status: string; code?: string }> = [];
    await assert.rejects(f.useCases.startTurn(session.ticket, "Read", undefined, [], undefined, undefined, undefined, activity => activities.push(activity)), /ForgeModelNotConfigured/);
    assert.equal(activities.at(-1)?.phase, "model");
    assert.equal(activities.at(-1)?.status, "failed");
    assert.equal(activities.at(-1)?.code, "ForgeModelNotConfigured");
    const history = await f.useCases.sessionHistory(session.ticket);
    assert(history.events.some(event => (event.payload.activity as { code?: string } | undefined)?.code === "ForgeModelNotConfigured"));
  } finally { f.close(); }
});

test("an agent failure after a successful tool remains a distinct failed step", async () => {
  const f = fixture({ runWork: async ({tools}) => {
    await tools.find(tool => tool.capability.id === "assessment.context")!.invoke({assessment_id:"assessment"});
    throw new Error("SyntheticResultInvalid");
  } });
  try {
    const session = await f.useCases.bootstrap({ token: "synthetic", reportId: "report" });
    await assert.rejects(f.useCases.startTurn(session.ticket,"Read"),/SyntheticResultInvalid/);
    const history = await f.useCases.sessionHistory(session.ticket);
    const steps = history.events.map(event => event.payload.activity as {phase:string; status:string; code?:string} | undefined).filter(Boolean);
    assert(steps.some(step => step?.phase === "tool" && step.status === "completed"));
    assert.equal(steps.at(-1)?.status,"failed");
    assert.equal(steps.at(-1)?.code,"SyntheticResultInvalid");
  } finally { f.close(); }
});
