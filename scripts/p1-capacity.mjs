import { testUser } from "../apps/api/dist/test-users.js";
#!/usr/bin/env node
// Isolated local baseline. Never points at a live Forge data directory.
import { mkdtempSync, appendFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { GitOperatingModel } from '../apps/api/dist/git-om.js';
import { ForgeDatabase } from '../apps/api/dist/database.js';
import { JsonlTrajectoryStore } from '../apps/api/dist/trajectory.js';

const root = mkdtempSync(join(tmpdir(), 'airic-forge-p1-capacity-'));
const project = join(root, 'project');
const data = join(root, 'data');
const seed = resolve(import.meta.dirname, '../seed/project');
const started = performance.now();
let db;
try {
  const om = new GitOperatingModel(project, data, seed);
  om.initialize();
  db = new ForgeDatabase(data);
  const trace = new JsonlTrajectoryStore(data);
  const users = [];
  const works = [];
  for (let i = 0; i < 20; i++) {
    const user = testUser(db, `capacity-${i}@example.invalid`, false);
    om.ensureUserBranch(user.id);
    users.push(user);
    for (let j = 0; j < 5; j++) {
      const work = db.createWork(user.id, 'certreporter', 'report-authoring', `report-${i}-${j}`);
      works.push(work);
      for (let k = 0; k < 20; k++) trace.append({ id: `evt-${i}-${j}-${k}`, workId: work.id, type: 'message', at: new Date().toISOString(), payload: { sample: true, sequence: k } });
    }
  }
  const loadElapsedMs = Math.round(performance.now() - started);
  const readsStarted = performance.now();
  const snapshots = await Promise.all(works.slice(0, 20).map(async (work) => trace.read(work.id)));
  const readElapsedMs = Math.round(performance.now() - readsStarted);
  if (snapshots.some((events) => events.length !== 20)) throw new Error('Trajectory count mismatch');
  const damaged = works[0];
  appendFileSync(join(data, 'trajectories', damaged.id, 'segment-0001.jsonl'), '{"id":"incomplete"');
  trace.append({ id: 'recovered', workId: damaged.id, type: 'message', at: new Date().toISOString(), payload: {} });
  if (trace.read(damaged.id).length !== 21) throw new Error('Truncated-tail recovery failed');
  db.close(); db = new ForgeDatabase(data);
  const restartedOm = new GitOperatingModel(project, data, seed);
  if (db.listUsers().length !== 20 || restartedOm.head('main') !== om.head('main')) throw new Error('Restart recovery failed');
  const result = { profile: 'single local process, temporary SSD-backed Git/SQLite/JSONL', users: users.length, works: works.length, trajectoryEvents: 2001, concurrentReadRequests: 20, loadElapsedMs, readElapsedMs, truncatedTailRecovered: true, restartRecovered: true, totalElapsedMs: Math.round(performance.now() - started) };
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
} finally { db?.close(); rmSync(root, { recursive: true, force: true }); }
