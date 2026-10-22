import assert from 'node:assert/strict';
import test from 'node:test';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {mkdtemp,rm,readFile,writeFile,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {PiWorkAgentRunner} from './pi-work-agent.js';
import {openNativeSession} from './pi-native-session.js';
import {openWorkMcpBridge} from './work-mcp-bridge.js';
import {AppMcpClient} from './mcp-client.js';
import {loadConfig} from './config.js';
import type {AgentExecutionScope,AgentRuntimeEvent,WorkAgentTool} from '@airic-forge/domain';
const scope:AgentExecutionScope={organizationId:'org',ownerUserId:'owner',workId:'work',turnId:'turn',omRevision:'revision',catalogDigest:'catalog'};

test('thin MCP bridge keeps tool schemas, rejects wrong credentials and closes after the run',async()=>{
  let calls=0;const bridge=await openWorkMcpBridge([{name:'synthetic.read',description:'Read a synthetic value',inputSchema:{type:'object',properties:{}},invoke:async()=>{calls++;return {content:[{type:'text',text:'value'}]};}}]);
  const client=new AppMcpClient(new URL(bridge.url));
  try{assert.equal((await client.tools(bridge.token))[0].name,'synthetic.read');await client.call(bridge.token,'synthetic.read',{});assert.equal(calls,1);await assert.rejects(()=>client.tools('wrong'));assert.equal(calls,1);}finally{await bridge.close();}
  await assert.rejects(()=>client.tools(bridge.token));
});

test('native session resumes explicit identity, preserves notes, rotates provenance, isolates owners and excludes credentials',async()=>{
  const root=await mkdtemp(join(tmpdir(),'forge-native-binding-'));const config={...loadConfig({}),dataDir:root,modelProvider:'deepseek',modelId:'deepseek-flash',modelApiKey:'synthetic-key'};
  const args={scope,kind:'work' as const,id:scope.workId,tools:[],instructions:'Use notes',documents:[]};
  const opened:Array<Awaited<ReturnType<typeof openNativeSession>>>=[];
  const open=async(a:typeof args)=>{const n=await openNativeSession(config,a);opened.push(n);return n;};
  try{
    const unused=await open(args);await unused.close();
    const first=await open(args);const file=first.sessionFile;const id=first.session.sessionId;first.session.sessionManager.appendMessage({role:'user',content:'Synthetic first prompt',timestamp:0});
    await writeFile(join(first.cwd,'reading-notes.md'),'fixed revision page 4: monthly interval');await first.close();
    const second=await open({...args,scope:{...scope,turnId:'later'}});assert.equal(second.session.sessionId,id);assert.equal(second.sessionFile,file);assert.match(await readFile(join(second.cwd,'reading-notes.md'),'utf8'),/monthly interval/);await second.close();
    const changed=await open({...args,scope:{...scope,omRevision:'new'}});assert.notEqual(changed.sessionFile,file);assert.equal(changed.cwd,second.cwd);await changed.close();
    const other=await open({...args,scope:{...scope,ownerUserId:'another'}});assert.notEqual(other.cwd,second.cwd);await other.close();
    async function inspect(path:string):Promise<void>{for(const item of await readdir(path,{withFileTypes:true})){const p=join(path,item.name);if(item.isDirectory())await inspect(p);else assert.ok(!(await readFile(p,'utf8')).includes('synthetic-key'));}}await inspect(root);
  }finally{await Promise.allSettled(opened.map(n=>n.close()));await rm(root,{recursive:true,force:true});}
});

test('real Pi uses native deferred MCP, persistent files, automatic compaction and a saved draft after reopening',async()=>{
  let phase:'read'|'summary'|'resume'='read',step=0,reads=0,writes=0,summaries=0;const events:AgentRuntimeEvent[]=[];
  const server=createServer(async(req,res)=>{
    let body='';for await(const chunk of req)body+=chunk;const input=JSON.parse(body);
    res.writeHead(200,{'Content-Type':'text/event-stream'});
    const send=(delta:unknown,finish:string|null=null)=>res.write('data: '+JSON.stringify({id:'native',object:'chat.completion.chunk',created:1,model:'deepseek-flash',choices:[{index:0,delta,finish_reason:finish}],...(finish==='stop'&&phase==='read'?{usage:{prompt_tokens:2000000,completion_tokens:10,total_tokens:2000010}}:{})})+'\n\n');
    const call=(name:string,args:unknown)=>{send({role:'assistant',tool_calls:[{index:0,id:'call-'+phase+'-'+step,type:'function',function:{name,arguments:JSON.stringify(args)}}]});send({},'tool_calls');};
    if(!input.tools?.length||phase==='summary'){summaries++;send({role:'assistant',content:'Goal: finish the assessment. Done: read seven pages and saved reading-notes.md. Next: read that note and save the draft. Source fixed revision, page 1. No professional confirmation.'});send({},'stop');}
    else if(phase==='read'){
      if(step===0){assert.ok(!input.tools.some((t:{function:{name:string}})=>t.function.name.includes('asset_read')),'business tools must initially be deferred');call('tool_search',{query:'asset read',limit:1});}
      else if(step<=7)call('mcp__work__asset_read',{page:step,revision_id:'fixed'});
      else if(step===8)call('write',{path:'reading-notes.md',content:'Observed fixed revision page 1: monthly interval is 30 days. Figure detail remains uncertain. Next save a draft.'});
      else{send({role:'assistant',content:'Read outcomes saved in reading-notes.md.'});send({},'stop');}
      step++;
    }else{
      if(step===0)call('read',{path:'reading-notes.md'});
      else if(step===1){assert.ok(JSON.stringify(input.messages).includes('monthly interval is 30 days'));call('tool_search',{query:'save draft',limit:1});}
      else if(step===2)call('mcp__work__assessment_save_draft',{note:'Monthly interval is 30 days; figure detail remains uncertain.'});
      else{assert.ok(JSON.stringify(input.messages).includes('committed'));send({role:'assistant',content:'Draft saved; figure limitation retained.'});send({},'stop');}
      step++;
    }
    res.end('data: [DONE]\n\n');
  });server.listen(0,'127.0.0.1');await once(server,'listening');const address=server.address();assert.ok(address&&typeof address!=='string');
  const root=await mkdtemp(join(tmpdir(),'forge-native-flow-'));
  const config={...loadConfig({}),dataDir:root,modelProvider:'deepseek',modelId:'deepseek-flash',modelApiKey:'synthetic',modelBaseUrl:`http://127.0.0.1:${address.port}/v1`};
  const tools:WorkAgentTool[]=[{capability:{id:'asset.read',kind:'query',title:'Read',description:'asset read PDF original page',inputSchema:{type:'object',properties:{page:{type:'integer'},revision_id:{type:'string'}}},outputSchema:{}},invoke:async p=>{reads++;return {source:{revision_id:'fixed',sha256:'hash',page:p.page},text:'Synthetic page '.repeat(1800),image:{mimeType:'image/png',data:Buffer.from('image-'+p.page).toString('base64')}};}},
    {capability:{id:'assessment.save-draft',kind:'command',title:'Save draft',description:'save draft assessment',inputSchema:{type:'object',properties:{note:{type:'string'}}},outputSchema:{}},invoke:async p=>{writes++;assert.match(String(p.note),/uncertain/);return {status:'committed',commandId:'one-command'};}}];
  const input={sessionId:'browser',scope,signal:AbortSignal.timeout(30000),userMessage:'Read the synthetic manual',context:{},documents:[],availableDocumentIds:[],loadDocument:async()=>'',tools,onRuntimeEvent:async(e:AgentRuntimeEvent)=>{events.push(e);}};
  try{
    const first=await new PiWorkAgentRunner(config).runWork(input);assert.match(first.text,/saved/);assert.equal(reads,7);
    phase='resume';step=0;const result=await new PiWorkAgentRunner(config).runWork({...input,scope:{...scope,turnId:'next'},userMessage:'Continue from notes'});
    assert.match(result.text,/Draft saved/);assert.equal(reads,7);assert.equal(writes,1);assert.ok(summaries>0);assert.ok(events.some(e=>e.kind==='compaction'));assert.ok(events.some(e=>e.kind==='agent_settled'));
  }finally{await new Promise<void>(r=>{server.close(()=>r());server.closeAllConnections();});await rm(root,{recursive:true,force:true});}
});

test('Reflection uses native notes and only governed candidate tools over MCP',async()=>{
  const {PiReflectionAgentRunner}=await import('./pi-reflection-agent.js');let step=0,saved=0;const events:AgentRuntimeEvent[]=[];
  const server=createServer(async(req,res)=>{
    let body='';for await(const c of req)body+=c;const input=JSON.parse(body);
    assert.ok(!input.tools.some((t:{function:{name:string}})=>t.function.name.includes('assessment')));
    res.writeHead(200,{'Content-Type':'text/event-stream'});
    const send=(delta:unknown,finish:string|null=null)=>res.write('data: '+JSON.stringify({id:'reflection',object:'chat.completion.chunk',created:1,model:'deepseek-flash',choices:[{index:0,delta,finish_reason:finish}]})+'\n\n');
    const actions=[{name:'write',args:{path:'progress.md',content:'Read source event e1. Candidate edit requested; not published.'}},{name:'tool_search',args:{query:'write candidate file',limit:1}},{name:'mcp__work__write_candidate_file',args:{path:'subject-knowledge/example.md',content:'Candidate observations',citedEventIds:['e1'],changeSummary:'Prepare candidate'}}];
    const action=actions[step++];if(action){send({role:'assistant',tool_calls:[{index:0,id:'reflection-'+step,type:'function',function:{name:action.name,arguments:JSON.stringify(action.args)}}]});send({},'tool_calls');}
    else{send({role:'assistant',content:JSON.stringify({analysis:'Candidate saved for review.',outcome:'changes',attribution:'Source e1',citedEventIds:['e1'],edits:[],changeSummary:'Prepare candidate'})});send({},'stop');}
    res.end('data: [DONE]\n\n');
  });server.listen(0,'127.0.0.1');await once(server,'listening');const a=server.address();assert.ok(a&&typeof a!=='string');const root=await mkdtemp(join(tmpdir(),'forge-reflection-native-'));
  try{
    const runner=new PiReflectionAgentRunner({...loadConfig({}),dataDir:root,modelProvider:'deepseek',modelId:'deepseek-flash',modelApiKey:'synthetic',modelBaseUrl:`http://127.0.0.1:${a.port}/v1`});
    const result=await runner.analyze({scope,reflectionId:'reflection',lens:{id:'conversation',version:1,enabled:true,prompt:''},question:'Prepare a candidate edit.',messages:[],evidence:[],omRevision:'revision',documents:[],writeDraftFile:async(path,content,ids)=>{assert.equal(path,'subject-knowledge/example.md');assert.equal(content,'Candidate observations');assert.deepEqual(ids,['e1']);saved++;},onRuntimeEvent:async e=>{events.push(e);},signal:AbortSignal.timeout(15000)});
    assert.equal(result.outcome,'changes');assert.equal(saved,1);assert.ok(events.some(e=>e.toolName==='write'));assert.ok(events.some(e=>e.toolName==='mcp__work__write_candidate_file'));
  }finally{await new Promise<void>(r=>{server.close(()=>r());server.closeAllConnections();});await rm(root,{recursive:true,force:true});}
});
