import {existsSync,writeFileSync,renameSync} from "node:fs";
/** Pi owns transcripts, compaction, tools and resource loading. Forge only binds execution identity. */
import {mkdir,readFile,lstat} from "node:fs/promises";
import {join,resolve,relative} from "node:path";
import {resolveAgentResources} from "./agent-resources.js";
import {createHash} from "node:crypto";
import {createAgentSession,createBashToolDefinition,DefaultResourceLoader,ModelRuntime,SessionManager,SettingsManager,createMcpExtension,createToolSearchExtension,type AgentSession} from "@earendil-works/pi-coding-agent";
import type {AgentExecutionScope,AgentRuntimeEvent} from "@airic-forge/domain";
import type {ForgeConfig} from "./config.js";
import {openWorkMcpBridge,type BridgeTool} from "./work-mcp-bridge.js";
const digest=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
export async function openNativeSession(config:ForgeConfig,input:{scope:AgentExecutionScope;kind:'work'|'reflection';id:string;tools:BridgeTool[];instructions:string;documents:Array<{id:string;content:string}>;onRuntimeEvent?:(event:AgentRuntimeEvent)=>Promise<void>}) {
  if(!config.modelProvider||!config.modelId||!config.modelApiKey)throw Error('ForgeModelNotConfigured');
  const deployed=await resolveAgentResources(config,input.kind);
  const root=join(config.dataDir,'agent-workspaces',digest([input.scope.organizationId,input.scope.ownerUserId,input.scope.workId,input.kind,input.id]));
  const cwd=join(root,'files');const epoch=digest([input.scope.omRevision,input.scope.catalogDigest,config.modelProvider,config.modelId,config.modelBaseUrl,config.contextOutputTokens,deployed.digest,config.deploymentId,'pi-native-v2']);
  const agentDir=join(root,'runtime',epoch);await mkdir(cwd,{recursive:true,mode:0o700});await mkdir(agentDir,{recursive:true,mode:0o700});
  for(const path of [root,cwd,agentDir])if((await lstat(path)).isSymbolicLink())throw Error('AgentWorkspaceSymlinkDenied');
  const binding=join(agentDir,'binding.json');let sessionManager:SessionManager;
  let saved: {file:string}|undefined;
  try{saved=JSON.parse(await readFile(binding,'utf8')) as {file:string};}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  if(saved){
    const rel=relative(agentDir,resolve(saved.file));if(!rel||rel.startsWith('..')||rel.startsWith('/'))throw Error('InvalidAgentSessionBinding');
    try{if((await lstat(saved.file)).isSymbolicLink())throw Error('InvalidAgentSessionBinding');}catch{throw Error('AgentSessionFileUnavailable');}
    sessionManager=SessionManager.open(saved.file,agentDir,cwd);
  }else sessionManager=SessionManager.create(cwd,agentDir);
  const runtime=await ModelRuntime.create({refreshOnCreate:false,modelsPath:null,authPath:join(agentDir,'unused-auth.json')});
  if(config.modelBaseUrl)runtime.registerProvider(config.modelProvider,{baseUrl:config.modelBaseUrl});
  await runtime.setRuntimeApiKey(config.modelProvider,config.modelApiKey);
  const model=runtime.getModel(config.modelProvider,config.modelId);if(!model)throw Error('ForgeModelNotFound');
  const maxTokens=Math.min(config.contextOutputTokens??8000,model.maxTokens);
  const settings=SettingsManager.inMemory({...deployed.settings,packages:[],extensions:[],skills:[],prompts:[],themes:[],compaction:{...deployed.settings.compaction,enabled:true,reserveTokens:Math.max(16384,maxTokens,deployed.settings.compaction?.reserveTokens??0)},defaultTools:deployed.settings.defaultTools??['read','write','edit','bash','grep','find','ls']});
  const bridge=await openWorkMcpBridge(input.tools);
  const resources=new DefaultResourceLoader({cwd,agentDir,settingsManager:settings,noExtensions:true,noSkills:true,noPromptTemplates:true,noThemes:true,noContextFiles:true,
    systemPromptOverride:()=>undefined,appendSystemPromptOverride:()=>[input.instructions],
    agentsFilesOverride:()=>({agentsFiles:input.documents.map(d=>({path:`OM:${input.scope.omRevision}/${d.id}`,content:d.content}))}),
    additionalExtensionPaths:deployed.extensions,additionalSkillPaths:deployed.skills,additionalPromptTemplatePaths:deployed.prompts,
    extensionFactories:[createToolSearchExtension(),createMcpExtension({loadConfig:()=>({servers:[{name:'work',source:'forge-runtime',scope:'extension',config:{url:bridge.url,headers:{Authorization:`Bearer ${bridge.token}`},exposure:'deferred'}}],errors:[]}),logPath:join(agentDir,'mcp.log')})],
  });
  let session:AgentSession|undefined;const writes:Promise<void>[]=[];
  const emit=(event:Omit<AgentRuntimeEvent,'sessionId'>)=>{if(input.onRuntimeEvent){const p=input.onRuntimeEvent({...event,sessionId:sessionManager.getSessionId()});writes.push(p);void p.catch(()=>{});}};
  try{
    await resources.reload();
    const diagnostics=[...resources.getExtensions().errors,...resources.getSkills().diagnostics];
    if(diagnostics.length)throw Error('AgentResourceLoadFailed: '+diagnostics.map(d=>'path' in d?d.path:'resource').join(', '));
    ({session}=await createAgentSession({cwd,agentDir,modelRuntime:runtime,model:{...model,maxTokens},settingsManager:settings,sessionManager,resourceLoader:resources,
      customTools:[createBashToolDefinition(cwd,{exposeSessionEnvironment:false,spawnHook:context=>({...context,env:{PATH:process.env.PATH??'',HOME:cwd,TMPDIR:process.env.TMPDIR??'/tmp',LANG:process.env.LANG??'C.UTF-8'}})})] as unknown as NonNullable<Parameters<typeof createAgentSession>[0]>['customTools']}));
    await session.bindExtensions({});
    const sessionFile=sessionManager.getSessionFile();if(!sessionFile)throw Error('AgentSessionPersistenceRequired');
    sessionManager.appendCustomEntry('forge.execution',{...input.scope,kind:input.kind,agentResourceDigest:deployed.digest,deploymentId:config.deploymentId??'source'});
    // Pi intentionally creates no transcript until the first conversation message.
    // Bind only a file that exists, including cancelled first prompts; do not leave
    // a dangling binding when cancellation happens before the first prompt.
    const persistBinding=()=>{if(existsSync(sessionFile)){writeFileSync(binding+'.tmp',JSON.stringify({file:sessionFile}),{mode:0o600});renameSync(binding+'.tmp',binding);}};
    persistBinding();
    emit({kind:'session.bound',sessionFile,agentResourceDigest:deployed.digest,deploymentId:config.deploymentId??'source'});
    const unsubscribe=session.subscribe(event=>{
      if(event.type==='turn_start')persistBinding();
      if(event.type==='tool_execution_start'||event.type==='tool_execution_end')emit({kind:event.type,toolName:event.toolName,toolCallId:event.toolCallId,status:event.type==='tool_execution_start'?'running':event.isError?'failed':'completed'});
      if(event.type==='compaction_end')emit({kind:'compaction',status:event.errorMessage||event.aborted?'failed':'completed',tokensBefore:event.result?.tokensBefore});
      if(event.type==='agent_settled')emit({kind:'agent_settled'});
    });
    const active=session;let closed=false;
    return {session:active,cwd,sessionFile,supportsImages:model.input.includes("image"),async close(){if(closed)return;closed=true;persistBinding();await active.abort();unsubscribe();active.dispose();await bridge.close();await Promise.all(writes);}};
  }catch(error){session?.dispose();await bridge.close();await Promise.allSettled(writes);throw error;}
}
