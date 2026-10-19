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
function material(id:string,offset=0): Extract<Messages[number], {role:"toolResult"}> {return {role:"toolResult",toolName:"asset_read_location",toolCallId:id,timestamp:0,isError:false,content:[{type:"text",text:JSON.stringify({source:{revision_id:"rev",sha256:"a".repeat(64),location_id:"loc",text_range:{offset,end:offset+4000}},text:"内容".repeat(2000)})}]};}
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
  budget.observeUsage(90000);
  const smaller=await budget.project(history);assert.ok(smaller.length<result.length);budget.assertHealthy();
  budget.observeUsage(1_000_000_000);await assert.rejects(()=>budget.project(history));assert.throws(()=>budget.assertHealthy());
});
test("summary failure locks tools; mandatory overflow cannot be hidden by summary",async()=>{
  const budget=new PiContextBudget(32000,"goal",async()=>{throw Error("provider failed");},digest);
  const messages:Messages=Array.from({length:30},()=>({role:"user",content:"文".repeat(2000),timestamp:0}));
  await assert.rejects(()=>budget.project(messages),/ContextSummaryFailed/);assert.throws(()=>budget.assertHealthy(),/ContextSummaryFailed/);
  const mandatory=new PiContextBudget(32000,"文".repeat(24000),async()=>"summary",digest);
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

test("mandatory input between the soft target and hard budget is sent without dropping facts",async()=>{
  let calls=0;const envelope="x".repeat(54000);
  const budget=new PiContextBudget(32000,envelope,async()=>{calls++;return "summary";},digest);
  const result=await budget.project([{role:"user",content:envelope,timestamp:0}]);
  assert.equal(calls,0);assert.ok(JSON.stringify(result).includes(envelope));
});

test("the first completed oversized tool group is summarized without retaining dangling calls",async()=>{
  let calls=0;
  const envelope="x".repeat(40000),budget=new PiContextBudget(32000,envelope,async()=>{calls++;return "Read-only report inventory inspected; search a few candidates next. No commands committed.";},digest);
  const body:Messages=[{role:"user",content:envelope,timestamp:0},{role:"assistant",content:[{type:"toolCall",id:"report",name:"report_context",arguments:{}},{type:"toolCall",id:"assets",name:"asset_list",arguments:{}}],api:"openai-completions",provider:"deepseek",model:"deepseek-flash",usage:{input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}},stopReason:"toolUse",timestamp:0},...(["report","assets"].map(id=>({role:"toolResult" as const,toolCallId:id,toolName:id==="report"?"report_context":"asset_list",content:[{type:"text" as const,text:"x".repeat(35000)}],isError:false,timestamp:0})))];
  const original=JSON.stringify(body),result=await budget.project(body);
  assert.equal(calls,1);assert.ok(estimateRequestTokens(result)<32000);
  assert.equal(result.filter(m=>m.role==="toolResult"||m.role==="assistant").length,0);
  assert.equal(JSON.stringify(body),original);assert.deepEqual(await budget.project(body),result);assert.equal(calls,1);
});

test("Work step serialization retains tool tails and receipt IDs rather than SDK coding truncation",async()=>{
  const {serializeWorkSteps}=await import("./pi-context-budget.js");
  const result:Messages=[{role:"toolResult",toolName:"asset_read",toolCallId:"actual-call",isError:false,timestamp:0,content:[{type:"text",text:"文".repeat(40000)+" RECEIPT-AT-TAIL"},{type:"image",data:"private-pixels",mimeType:"image/png"}]}];
  const text=serializeWorkSteps(result);assert.ok(text.includes("RECEIPT-AT-TAIL"));assert.ok(text.includes("actual-call"));assert.ok(!text.includes("private-pixels"));
});

test("compacting a completed group keeps exact unknown and committed command outcomes",async()=>{
  const envelope="x".repeat(40000),budget=new PiContextBudget(32000,envelope,async()=>"Derived discussion without receipt IDs",digest,undefined,new Set(["assessment_save_draft"]));
  const base=material("command");if(base.role!=="toolResult")throw Error("Expected tool result fixture");
  const commands:Messages=(["unknown","committed"] as const).map(status=>({...base,toolName:"assessment_save_draft",toolCallId:status,content:[{type:"text",text:JSON.stringify({status,commandId:'cmd-'+status,actionEventId:'evt-'+status,receipt:status==='committed'?{status,commandId:'cmd-'+status}:undefined})}]}));
  const result=await budget.project([{role:"user",content:envelope,timestamp:0},...commands,{role:"user",content:"文".repeat(20000),timestamp:0}]);
  assert.ok(JSON.stringify(result).includes('cmd-unknown'));assert.ok(JSON.stringify(result).includes('cmd-committed'));
  assert.ok(JSON.stringify(result).includes('Exact command outcomes'));assert.equal(result.filter(m=>m.role==='toolResult').length,0);
});

test("soft pressure retains the latest complete observations instead of a re-query loop",async()=>{
  let summaries=0;const envelope="x".repeat(54000);const budget=new PiContextBudget(32000,envelope,async()=>{summaries++;return "Earlier steps inspected";},digest);
  const first:Messages=[{role:"user",content:envelope,timestamp:0},{...material('first'),toolName:'asset_search',content:[{type:'text',text:JSON.stringify({coverage:{ready:85,partial:3},adopted:0})}]}];
  const result=await budget.project(first);assert.equal(summaries,0);assert.ok(JSON.stringify(result).includes('"ready\\":85'));
  const next:Messages=[...first,{role:'user',content:'step '.repeat(1800),timestamp:0},{...material('latest'),toolName:'asset_search',content:[{type:'text',text:'LATEST-CANDIDATE-AND-COVERAGE'}]}];
  const compact=await budget.project(next);assert.ok(summaries>0);assert.ok(JSON.stringify(compact).includes('LATEST-CANDIDATE-AND-COVERAGE'));
});

test("coverage facts retain exact scope and counts when large query bodies are summarized",async()=>{
  const envelope="x".repeat(40000);const budget=new PiContextBudget(32000,envelope,async()=>"Derived plan; no inventory JSON",digest);
  const assistant:Extract<Messages[number],{role:'assistant'}>={role:'assistant',content:[{type:'toolCall',id:'all-check',name:'asset_search',arguments:{q:'',scope:'all',limit:1}},{type:'toolCall',id:'current-check',name:'asset_search',arguments:{q:'',scope:'current',limit:1}}],api:'openai-completions',provider:'deepseek',model:'deepseek-flash',usage:{input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}},stopReason:'toolUse',timestamp:0};
  const messages:Messages=[{role:'user',content:envelope,timestamp:0},assistant,...(['all','current'].map(scope=>({...material(scope+'-check'),toolName:'asset_search',content:[{type:'text' as const,text:JSON.stringify({total:scope==='all'?92:0,coverage:scope==='all'?{ready:85,partial:3,unsupported:4}:{}})}]}))),{role:'user',content:'文'.repeat(20000),timestamp:0}];
  const result=await budget.project(messages);const facts=result.find(m=>m.role==='user'&&typeof m.content==='string'&&m.content.startsWith('Exact material coverage'));
  assert.ok(facts&&facts.role==='user'&&typeof facts.content==='string');
  const parsed=JSON.parse(facts.content.slice(facts.content.indexOf('\n')+1));
  assert.deepEqual(parsed.map((p:{scope:string})=>p.scope),['all','current']);
  assert.equal(JSON.parse(parsed[0].observation.content[0].text).total,92);assert.equal(JSON.parse(parsed[1].observation.content[0].text).total,0);
  assert.ok(!JSON.stringify(result).includes('文'.repeat(20000)));
});
