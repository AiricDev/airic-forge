import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile, rm, stat, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileContextSummaryStore } from "./context-summary-store.js";
import { PiContextBudget, replaceRepeatedMaterials, estimateRequestTokens } from "./pi-context-budget.js";
const digest=(v:unknown)=>createHash("sha256").update(JSON.stringify(v)).digest("hex");
type Messages = Parameters<PiContextBudget["project"]>[0];
function material(id:string,offset=0): Messages[number] {return {role:"toolResult",toolName:"asset_read_location",toolCallId:id,timestamp:0,isError:false,content:[{type:"text",text:JSON.stringify({source:{revision_id:"rev",sha256:"a".repeat(64),location_id:"loc",text_range:{offset,end:offset+4000}},text:"内容".repeat(2000)})}]};}
test("repeated exact ranges replace old transient bodies, not adjacent ranges or history",()=>{
  const original: Messages=[material("a"),material("b",4000),material("c")],before=JSON.stringify(original),result=replaceRepeatedMaterials(original);
  assert.ok(JSON.stringify(result[0]).includes("contextReplacement"));assert.ok(!JSON.stringify(result[1]).includes("contextReplacement"));assert.ok(!JSON.stringify(result[2]).includes("contextReplacement"));assert.equal(JSON.stringify(original),before);
  assert.ok(estimateRequestTokens([{type:"image",data:"pixels"}])>=8000);
});
test("tools/system/CJK/images share budget; long tool chains project without rewriting history",async()=>{
  let calls=0;const statuses:string[]=[];
  const budget=new PiContextBudget(32000,"goal",async()=>{calls++;return "工具步骤摘要，只保留来源和回执定位";},digest,s=>statuses.push(s));
  budget.setRequestOverhead({systemPrompt:"system",tools:[{parameters:{type:"object"}}]});
  const history:Messages=[{role:"user",content:"goal",timestamp:0}];
  for(let i=0;i<30;i++)history.push({role:"user",content:"步骤 "+i+"文".repeat(1800),timestamp:i});
  const original=JSON.stringify(history),result=await budget.project(history);
  assert.ok(calls>0 && estimateRequestTokens(result)<32000);assert.deepEqual(statuses,["organizing","ready"]);assert.equal(JSON.stringify(history),original);
  assert.deepEqual(await budget.project(history),result);assert.equal(calls,1);
  budget.observeUsage(90000);await assert.rejects(()=>budget.project(history));assert.throws(()=>budget.assertHealthy());
});
test("summary failure locks tools; mandatory overflow cannot be hidden by summary",async()=>{
  const budget=new PiContextBudget(32000,"goal",async()=>{throw Error("provider failed");},digest);
  const messages:Messages=Array.from({length:30},()=>({role:"user",content:"文".repeat(2000),timestamp:0}));
  await assert.rejects(()=>budget.project(messages),/ContextSummaryFailed/);assert.throws(()=>budget.assertHealthy(),/ContextSummaryFailed/);
  const mandatory=new PiContextBudget(32000,"文".repeat(20000),async()=>"summary",digest);
  await assert.rejects(()=>mandatory.project([]),/RequiredContextExceedsBudget/);
});
test("private cache atomically persists derived memory; corruption rebuilds and symlinks are denied",async()=>{
  const root=await mkdtemp(join(tmpdir(),"forge-context-cache-")),key=digest("scope"),file=join(root,"context-summaries",key+".json");
  try {
    const store=new FileContextSummaryStore(root),record={scope:{organizationId:"o",ownerId:"u",workId:"w",omRevision:"r",catalogDigest:"c",policyVersion:"v",modelFingerprint:"m"},coveredCount:1,sourceDigest:digest("events"),firstEventId:"a",lastEventId:"b",text:"derived summary"};
    await store.write(key,record);assert.deepEqual(await new FileContextSummaryStore(root).read(key),record);assert.equal((await stat(file)).mode & 0o777,0o600);
    assert.equal((await readFile(file,"utf8")).includes("appToken"),false);
    await writeFile(file,"{broken");assert.equal(await store.read(key),undefined);
    await rm(file);await symlink(join(root,"private"),file);assert.equal(await store.read(key),undefined);
    await rm(join(root,"context-summaries"),{recursive:true});await symlink(tmpdir(),join(root,"context-summaries"));await assert.rejects(()=>store.read(key),/SymlinkDenied/);
  } finally {await rm(root,{recursive:true,force:true});}
});
