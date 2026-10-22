import assert from "node:assert/strict";
import test from "node:test";
import {createServer} from "node:http";
import {once} from "node:events";
import {mkdtemp,rm} from "node:fs/promises";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {PiWorkAgentRunner} from "./pi-work-agent.js";
import {loadConfig} from "./config.js";

for (const example of [
  {finish:"length",text:"",error:"AgentOutputLimitReached"},
  {finish:"length",text:"Incomplete proposed assessment",error:"AgentOutputLimitReached"},
  {finish:"stop",text:"",error:"AgentReturnedNoText"},
  {finish:"stop",text:"Completed read-only answer",error:undefined},
]) test(`real SDK distinguishes ${example.finish} with ${example.text ? "visible" : "no visible"} text`,async()=>{
  let requests=0;
  const privateReasoning="SYNTHETIC_PRIVATE_REASONING_NEVER_LOG";
  const server=createServer(async(req,res)=>{
    let body="";for await(const chunk of req)body+=chunk;
    const input=JSON.parse(body);requests++;
    assert.equal(input.max_tokens,8000);
    res.writeHead(200,{"Content-Type":"text/event-stream"});
    const base={id:"terminal-response",object:"chat.completion.chunk",created:1,model:"deepseek-flash"};
    const send=(delta:unknown,finish:string|null=null)=>res.write('data: '+JSON.stringify({...base,choices:[{index:0,delta,finish_reason:finish}],...(finish ? {usage:{prompt_tokens:100,completion_tokens:8000,total_tokens:8100}} : {})})+'\n\n');
    send({role:"assistant",reasoning_content:privateReasoning});
    if(example.text)send({content:example.text});
    send({},example.finish);res.end('data: [DONE]\n\n');
  });
  server.listen(0,"127.0.0.1");await once(server,"listening");
  const address=server.address();assert.ok(address&&typeof address!=="string");
  const root=await mkdtemp(join(tmpdir(),"forge-terminal-response-"));
  const warnings:string[]=[];
  const originalWarn=console.warn;
  console.warn=(value:unknown)=>{warnings.push(String(value));};
  try {
    const runner=new PiWorkAgentRunner({...loadConfig({}),dataDir:root,modelProvider:"deepseek",modelId:"deepseek-flash",modelApiKey:"synthetic-key-never-log",modelBaseUrl:`http://127.0.0.1:${address.port}/v1`});
    const run=runner.runWork({sessionId:"synthetic-response",scope:{organizationId:"o",ownerUserId:"u",workId:"w",turnId:"t",omRevision:"r",catalogDigest:"c"},signal:AbortSignal.timeout(15000),userMessage:"Read only",context:{},documents:[],availableDocumentIds:[],loadDocument:async()=>"",tools:[]});
    if(example.error){
      await assert.rejects(run,{message:example.error});
      assert.equal(warnings.length,1);
      const diagnostic=JSON.parse(warnings[0]);
      assert.equal(diagnostic.stopReason,example.finish);
      assert.equal(diagnostic.code,example.error);
      assert.equal(diagnostic.outputTokens,8000);
      assert.equal(diagnostic.outputLimit,8000);
      assert.equal(diagnostic.hasVisibleText,!!example.text);
      assert.ok(diagnostic.contentTypes.includes("thinking"));
      for(const secret of [privateReasoning,"synthetic-key-never-log",example.text].filter(Boolean))assert.ok(!warnings[0].includes(secret));
    }else{
      assert.deepEqual(await run,{text:example.text});
      assert.deepEqual(warnings,[]);
    }
    assert.ok(requests<=2,"only Pi native incomplete-response recovery is permitted");
  }finally{
    console.warn=originalWarn;
    await new Promise<void>(resolve=>{server.close(()=>resolve());server.closeAllConnections();});
    await rm(root,{recursive:true,force:true});
  }
});
