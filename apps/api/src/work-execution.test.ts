import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { ForgeUseCases, type AppPort, type AgentRunnerPort } from "@airic-forge/domain";
import { initialCapabilityIds as ids, testCatalog, acknowledgeCheckpoint } from "./certlab-test-catalog.js";
import { hashPassword, verifyPassword } from "./auth.js";
import { InMemoryAppSessionStore } from "./app-session-store.js";
import type { ForgeConfig } from "./config.js";
import { InMemoryPasswordSetupStore } from "./password-setup-store.js";
import { ForgeRuntime } from "./runtime.js";
import { systemPort } from "./system-port.js";

test("dynamic MCP tools and real Git/SQLite/JSONL keep a report command and its Turn across restart", async () => {
  const root = mkdtempSync(join(tmpdir(), "airic-forge-stage-two-"));
  const config: ForgeConfig = { port: 0, projectDir: join(root, "project"), dataDir: join(root, "data"), seedProjectDir: resolve(process.cwd(), "../../seed/certlab"), webDistDir: join(root, "web"), certLabUrl: "http://127.0.0.1:1", organizationId: "synthetic-org", allowedOrigin: "http://localhost:5173", };
  const catalog = testCatalog("accepted-catalog");
  let revision = 3;
  let submissions = 0;
  const receipts = new Map<string, Record<string, unknown>>();
  const app: AppPort = {
    identity: async () => ({ appId: "certlab", appUserId: "author", email: "AUTHOR@example.com", displayName: "Author" }),
    discoverTools: async () => structuredClone(catalog),
    reportContext: async (_token, reportId) => ({ resource: { namespace: "certlab", resourceType: "report", resourceId: reportId, projectId: "project-1" } }),
    query: async () => ({ assessment: { id: "assessment-1", report_id: "report-1", record_no: revision } }),
    submitCommand: async (_token, capabilityId, body) => {
      assert.equal(capabilityId, "assessment.save-draft");
      assert.equal((body.input as Record<string, unknown>).expected_record_no, revision);
      submissions++;
      revision++;
      const receipt = { commandId: body.commandId, status: "committed", result: { revision } };
      receipts.set(String(body.commandId), receipt);
      return { status: "committed", receipt };
    },
    receipt: async (_token, locator) => receipts.get(locator.commandId),
  };
  const agents: AgentRunnerPort = { runWork: async ({ context, documents, tools, onText }) => {
    assert.equal((context.resource as Record<string, unknown>).projectId, "project-1");
    assert.deepEqual(documents.map((item) => item.id), ["policy", "method", "recovery"]);
    assert.deepEqual(tools.map((item) => item.capability.id), catalog.tools.filter(tool => !["command.context", "command.receipt"].includes(tool.id)).map(tool=>tool.id));
    assert(tools.every((tool) => ids.includes(tool.capability.id)));
    const output = await tools.find((item) => item.capability.id === "assessment.save-draft")!.invoke({ assessment_id: "assessment-1", data: {}, expected_record_no: 3 });
    assert.equal(output.status, "committed");
    onText?.("Saved");
    return { text: "Saved" };
  } };
  const compose = (runtime: ForgeRuntime) => new ForgeUseCases({ accounts: runtime.db, works: runtime.db, om: runtime.om, app, toolSnapshots: runtime.db, agents, sessions: new InMemoryAppSessionStore(), passwordSetups: new InMemoryPasswordSetupStore(), passwordCodec: { hash: hashPassword, verify: verifyPassword }, trajectories: runtime.trajectories, system: systemPort,  });
  const runtime = new ForgeRuntime(config);
  try {
    const useCases = compose(runtime);
    const bootstrap = await useCases.bootstrap({ token: "app-token", reportId: "report-1" });
    const candidate = structuredClone(catalog);
    let streamed = "";
    const result = await useCases.startTurn(bootstrap.ticket, "Save the project name", (text) => { streamed += text; });
    assert.equal(result.reply, "Saved");
    assert.equal(streamed, "Saved");
    assert.equal(submissions, 1);
    await acknowledgeCheckpoint(useCases, bootstrap.ticket);
    assert.equal((await runtime.db.turnsForWork(bootstrap.work.id)).length, 1);
    assert.equal(runtime.db.toolSnapshot("certlab", candidate.digest)?.digest, candidate.digest);
    const originalHead = result.turn.omRevision;
    const workId = bootstrap.work.id;
    await useCases.disconnectAcp(bootstrap.ticket);
    runtime.db.close();
    const restarted = new ForgeRuntime(config);
    try {
      const resumed = compose(restarted);
      const again = await resumed.bootstrap({ token: "new-app-token", reportId: "report-1", workId });
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

for (const outcome of ["completed", "failed", "cancelled"] as const) test(`an accepted Copilot Turn can settle as ${outcome} while its owner drains`, async () => {
  const root = mkdtempSync(join(tmpdir(), "forge-turn-drain-"));
  const runtime = new ForgeRuntime({ port:0, projectDir:join(root,"project"),dataDir:join(root,"data"),seedProjectDir:resolve("../../seed/certlab"),webDistDir:join(root,"web"),certLabUrl:"http://127.0.0.1:1",organizationId:"synthetic-org",allowedOrigin:"http://localhost" });
  let entered!:()=>void, release!:()=>void;
  const ready = new Promise<void>(yes=>{entered=yes;}), gate = new Promise<void>(yes=>{release=yes;});
  const sessions = new InMemoryAppSessionStore();
  const app: AppPort = {
    identity:async()=>({appId:"certlab",organizationId:"synthetic-org",appUserId:"owner",email:"owner@example.invalid",displayName:"Owner"}),
    discoverTools:async()=>testCatalog("drain-catalog"),
    reportContext:async(_token,reportId)=>({resource:{namespace:"certlab",resourceType:"report",resourceId:reportId,projectId:"project"}}),
    query:async()=>({}),submitCommand:async()=>({status:"committed",receipt:{status:"committed"}}),receipt:async()=>undefined,
  };
  const agents: AgentRunnerPort = { runWork:async()=>{
    entered(); await gate;
    if(outcome === "failed") throw new Error("SyntheticAgentFailure");
    return {text:"Accepted result retained"};
  } };
  const useCases = new ForgeUseCases({accounts:runtime.db,works:runtime.db,om:runtime.om,app,toolSnapshots:runtime.db,agents,sessions,passwordSetups:runtime.passwordSetups,passwordCodec:{hash:hashPassword,verify:verifyPassword},trajectories:runtime.trajectories,system:systemPort});
  useCases.users.onDisabled(id=>sessions.revokeUser(id));
  try {
    const admin = runtime.db.ensureUser("admin@example.invalid");
    const owner = await useCases.bootstrap({token:"synthetic-token",reportId:"report"});
    runtime.db.recordToolSnapshot(testCatalog("drain-catalog"));
    const running = useCases.startTurn(owner.ticket,"Accepted request");
    const settled = running.then(value=>({value}),error=>({error})); await ready;
    assert.equal((await useCases.users.change(admin.id,owner.user.id,{expectedVersion:owner.user.version,requestId:`disable-${outcome}`,reason:"Offboarding",enabled:false})).status,"draining");
    await assert.rejects(useCases.bootstrap({token:"synthetic-token",reportId:"report"}),/UserUnavailable/);
    await assert.rejects(useCases.startTurn(owner.ticket,"New request"),/UserUnavailable/);
    await assert.rejects(useCases.checkpointFeedback(owner.ticket,{checkpointId:"checkpoint",kind:"resume",note:"Continue"},"new-request"),/UserUnavailable/);
    assert.equal((await useCases.sessionHistory(owner.ticket)).running,true);
    const cancelling = outcome === "cancelled" ? useCases.cancelTurn(owner.ticket) : undefined;
    if (cancelling) await new Promise<void>(resolve=>setImmediate(resolve));
    release();
    await settled;
    if(cancelling) assert.equal((await cancelling).running,false);
    assert.equal(runtime.db.userById(owner.user.id)!.status,"disabled");
    assert.equal(sessions.get(owner.ticket),undefined);
    const turns = runtime.db.turnsForWork(owner.work.id);
    assert.equal(turns.length,1);assert.equal(turns[0].status,outcome);
    assert(runtime.trajectories.read(owner.work.id).length>0);
  } finally {release();runtime.db.close();rmSync(root,{recursive:true,force:true});}
});
