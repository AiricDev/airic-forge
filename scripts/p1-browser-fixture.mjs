#!/usr/bin/env node
// Populate an isolated Stage 6 browser fixture. Never use an existing data root.
import { existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ForgeDatabase } from '../apps/api/dist/database.js';
import { GitOperatingModel } from '../apps/api/dist/git-om.js';
import { JsonlTrajectoryStore } from '../apps/api/dist/trajectory.js';
import { hashPassword } from '../apps/api/dist/auth.js';

const root = process.env.FORGE_DEMO_ROOT;
const password = process.env.FORGE_DEMO_PASSWORD;
if (!root || !password || existsSync(root)) throw new Error('FORGE_DEMO_ROOT must be a new path and FORGE_DEMO_PASSWORD is required');
mkdirSync(root, { recursive: true });
const data = join(root, 'data');
const om = new GitOperatingModel(join(root, 'project'), data, resolve(import.meta.dirname, '../seed/project'));
om.initialize();
const db = new ForgeDatabase(data);
try {
  const admin = db.ensureUser('p1-admin@example.invalid', true);
  const author = db.ensureUser('p1-author@example.invalid', false);
  const member = db.ensureUser('p1-member@example.invalid', false);
  for (const user of [admin, author, member]) { db.setInitialPassword(user.id, hashPassword(password)); om.ensureUserBranch(user.id); }
  const ids = ['report.context', 'report.read', 'report.gaps', 'report.update-master', 'report.update-data', 'report-type.context', 'report-type.read', 'report-type.list-published-standards', 'report-type.preview', 'report-type.update-draft'];
  const catalog = { id: 'p1-demo-catalog', appId: 'certreporter', domainRelease: 'certreporter/v1', digest: 'p1-demo-digest', acceptedAt: '', capabilities: ids.map((id) => ({ id, kind: id.includes('update') ? 'command' : 'query', title: id, description: '', inputSchema: {}, outputSchema: {} })) };
  db.saveCandidate(catalog); db.accept('certreporter', catalog.digest, admin.id);
  const authorBranch = om.ensureUserBranch(author.id);
  const base = om.head(authorBranch.branch);
  const proposal = om.createProposal(author.id, 'p1-demo-author', base);
  for (const [path, sentence] of [['work-definitions/report-authoring/policy.md', 'P1 demo: cite the published standard clause before changing a report.'], ['work-definitions/report-authoring/method.md', 'P1 demo: keep a private method note for the author.']]) om.writeProposalFile(proposal.worktree, path, om.document(base, path) + `\n\n${sentence}\n`);
  om.commitProposal(proposal.worktree, 'Demo personal improvement');
  om.adoptProposal(authorBranch.branch, authorBranch.worktree, proposal.branch, base, { 'AiricForge-Source': 'P1 isolated browser fixture' });
  const work = db.createWork(author.id, 'certreporter', 'report-authoring', 'demo-report');
  const turn = db.nextTurn(work.id, base, catalog.digest, 'demo-context');
  db.completeTurn(turn.id, 'completed');
  new JsonlTrajectoryStore(data).append({ id: 'evt-p1-demo', workId: work.id, turnId: turn.id, type: 'message', at: new Date().toISOString(), payload: { kind: 'demo-evidence', summary: 'Author identified a reusable policy improvement.' } });
  process.stdout.write(JSON.stringify({ root, adminEmail: admin.email, authorEmail: author.email, memberEmail: member.email, sourceRevision: om.head(authorBranch.branch), mainRevision: om.head('main') }, null, 2) + '\n');
} finally { db.close(); }
