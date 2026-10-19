import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { assembleWorkMemory, conversationMessages, contextTokens, inputBudget, pinnedWorkFacts, type ContextSummary, type WorkContextPorts } from "./work-context.js";
import type { TrajectoryEvent } from "./ports.js";
const digest = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex");
const scope = {organizationId:"org",ownerId:"owner",workId:"work",omRevision:"rev",catalogDigest:"catalog"};
const event = (id: string, type: TrajectoryEvent["type"], payload: Record<string,unknown>, turnId=id): TrajectoryEvent => ({id,type,payload,turnId,workId:"work",at:"now"});
const history = () => Array.from({length:100},(_,n) => [event(`u${n}`,"turn.started",{userMessage:`用户 ${n} `+"讨论".repeat(100)},`t${n}`),event(`a${n}`,"turn.completed",{text:`答复 ${n} `+"分析".repeat(100)},`t${n}`)]).flat();
function ports() {
  const cache = new Map<string,ContextSummary>(); let calls=0;
  const value: WorkContextPorts = {inputTokens:32_000,summaries:{read:async k=>cache.get(k),write:async(k,v)=>{cache.set(k,structuredClone(v));}},summarizer:{modelFingerprint:"model",summarize:async({messages,previousSummary})=>{calls++; return `讨论摘要，来源 ${messages[0].eventId} 至 ${messages.at(-1)!.eventId}。${previousSummary.slice(0,100)}`;}}};
  return {cache,value,calls:()=>calls};
}
test("short discussion needs no summarizer and required facts cannot be truncated",async()=>{
  const p=ports(); const events=history().slice(0,4);
  const result=await assembleWorkMemory({scope,events,mandatory:{goal:"目标"},ports:p.value,digest});
  assert.equal(p.calls(),0); assert.equal(result.conversation.length,4);
  await assert.rejects(()=>assembleWorkMemory({scope,events,mandatory:"必需".repeat(30000),ports:p.value,digest}),/RequiredContextExceedsBudget/);
  assert.equal(inputBudget(16000),6400); assert.ok(contextTokens("中文")>contextTokens("ab"));
});
test("100 Turns summarize incrementally, retain recent Turns and rebuild after cache loss",async()=>{
  const p=ports(),events=history();
  const first=await assembleWorkMemory({scope,events,mandatory:{goal:"当前目标"},ports:p.value,digest});
  assert.ok(first.memory && first.estimatedTokens<25600); assert.equal(first.conversation.length,8);
  assert.ok(p.calls()>1); const count=p.calls();
  const restart=await assembleWorkMemory({scope,events,mandatory:{goal:"当前目标"},ports:{...p.value},digest});
  assert.equal(p.calls(),count); assert.deepEqual(restart,first);
  p.cache.clear(); await assembleWorkMemory({scope,events,mandatory:{},ports:p.value,digest}); assert.ok(p.calls()>count);
  assert.ok(!JSON.stringify([...p.cache.values()]).includes(events[0].payload.userMessage as string));
});
test("cache cannot cross owner/Work/OM/catalog/model or cover changed source events",async()=>{
  for(const change of [{ownerId:"other"},{workId:"other"},{omRevision:"new"},{catalogDigest:"new"}]) {
    const p=ports(),events=history(); await assembleWorkMemory({scope,events,mandatory:{},ports:p.value,digest}); const before=p.calls();
    await assembleWorkMemory({scope:{...scope,...change},events,mandatory:{},ports:p.value,digest}); assert.ok(p.calls()>before);
  }
  const p=ports(),events=history(); await assembleWorkMemory({scope,events,mandatory:{},ports:p.value,digest}); let before=p.calls();
  events[0].payload.userMessage="changed original"; await assembleWorkMemory({scope,events,mandatory:{},ports:p.value,digest}); assert.ok(p.calls()>before);
  before=p.calls(); p.value.summarizer={...p.value.summarizer,modelFingerprint:"other-model"}; await assembleWorkMemory({scope,events,mandatory:{},ports:p.value,digest}); assert.ok(p.calls()>before);
});
test("failed, overlong or cancelled summaries never publish incomplete cache",async()=>{
  for(const mode of ["failure","overlong","cancel"]){
    const p=ports(),controller=new AbortController();
    p.value.summarizer.summarize=async()=>{if(mode==="failure")throw Error("unavailable");if(mode==="cancel")controller.abort();return mode==="overlong"?"x".repeat(4001):"summary";};
    await assert.rejects(()=>assembleWorkMemory({scope,events:history(),mandatory:{},ports:p.value,digest,signal:controller.signal})); assert.equal(p.cache.size,0);
  }
});
test("deterministic corrections and unknown receipts survive; huge messages remain addressable",()=>{
  const events=[event("feedback","work.feedback",{kind:"correct",note:"必须保留的纠正",checkpointId:"cp"}),event("pending","action",{commandId:"cmd",status:"unknown",locator:{resourceId:"r"}}),event("old","action",{commandId:"ok",status:"pending"}),event("receipt","action",{commandId:"ok",status:"committed",locator:{resourceId:"r"}})];
  const facts=pinnedWorkFacts(events); assert.equal(facts.corrections[0].note,"必须保留的纠正");assert.equal(facts.unresolved.length,1);assert.equal(facts.receipts[0].commandId,"ok");
  const text="中文😀".repeat(5000),chunks=conversationMessages([event("huge","turn.completed",{text})]);
  assert.equal(chunks.map(c=>c.text).join(""),text);assert.ok(chunks.every(c=>c.eventId==="huge" && c.textRange));
});

test("80 percent is an organization target, not a rejection limit for mandatory input", async()=>{
  const p=ports();
  const result=await assembleWorkMemory({scope,events:[],mandatory:"x".repeat(54000),ports:p.value,digest});
  assert.ok(result.estimatedTokens>25600 && result.estimatedTokens<32000);
  assert.equal(p.calls(),0);assert.equal(result.memory,undefined);
});
