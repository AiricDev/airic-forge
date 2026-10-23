import { testUser } from "../../apps/api/test-dist/test-users.js";
// Real API + disposable SQLite/Git/trajectory storage. Only the model adapter is deterministic.
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { ForgeUseCases } from '../../packages/domain/dist/index.js';
import { TestRuntime as ForgeRuntime } from '../../apps/api/test-dist/test-runtime.js';
import { buildServer } from '../../apps/api/test-dist/server.js';
import { hashPassword, verifyPassword } from '../../apps/api/test-dist/auth.js';
import { systemPort } from '../../apps/api/test-dist/system-port.js';
import { createTestOmCommit } from '../../apps/api/test-dist/om-commit-fixture.js';
import { testCatalog } from '../../apps/api/test-dist/test-tool-catalog.js';
const root = mkdtempSync(join(tmpdir(), 'airic-mui-e2e-'));
const port = Number(process.env.FORGE_E2E_PORT || 4189);
const seed = join(root, 'seed');
cpSync(resolve('tests/fixtures/operating-model'), seed, { recursive: true });
const runtime = new ForgeRuntime({ port, bindHost: '127.0.0.1', projectDir: join(root, 'project'), dataDir: join(root, 'data'), seedProjectDir: seed, webDistDir: resolve('apps/workbench/public'), appUrl: 'http://127.0.0.1:1', organizationId: 'synthetic-mui-institution', allowedOrigin: `http://127.0.0.1:${port}`, testIdentitySwitch: true });
function pause(ms, signal) {
  return new Promise((resolve, reject) => {
    const finish = () => { signal?.removeEventListener('abort', cancel); resolve(); };
    const timer = setTimeout(finish, ms);
    const cancel = () => { clearTimeout(timer); reject(new Error('ReflectionCancelled')); };
    signal?.addEventListener('abort', cancel, { once: true });
    if (signal?.aborted) cancel();
  });
}
const reflectionAgent = { analyze: async (input) => {
  input.signal?.throwIfAborted();
  input.onProgress?.({ type: 'tool.status', tool: { id: 'read-trajectory', name: 'read_work_trajectory', status: 'running' } });
  const events = await input.readTrajectory?.(0, 20) ?? [];
  input.onProgress?.({ type: 'tool.status', tool: { id: 'read-trajectory', name: 'read_work_trajectory', status: 'completed' } });
  const ids = events.slice(0, 1).map((event) => event.id);
  if (input.question.includes('fixture-failure')) {
    input.onProgress?.({ type: 'text.delta', text: '失败前的部分回复' });
    await pause(200, input.signal);
    throw new Error('FixtureAgentUnavailable');
  }
  if (input.question.includes('fixture-scroll')) {
    const text = Array.from({ length: 35 }, (_, index) => `### 回答片段 ${index + 1}\n\n这是用于验证阅读位置的内容，不应该在追加回复时强制跳到底部。`).join('\n\n');
    input.onProgress?.({ type: 'text.delta', text });
    await pause(1500, input.signal);
    input.onProgress?.({ type: 'text.delta', text: '\n\n后续追加内容' });
    await pause(500, input.signal);
    return { outcome: 'analysis', analysis: text + '\n\n后续追加内容', attribution: '', citedEventIds: ids };
  }
  if (input.question.includes('fixture-stream') || input.question.includes('fixture-stop')) {
    input.onProgress?.({ type: 'text.delta', text: '逐步回复：第一段' });
    await pause(input.question.includes('fixture-stop') ? 30000 : 3500, input.signal);
    input.onProgress?.({ type: 'text.delta', text: '，第二段。' });
    await pause(500, input.signal);
    return { outcome: 'analysis', analysis: '逐步回复：第一段，第二段。', attribution: '', citedEventIds: ids };
  }
  if (input.lens.id === 'domain-knowledge') {
    const id = input.reflectionId.replaceAll('_', '-');
    await input.writeDraftFile?.(`subject-knowledge/${id}.md`, `---\nid: ${id}\ntitle: Evidence location\nsummary: Keep source locations.\ntopics: [evidence]\n---\n\nKeep source locations for every extracted fact.\n`, ids, '记录每条事实的证据位置');
    return { outcome: 'changes', analysis: '应保留证据位置。', attribution: '这个 Work 中出现了证据定位问题。', changeSummary: '记录每条事实的证据位置', citedEventIds: ids, edits: [] };
  }
  if (input.lens.id === 'delegation-gap') {
    const path = 'work-definitions/document-task/recovery.md';
    const original = runtime.om.document(input.scope.omRevision, path);
    await input.writeDraftFile?.(path, original + '\n\nPreserve the source of unresolved observations.\n', ids, '澄清未决观察的交接方法');
    return { outcome: 'changes', analysis: '准备未决观察的交接方法。', attribution: '该 Work 需要明确交接来源。', changeSummary: '澄清未决观察的交接方法', citedEventIds: ids, edits: [] };
  }
  if (input.lens.id === 'api-suggestion') return { outcome: 'api-suggestion', analysis: '需要证据位置能力。', attribution: '能力缺口', citedEventIds: ids, suggestionMarkdown: '# API Suggestion\n\nAdd workspace.evidence-location.' };
  return { outcome: 'analysis', analysis: '可以继续讨论这个 Work。', attribution: '', citedEventIds: ids };
} };
runtime.useCases = new ForgeUseCases({ accounts: runtime.db, works: runtime.db, om: runtime.om, omChanges: runtime.omChanges, omDrafts: runtime.drafts, organization: runtime.organization, measurements: runtime.db, instanceSettings: runtime.instanceSettings, app: runtime.app, organizationId: runtime.config.organizationId, toolSnapshots: runtime.db, agents: { runWork: async () => ({ text: 'Fixture response' }) }, reflectionAgent, reflectionRunStore: runtime.db, sessions: runtime.sessions, passwordSetups: runtime.passwordSetups, passwordCodec: { hash: hashPassword, verify: verifyPassword }, trajectories: runtime.trajectories, system: systemPort, });
const password = 'MUI-browser-password-123';
const initialAdmin = runtime.db.ensureUser('mui-initial-admin@example.invalid');
const manager = testUser(runtime.db, 'mui-manager@example.invalid', true);
const managed = testUser(runtime.db, 'mui-managed@example.invalid', false);
for (const user of [initialAdmin, manager, managed]) { runtime.db.setInitialPassword(user.id, hashPassword(password)); runtime.om.ensureUserBranch(user.id); }
const setupUser = testUser(runtime.db, 'mui-setup@example.invalid', false);
runtime.om.ensureUserBranch(setupUser.id);
const setupTicket = runtime.passwordSetups.issue(setupUser.id, new Date(Date.now() + 3600000).toISOString());
const metadata = process.env.FORGE_E2E_METADATA || join(root, 'fixture.json');
writeFileSync(metadata, JSON.stringify({ setupTicket }), { flag: 'wx', mode: 0o600 });
const admin = testUser(runtime.db, 'mui-admin@example.invalid', true);
const owner = testUser(runtime.db, 'mui-owner@example.invalid', false);
const member = testUser(runtime.db, 'mui-member@example.invalid', false);
for (const user of [admin, owner, member]) { runtime.db.setInitialPassword(user.id, hashPassword(password)); runtime.om.ensureUserBranch(user.id); }
const catalog = { ...testCatalog('mui-accepted'), id: 'mui-catalog' };
runtime.db.recordToolSnapshot(catalog);
const policy = 'work-definitions/document-task/policy.md';
const base = runtime.om.head(`users/${owner.id}`);
await createTestOmCommit(runtime, owner.id, [{ path: policy, content: runtime.om.document(base, policy) + '\n\nPreserve evidence source locations.\n' }], 'Shared policy');
const contribution = await runtime.useCases.createOrganizationContribution(admin.id, owner.id, '分享证据定位方法', 'Work reference');
// Leave this contribution open for the full governance flow in the browser.
for (let index = 0; index < 45; index++) {
  const work = runtime.db.createWork(owner.id, 'sample-app', 'document-task', `mui-report-${index}`);
  if (index !== 44) runtime.db.setWorkEntityTitle(work.id, index === 0 ? '设备安全报告' : `设备检验报告 ${index}`);
  const revision = runtime.om.head(`users/${owner.id}`);
  const count = index === 0 ? 15 : 1;
  for (let turnIndex = 0; turnIndex < count; turnIndex++) {
    const turn = runtime.db.nextTurn(work.id, revision, catalog.digest, 'fixture-context');
    runtime.trajectories.append({ id: `event-${index}-${turnIndex}`, workId: work.id, turnId: turn.id, type: 'turn.started', at: new Date().toISOString(), payload: { userMessage: `检查证据位置 ${index}-${turnIndex}` } });
    runtime.trajectories.append({ id: `reply-${index}-${turnIndex}`, workId: work.id, turnId: turn.id, type: 'turn.completed', at: new Date().toISOString(), payload: { text: '已读取标准条款和证据位置。' } });
    runtime.trajectories.append({ id: `action-${index}-${turnIndex}`, workId: work.id, turnId: turn.id, type: 'observation', at: new Date().toISOString(), payload: { capabilityId: 'entry.history', input: {}, result: { record_no: 1 } } });
    runtime.db.completeTurn(turn.id, 'completed');
  }
  if (index < 4) {
    await runtime.useCases.openWorkReflection(owner.id, work.id);
    await runtime.useCases.startReflectionConversation(owner.id, work.id, index === 2 ? '/api-suggestion 分析能力缺口' : index === 3 ? '/delegation-gap 改进交接方法' : index === 0 ? '/domain-knowledge 记录证据定位方法' : '讨论证据位置');
  }
}
runtime.db.createWork(member.id, 'sample-app', 'document-task', 'mui-member-private');
const app = buildServer(runtime);
await app.listen({ port, host: '127.0.0.1' });
process.stdout.write(`MUI isolated browser fixture ready at ${port}; contribution ${contribution.id}\n`);
let closing = false;
async function close() { if (closing) return; closing = true; await app.close(); runtime.db.close(); rmSync(root, { recursive: true, force: true }); rmSync(metadata, { force: true }); process.exit(0); }
process.on('SIGTERM', () => void close()); process.on('SIGINT', () => void close());
