import assert from "node:assert/strict";
import test from "node:test";
import {createServer} from "node:http";
import {once} from "node:events";
import {mkdtemp,rm} from "node:fs/promises";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {PiWorkAgentRunner} from "./pi-work-agent.js";
import {loadConfig} from "./config.js";

test("real Pi SDK counts system tool declarations once before reaching a model endpoint",async()=>{
  assert.equal(loadConfig({}).contextInputTokens,256000);
  let requests=0, modelWaits=0;
  const server=createServer(async(req,res)=>{
    let body="";for await(const chunk of req)body+=chunk;
    const input=JSON.parse(body);requests++;
    assert.ok(input.messages?.length && input.tools?.length===1);
    assert.ok(JSON.stringify(input.messages).includes("Use progressive retrieval"));
    assert.ok(JSON.stringify(input.messages).includes("no hit never proves absence"));
    res.writeHead(200,{"Content-Type":"text/event-stream"});
    const base={id:"synthetic",object:"chat.completion.chunk",created:1,model:"deepseek-flash"};
    res.write('data: '+JSON.stringify({...base,choices:[{index:0,delta:{role:"assistant",content:"只读检查正常。"},finish_reason:null}]})+'\n\n');
    res.write('data: '+JSON.stringify({...base,choices:[{index:0,delta:{},finish_reason:"stop"}],usage:{prompt_tokens:18000,completion_tokens:10,total_tokens:18010}})+'\n\n');
    res.end('data: [DONE]\n\n');
  });
  server.listen(0,"127.0.0.1");await once(server,"listening");
  const address=server.address();assert.ok(address && typeof address!=="string");
  const root=await mkdtemp(join(tmpdir(),"forge-sdk-budget-"));
  try {
    const runner=new PiWorkAgentRunner({...loadConfig({}),dataDir:root,modelProvider:"deepseek",modelId:"deepseek-flash",modelApiKey:"synthetic-not-a-secret",modelBaseUrl:`http://127.0.0.1:${address.port}/v1`});
    const response=await runner.runWork({sessionId:"synthetic-budget",signal:AbortSignal.timeout(15000),onModelStatus:()=>{modelWaits++;},userMessage:"Only read; do not execute tools.",context:{workGoal:"Read synthetic context"},documents:[{id:"required",content:"x".repeat(30000)}],availableDocumentIds:[],loadDocument:async()=>"",tools:[{capability:{id:"asset.search",kind:"query",title:"Search",description:"bounded reference",inputSchema:{type:"object",properties:{revision_id:{type:"string",description:"y".repeat(13000)}}},outputSchema:{}},invoke:async()=>{throw Error("No tool execution expected");}}]});
    assert.equal(response.text,"只读检查正常。");assert.equal(requests,1);assert.equal(modelWaits,1);
  } finally {await new Promise<void>(resolve=>{server.close(()=>resolve());server.closeAllConnections();});await rm(root,{recursive:true,force:true});}
});

test("real Pi tool chains compact complete groups and continue without replay",async()=>{
  let steps=0,summaries=0,tools=0;
  const server=createServer(async(req,res)=>{
    let body="";for await(const chunk of req)body+=chunk;const input=JSON.parse(body);
    res.writeHead(200,{"Content-Type":"text/event-stream"});
    const base={id:"chain",object:"chat.completion.chunk",created:1,model:"deepseek-flash"};
    const send=(delta:unknown,finish:string|null=null)=>res.write('data: '+JSON.stringify({...base,choices:[{index:0,delta,finish_reason:finish}]})+'\n\n');
    if(!input.tools?.length){assert.equal(input.max_tokens ?? input.max_completion_tokens,8000);summaries++;send({role:"assistant",content:"合成步骤已读取，结果待核对。"});send({},"stop");}
    else if(steps++<10){send({role:"assistant",tool_calls:[{index:0,id:'call-'+steps,type:'function',function:{name:'asset_read',arguments:JSON.stringify({page:steps})}}]});send({},"tool_calls");}
    else{send({role:"assistant",content:"Chain finished"});send({},"stop");}
    res.end('data: [DONE]\n\n');
  });server.listen(0,"127.0.0.1");await once(server,"listening");const a=server.address();assert.ok(a&&typeof a!=="string");
  const root=await mkdtemp(join(tmpdir(),"forge-sdk-chain-"));
  try {
    const runner=new PiWorkAgentRunner({...loadConfig({}),dataDir:root,modelProvider:"deepseek",modelId:"deepseek-flash",modelApiKey:"synthetic",modelBaseUrl:`http://127.0.0.1:${a.port}/v1`});
    const result=await runner.runWork({sessionId:"chain",inputTokens:32000,signal:AbortSignal.timeout(15000),userMessage:"Read ten synthetic pages, then finish.",context:{workGoal:"Synthetic chain"},documents:[{id:"required",content:"x".repeat(30000)}],availableDocumentIds:[],loadDocument:async()=>"",tools:[{capability:{id:"asset.read",kind:"query",title:"Read",description:"Read",inputSchema:{type:"object",properties:{page:{type:"integer",description:"y".repeat(13000)}}},outputSchema:{}},invoke:async input=>{tools++;return {source:{revision_id:"r",page:input.page,sha256:"fixed",text_range:{offset:0,end:4000}},text:"文".repeat(4000)};}}]});
    assert.equal(result.text,"Chain finished");assert.equal(tools,10);assert.ok(summaries>0);
  } finally {await new Promise<void>(r=>{server.close(()=>r());server.closeAllConnections();});await rm(root,{recursive:true,force:true});}
});

// These replies exercise the summary adapter contract without a provider request.
test("Work summaries reject empty, overlong, truncated and tool replies", async () => {
  const {summarizeWorkContext}=await import("./pi-context-summary.js");
  const model={maxTokens:8000,contextWindow:128000} as Parameters<typeof summarizeWorkContext>[1];
  for (const response of [
    {stopReason:"stop",content:[{type:"text",text:" "}]},
    {stopReason:"stop",content:[{type:"text",text:"文".repeat(4001)}]},
    {stopReason:"length",content:[{type:"text",text:"Incomplete"}]},
    {stopReason:"stop",content:[{type:"toolCall",id:"x",name:"x",arguments:{}}]},
  ]) {
    const runtime={completeSimple:async()=>response} as unknown as Parameters<typeof summarizeWorkContext>[0];
    await assert.rejects(summarizeWorkContext(runtime,model,{text:"Synthetic",previousSummary:"",apiKey:"synthetic"}));
  }
  let calls=0;
  const runtime={completeSimple:async()=>{calls++;return {stopReason:"stop",content:[{type:"text",text:" 已读取合成资料，待人工核对。 "}]};}} as unknown as Parameters<typeof summarizeWorkContext>[0];
  assert.equal(await summarizeWorkContext(runtime,model,{text:"Synthetic",previousSummary:"",apiKey:"synthetic"}),"已读取合成资料，待人工核对。");
  await assert.rejects(summarizeWorkContext(runtime,model,{text:"文".repeat(100000),previousSummary:"",apiKey:"synthetic"}),/ContextSummaryInputTooLarge/);
  assert.equal(calls,1);
});

test("oversized CJK tool transcripts summarize in bounded fragments, with no partial result on failure",async()=>{
  const {summarizeWorkContextInBatches}=await import("./pi-context-summary.js");
  const {contextTokens}=await import("@airic-forge/domain");
  const model={maxTokens:8000,contextWindow:128000} as Parameters<typeof summarizeWorkContextInBatches>[1];
  const fragments:string[]=[];let fail=false;
  const runtime={completeSimple:async(_model:unknown,context:{messages:unknown[]})=>{
    assert.ok(contextTokens(context.messages)<32000-4096);
    const data=JSON.parse((context.messages[1] as {content:string}).content);fragments.push(data.discussion);
    if(fail && fragments.length===2)throw Error("SyntheticSummaryFailure");
    return {stopReason:"stop",content:[{type:"text",text:"合成资料范围已读，引用原文前须重读；无写入回执。"}]};
  }} as unknown as Parameters<typeof summarizeWorkContextInBatches>[0];
  const text="要求😀\"\\\n".repeat(16000),original=text;
  const result=await summarizeWorkContextInBatches(runtime,model,{text,previousSummary:"",apiKey:"synthetic"});
  assert.ok(result.length && fragments.length>2);assert.equal(text,original);
  assert.equal(fragments.map(s=>s.slice(s.indexOf("\n")+1)).join(""),text);
  fragments.length=0;fail=true;await assert.rejects(()=>summarizeWorkContextInBatches(runtime,model,{text,previousSummary:"",apiKey:"synthetic"}),/SyntheticSummaryFailure/);
});

test("real SDK recovers after a first round larger than both main and summary budgets",async()=>{
  let rounds=0,summaries=0,executed=0;
  const server=createServer(async(req,res)=>{
    let body="";for await(const chunk of req)body+=chunk;const input=JSON.parse(body);
    res.writeHead(200,{"Content-Type":"text/event-stream"});
    const base={id:"first-group",object:"chat.completion.chunk",created:1,model:"deepseek-flash"};
    const send=(delta:unknown,finish:string|null=null)=>res.write('data: '+JSON.stringify({...base,choices:[{index:0,delta,finish_reason:finish}]})+'\n\n');
    if(!input.tools?.length){summaries++;assert.ok(JSON.stringify(input.messages).length<60000);send({role:"assistant",content:"合成报告与资料清单查询已结束，无写入。下一步按需检索。"});send({},"stop");}
    else if(rounds++===0){send({role:"assistant",tool_calls:[{index:0,id:'report',type:'function',function:{name:'report_context',arguments:'{}'}},{index:1,id:'assets',type:'function',function:{name:'asset_list',arguments:'{}'}}]});send({},"tool_calls");}
    else{assert.ok(!input.messages.some((m:{role:string})=>m.role==='tool'));send({role:"assistant",content:"Recovered without replay"});send({},"stop");}
    res.end('data: [DONE]\n\n');
  });server.listen(0,"127.0.0.1");await once(server,"listening");const address=server.address();assert.ok(address&&typeof address!=="string");
  const root=await mkdtemp(join(tmpdir(),"forge-first-group-"));
  try{
    const runner=new PiWorkAgentRunner({...loadConfig({}),dataDir:root,modelProvider:"deepseek",modelId:"deepseek-flash",modelApiKey:"synthetic",modelBaseUrl:`http://127.0.0.1:${address.port}/v1`});
    const result=await runner.runWork({sessionId:"oversized-first-round",inputTokens:32000,signal:AbortSignal.timeout(15000),userMessage:"Synthetic recovery exercise",context:{workGoal:"Read only"},documents:[{id:"required",content:"x".repeat(40000)}],availableDocumentIds:[],loadDocument:async()=>"",tools:["report.context","asset.list"].map(id=>({capability:{id,kind:"query" as const,title:id,description:"Synthetic inventory",inputSchema:{type:"object",properties:{}},outputSchema:{}},invoke:async()=>{executed++;return {text:"文".repeat(14000)};}}))});
    assert.equal(result.text,"Recovered without replay");assert.equal(executed,2);assert.ok(summaries>1);assert.equal(rounds,2);
  }finally{await new Promise<void>(r=>{server.close(()=>r());server.closeAllConnections();});await rm(root,{recursive:true,force:true});}
});
