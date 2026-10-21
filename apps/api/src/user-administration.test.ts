import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Worker } from "node:worker_threads";
import { ForgeDatabase } from "./database.js";
import { ForgeRuntime } from "./runtime.js";
import { buildServer } from "./server.js";
import { hashPassword } from "./auth.js";

function fixture() {
  const root = mkdtempSync(join(tmpdir(),"forge-users-"));
  const runtime = new ForgeRuntime({ port:0, projectDir:join(root,"project"),dataDir:join(root,"data"),webDistDir:join(root,"web"),certLabUrl:"http://127.0.0.1:1",organizationId:"synthetic",allowedOrigin:"http://localhost" });
  const admin = runtime.db.ensureUser("admin@example.invalid"), user = runtime.db.ensureUser("user@example.invalid");
  runtime.db.setInitialPassword(user.id,hashPassword("Synthetic user password"));
  const app = buildServer(runtime);
  const cookie = (id: string) => ({cookie:`forge_session=${runtime.webSessions.issue(id)}`});
  const change = (actor: string, target: string, body: Record<string, unknown>) => app.inject({method:"PATCH",url:`/api/v1/users/${target}`,headers:cookie(actor),payload:body});
  return {root,runtime,admin,user,app,cookie,change,close:async()=>{await app.close();runtime.db.close();rmSync(root,{recursive:true,force:true});}};
}
const change = (expectedVersion: number, patch = {}) => ({expectedVersion,requestId:"request-change-1",reason:"Organization account administration",...patch});

test("first account is administrator exactly once, concurrent creations serialize", async () => {
  const root=mkdtempSync(join(tmpdir(),"forge-user-race-"));
  const db=new ForgeDatabase(root); db.close();
  try {
    const module=new URL("./database.js",import.meta.url).href;
    const create=(email:string)=>new Promise<void>((resolve,reject)=>{
      const worker=new Worker(`const {parentPort,workerData}=require('node:worker_threads'); import(workerData.module).then(({ForgeDatabase})=>{const db=new ForgeDatabase(workerData.root);db.ensureUser(workerData.email);db.close();parentPort.postMessage('ok');}).catch(error=>{throw error});`,{eval:true,workerData:{root,module,email}});
      worker.on("error",reject);worker.on("exit",code=>code===0?resolve():reject(Error(String(code))));
    });
    await Promise.all([create("one@example.invalid"),create("two@example.invalid")]);
    const check=new ForgeDatabase(root);
    assert.equal(check.listUsers().filter(user=>user.role==="admin").length,1);
    assert.equal(check.listUsers().length,2);
    check.close();
  } finally {rmSync(root,{recursive:true,force:true});}
});

test("existing users initialize earliest once, preserve branches/passwords, keep existing administrators",()=>{
  for (const existingAdmin of [false,true]) {
    const root=mkdtempSync(join(tmpdir(),"forge-user-upgrade-"));
    const old=new DatabaseSync(join(root,"forge.sqlite"));
    old.exec("CREATE TABLE users(id TEXT PRIMARY KEY,email TEXT UNIQUE NOT NULL,role TEXT NOT NULL,password_hash TEXT,active_branch TEXT NOT NULL,created_at TEXT NOT NULL) STRICT");
    old.prepare("INSERT INTO users VALUES (?,?,?,?,?,?)").run("first","first@example.invalid","user","synthetic-hash","users/first","2026-01-01");
    old.prepare("INSERT INTO users VALUES (?,?,?,?,?,?)").run("second","second@example.invalid",existingAdmin?"admin":"user",null,"users/second","2026-01-02");old.close();
    try {
      const db=new ForgeDatabase(root);
      assert.equal(db.userById("first")!.role,existingAdmin?"user":"admin");
      assert.equal(db.userById("first")!.activeBranch,"users/first");
      assert.equal(db.passwordHash("first@example.invalid"),"synthetic-hash");
      assert.equal(db.userDetail("first",1).total,existingAdmin?0:1);db.close();
      const raw=new DatabaseSync(join(root,"forge.sqlite"));raw.exec("UPDATE users SET role='user'");raw.close();
      const restarted=new ForgeDatabase(root);
      assert(restarted.listUsers().every(user=>user.role==="user")); restarted.close();
    } finally {rmSync(root,{recursive:true,force:true});}
  }
});

test("account writes authorize, protect last admin, compare version, replay, and audit atomically",async()=>{
  const f=fixture();
  try {
    assert.equal((await f.change(f.user.id,f.user.id,change(0,{role:"admin"}))).statusCode,403);
    assert.equal((await f.change(f.admin.id,f.admin.id,change(0,{enabled:false}))).json().error,"LastActiveAdministrator");
    assert.equal((await f.change(f.admin.id,f.user.id,change(99,{role:"admin"}))).json().error,"UserVersionConflict");
    assert.equal((await f.change(f.admin.id,f.user.id,change(0,{role:"root"}))).statusCode,400);
    const result=await f.change(f.admin.id,f.user.id,change(0,{role:"admin"}));assert.equal(result.statusCode,200);
    assert.deepEqual((await f.change(f.admin.id,f.user.id,change(0,{role:"admin"}))).json(),result.json());
    assert.equal((await f.change(f.admin.id,f.user.id,change(0,{enabled:false}))).json().error,"UserRequestConflict");
    assert.equal(f.runtime.db.userDetail(f.user.id,1).total,1);
    const raw=new DatabaseSync(join(f.root,"data/forge.sqlite"));
    raw.exec("CREATE TRIGGER reject_test_audit BEFORE INSERT ON user_admin_events WHEN NEW.reason='reject-audit' BEGIN SELECT RAISE(ABORT,'injected'); END");
    assert.throws(()=>f.runtime.db.changeUser(f.admin.id,f.user.id,change(1,{requestId:"rollback-1",reason:"reject-audit",enabled:false}),false),/injected/);
    assert.equal(f.runtime.db.userById(f.user.id)!.version,1);
    assert.throws(()=>raw.exec("DELETE FROM user_admin_events"),/Immutable/);raw.close();
    const self=await f.change(f.admin.id,f.admin.id,change(0,{requestId:"self-demote",role:"user"}));assert.equal(self.statusCode,200);
    assert.equal((await f.app.inject({url:"/api/v1/users",headers:f.cookie(f.admin.id)})).statusCode,403);
    const detail=await f.app.inject({url:`/api/v1/users/${f.user.id}?page=1`,headers:f.cookie(f.user.id)});
    assert.equal(detail.statusCode,200);assert(!JSON.stringify(detail.json()).includes("password_hash"));
  } finally {await f.close();}
});

test("disable without runs revokes web/app/setup credentials; restore never revives them",async()=>{
  const f=fixture();
  try {
    const cookie=f.cookie(f.user.id),ticket=f.runtime.passwordSetups.issue(f.user.id,"2099-01-01T00:00:00Z");
    f.runtime.sessions.put({ticket:"app-ticket",expiresAt:"2099-01-01T00:00:00Z",forgeUserId:f.user.id,workId:"work",sessionId:"session",appToken:"synthetic-token",reportId:"report"});
    const git = await f.runtime.gitAccess.issue(f.user.id,"Synthetic access");
    const result=await f.change(f.admin.id,f.user.id,change(0,{enabled:false}));assert.equal(result.json().user.status,"disabled");
    assert.equal((await f.app.inject({url:"/api/v1/auth/me",headers:cookie})).statusCode,401);
    assert.equal(f.runtime.sessions.get("app-ticket"),undefined);assert.equal(f.runtime.passwordSetups.consume(ticket,new Date().toISOString()),undefined);
    assert.equal(await f.runtime.useCases.login(f.user.email,"Synthetic user password"),undefined);
    const restored=await f.change(f.admin.id,f.user.id,change(1,{requestId:"restore-1",enabled:true}));assert.equal(restored.statusCode,200);
    assert.equal((await f.app.inject({url:"/api/v1/auth/me",headers:cookie})).statusCode,401);
    assert((await f.runtime.useCases.login(f.user.email,"Synthetic user password")));
    await assert.rejects(f.runtime.gitAccess.authenticate(git.secret,f.user.id),/Unauthorized/);
    // Replaying an old disable must not revoke sessions issued after restoration.
    const fresh=f.cookie(f.user.id);
    await f.change(f.admin.id,f.user.id,change(0,{enabled:false}));
    assert.equal((await f.app.inject({url:"/api/v1/auth/me",headers:fresh})).statusCode,200);
  } finally {await f.close();}
});

test("draining permits only accepted run observation/cancellation, blocks admission and finishes on settle",async()=>{
  const f=fixture();let release!:()=>void;const barrier=new Promise<void>(yes=>{release=yes;});
  let entered!:()=>void;const ready=new Promise<void>(yes=>{entered=yes;});
  try {
    const cookie=f.cookie(f.user.id);
    const work=f.runtime.db.createWork(f.user.id,"certlab","report-authoring","report");
    const run=f.runtime.useCases.users.run(f.user.id,"work",work.id,async()=>{entered();await barrier;return "finished";});await ready;
    const result=await f.change(f.admin.id,f.user.id,change(0,{enabled:false}));assert.equal(result.json().user.status,"draining");
    assert.equal((await f.app.inject({url:"/api/v1/auth/me",headers:cookie})).statusCode,200);
    assert.equal((await f.app.inject({url:`/api/v1/works/${work.id}`,headers:cookie})).statusCode,200);
    assert.equal((await f.app.inject({url:"/api/v1/om/workspaces",headers:cookie})).statusCode,403);
    await assert.rejects(f.runtime.useCases.users.run(f.user.id,"work","new",async()=>undefined),/UserUnavailable/);
    assert.equal((await f.change(f.admin.id,f.user.id,change(1,{requestId:"early-restore",enabled:true}))).json().error,"UserStillDraining");
    release();assert.equal(await run,"finished");
    assert.equal(f.runtime.db.userById(f.user.id)!.status,"disabled");
    assert.equal((await f.app.inject({url:"/api/v1/auth/me",headers:cookie})).statusCode,401);
  } finally {release();await f.close();}
});

test("restarting finalizes draining accounts without deleting resources",async()=>{
  const f=fixture();
  try {
    const work=f.runtime.db.createWork(f.user.id,"certlab","report-authoring","report");
    f.runtime.db.changeUser(f.admin.id,f.user.id,change(0,{enabled:false}),true);
    const restarted=new ForgeRuntime(f.runtime.config);
    assert.equal(restarted.db.userById(f.user.id)!.status,"disabled");
    assert.equal(restarted.db.work(work.id)!.ownerUserId,f.user.id);
    restarted.db.close();
  } finally {await f.close();}
});

test("concurrent administrators cannot both remove the last active administrator", async () => {
  const root = mkdtempSync(join(tmpdir(), "forge-admin-race-"));
  const db = new ForgeDatabase(root);
  const one = db.ensureUser("one@example.invalid"), two = db.ensureUser("two@example.invalid");
  const promoted = db.changeUser(one.id, two.id, change(0, { role: "admin" }), false); db.close();
  try {
    const module = new URL("./database.js", import.meta.url).href;
    const demote = (user: typeof one) => new Promise<string>((resolve, reject) => {
      const worker = new Worker(`const {parentPort,workerData:d}=require('node:worker_threads');import(d.module).then(({ForgeDatabase})=>{const db=new ForgeDatabase(d.root);try {db.changeUser(d.user.id,d.user.id,{expectedVersion:d.user.version,requestId:'self-demote',reason:'Concurrent offboarding',role:'user'},false);parentPort.postMessage('ok');}catch(error){parentPort.postMessage(error.message);}finally{db.close();}}).catch(error=>{throw error});`, { eval:true, workerData:{ root,module,user } });
      worker.on("message", resolve); worker.on("error", reject);
    });
    assert.deepEqual((await Promise.all([demote(one), demote(promoted)])).sort(), ["LastActiveAdministrator", "ok"].sort());
    const check = new ForgeDatabase(root);
    assert.equal(check.listUsers().filter(user => user.role === "admin" && user.status === "active").length, 1); check.close();
  } finally { rmSync(root, { recursive:true,force:true }); }
});

test("disable and execution admission are serialized in either arrival order",async()=>{
  for(const disableFirst of [false,true]) {
    const f=fixture();let release!:()=>void;const gate=new Promise<void>(yes=>{release=yes;});
    try {
      const start=()=>f.runtime.useCases.users.run(f.user.id,"work","racing-work",()=>gate);
      const disable=()=>f.runtime.useCases.users.change(f.admin.id,f.user.id,change(0,{enabled:false}));
      if(disableFirst) {
        const stopped=disable();const execution=start().then(()=>"accepted",()=>"rejected");
        assert.equal((await stopped).status,"disabled");assert.equal(await execution,"rejected");
      } else {
        const execution=start();const stopped=disable();
        assert.equal((await stopped).status,"draining");release();await execution;
        assert.equal(f.runtime.db.userById(f.user.id)!.status,"disabled");
      }
    } finally {release();await f.close();}
  }
});
