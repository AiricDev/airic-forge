import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { ForgeUseCases } from '../../packages/domain/dist/index.js';
import { ForgeRuntime } from '../../apps/api/dist/runtime.js';
import { InMemoryAppSessionStore } from '../../apps/api/dist/app-session-store.js';
import { InMemoryPasswordSetupStore } from '../../apps/api/dist/password-setup-store.js';
import { hashPassword, verifyPassword } from '../../apps/api/dist/auth.js';
import { systemPort } from '../../apps/api/dist/system-port.js';

const fixturePath = process.env.STAGE2_FIXTURE_PATH;
if (!fixturePath) throw new Error('STAGE2_FIXTURE_PATH is required');
const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));
const root = mkdtempSync(join(tmpdir(), 'forge-recovery-'));
const config = {
  port: 0,
  projectDir: join(root, 'project'),
  dataDir: join(root, 'data'),
  seedProjectDir: resolve(import.meta.dirname, '../../seed/project'),
  webDistDir: join(root, 'web'),
  certReporterUrl: process.env.STAGE2_CERTREPORTER_URL ?? 'http://127.0.0.1:8000',
  allowedOrigin: 'http://127.0.0.1:3000',
  initialAdminEmails: new Set([fixture.email.trim().toLowerCase()]),
};
const runtime = new ForgeRuntime(config);
const client = runtime.certReporter;
let receiptChecks = 0;
let submissions = 0;
const app = {
  identity: (token) => client.identity(token),
  catalog: (token) => client.catalog(token),
  reportContext: (token, id, selection) => client.reportContext(token, id, selection),
  query: (token, id, input) => client.query(token, id, input),
  submitCommand: async (token, id, body) => {
    submissions++;
    const outcome = await client.submitCommand(token, id, body);
    assert.equal(outcome.status, 'committed');
    return { status: 'unknown', reason: 'SimulatedResponseLoss' };
  },
  receipt: async (token, commandId) => {
    receiptChecks++;
    return receiptChecks === 1 ? undefined : client.receipt(token, commandId);
  },
};
let unknown;
const agents = { runWork: async ({ context, tools }) => {
  const tool = tools.find((item) => item.capability.id === 'report.update-master');
  assert.ok(tool);
  unknown = await tool.invoke({
    reportId: fixture.reportId,
    fields: { project_name: `Stage 2 Recovery verified ${Number(context.resource.revision) + 1}` },
    expectedRevision: Number(context.resource.revision),
  });
  assert.equal(unknown.status, 'unknown');
  return { text: 'Command result needs receipt recovery.' };
} };
const useCases = new ForgeUseCases({
  accounts: runtime.db, works: runtime.db, om: runtime.om, certReporter: app,
  catalogs: runtime.db, agents, sessions: new InMemoryAppSessionStore(),
  passwordSetups: new InMemoryPasswordSetupStore(),
  passwordCodec: { hash: hashPassword, verify: verifyPassword },
  trajectories: runtime.trajectories, system: systemPort,
  initialAdminEmails: config.initialAdminEmails,
});

try {
  const before = await client.reportContext(fixture.token, fixture.reportId);
  const session = await useCases.bootstrap({ token: fixture.token, reportId: fixture.reportId });
  const candidate = await useCases.importCatalog(session.ticket);
  await useCases.acceptCatalog(session.ticket, candidate.digest);
  await useCases.startTurn(session.ticket, 'Save the test report name; simulate a lost response.');
  const recovered = await useCases.recoverCommand(session.ticket, unknown.commandId);
  const after = await client.reportContext(fixture.token, fixture.reportId);
  assert.equal(recovered.status, 'committed');
  assert.equal(Number(after.resource.revision), Number(before.resource.revision) + 1);
  assert.equal(submissions, 1);
  const events = await useCases.trajectory(session.ticket, session.work.id);
  assert.deepEqual(events.filter((event) => event.type === 'action').map((event) => event.payload.status), ['pending', 'unknown', 'committed']);
  console.log(JSON.stringify({
    beforeRevision: before.resource.revision,
    afterRevision: after.resource.revision,
    submissions, receiptChecks,
    actionStatuses: ['pending', 'unknown', 'committed'],
  }));
} finally {
  runtime.db.close();
  rmSync(root, { recursive: true, force: true });
}
