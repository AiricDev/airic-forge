/** Explicit, operator-invoked live acceptance; real material only after user authorization. */
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {parseEnv} from 'node:util';
import {join} from 'node:path';
import {ForgeRuntime} from './runtime.js';
import {loadConfig} from './config.js';
let stdin='';for await(const chunk of process.stdin)stdin+=chunk;
const scene=JSON.parse(stdin) as {origin:string;token:string;organizationId:string;reportId:string;assessmentId:string;revisionId:string;dataDir:string;omSource:string};
const env={...process.env,...parseEnv(await readFile('.env','utf8'))};
const runtime=new ForgeRuntime({...loadConfig(env),dataDir:join(scene.dataDir,'forge'),projectDir:join(scene.dataDir,'om'),seedProjectDir:scene.omSource,reportWorkDefinitionId:'certification-assessment',organizationId:scene.organizationId,certLabUrl:scene.origin});
const boot=await runtime.useCases.bootstrap({token:scene.token,reportId:scene.reportId,selection:{assessment_id:scene.assessmentId}});
const timeout=setTimeout(()=>{void runtime.useCases.cancelTurn(boot.ticket);},600000);
try{
  const prompt=`进行已授权的原生Agent验收，只评估当前条款9.6.1，不扩展到其他条款。资料为长存流道说明书v2.pdf，固定修订ID ${scene.revisionId}。索引可能尚未运行；已知修订可直接asset.read读取，不能因索引pending停等。加载pdf-reading Skill，围绕本条义务读相关正文和实际图像，必要时局部核对；将固定来源、实际发现、疑点和下一步保存到reading-notes.md/progress.md。已有充分事实后，开始评估并保存一份本条款草稿，使用冻结Schema的合法值，不要求得到Conforms。尚未覆盖的内容明确未知，不能断言整篇不存在。对仍不足以下结论的部分保留限制，但不要无限重读或先评全章。用真实事件和回执记录检查点，再交付。不要提交复核、确认、正式输出或修改OM。这是独立临时报告，不要访问现有业务报告。`;
  await runtime.useCases.startTurn(boot.ticket,prompt,undefined,[],undefined,undefined,undefined,a=>{if(a.status!=='running')console.log(JSON.stringify({activity:a.label,status:a.status,detail:a.detail,code:a.code}));});
  const history=await runtime.useCases.sessionHistory(boot.ticket);
  const saved=history.events.filter(e=>e.type==='action'&&e.payload.capabilityId==='assessment.save-draft'&&e.payload.status==='committed');
  const reads=history.events.filter(e=>e.type==='observation'&&e.payload.capabilityId==='asset.read');
  const context=await runtime.app.query(scene.token,'assessment.context',{report_id:scene.reportId,assessment_id:scene.assessmentId});
  const result={status:saved.length?'passed':'incomplete',reportId:scene.reportId,assessmentId:scene.assessmentId,workId:boot.work.id,turns:history.turns,sourceReads:reads.map(e=>({id:e.id,source:(e.payload.result as Record<string,unknown>)?.source})),savedCommands:saved.map(e=>({id:e.id,...e.payload})),assessment:context.assessment,reply:history.events.filter(e=>e.type==='turn.completed').at(-1)?.payload.text};
  await writeFile(join(scene.dataDir,'live-result.json'),JSON.stringify(result,null,2),{mode:0o600});
  console.log(JSON.stringify({status:result.status,workId:boot.work.id,reads:reads.length,savedDrafts:saved.length}));
  assert.ok(saved.length,'Agent did not save a draft');assert.ok(reads.length,'Agent did not read original pages');
}finally{clearTimeout(timeout);runtime.db.close();}
