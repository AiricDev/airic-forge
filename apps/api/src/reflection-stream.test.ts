import { testUser } from "./test-users.js";
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { ForgeUseCases, type ReflectionAgentPort, type ReflectionRun, type ReflectionRunEvent } from "@airic-forge/domain";
import { ForgeRuntime } from "./runtime.js";
import { buildServer } from "./server.js";
import { hashPassword, verifyPassword } from "./auth.js";
import { systemPort } from "./system-port.js";
import { ForgeDatabase } from "./database.js";

function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release };
}
async function fixture(agent: ReflectionAgentPort) {
  const root = mkdtempSync(join(tmpdir(), "forge-stream-"));
  const runtime = new ForgeRuntime({ port: 0, projectDir: join(root, "project"), dataDir: join(root, "data"), seedProjectDir: resolve("../../seed/certlab"), certLabUrl: "http://127.0.0.1:1", organizationId: "synthetic-org", allowedOrigin: "http://localhost:5173", webDistDir: join(root, "web") });
  Object.assign(runtime, { useCases: new ForgeUseCases({ accounts: runtime.db, works: runtime.db, om: runtime.om, omChanges: runtime.omChanges, omDrafts: runtime.drafts, app: runtime.app, toolSnapshots: runtime.db, agents: { runWork: async () => ({ text: "" }) }, reflectionAgent: agent, reflectionRunStore: runtime.db, sessions: runtime.sessions, passwordSetups: runtime.passwordSetups, passwordCodec: { hash: hashPassword, verify: verifyPassword }, trajectories: runtime.trajectories, system: systemPort, }) });
  const owner = testUser(runtime.db, "stream-owner@example.invalid", false);
  const other = testUser(runtime.db, "stream-other@example.invalid", false);
  const admin = testUser(runtime.db, "stream-admin@example.invalid", true);
  runtime.om.ensureUserBranch(owner.id);
  const work = runtime.db.createWork(owner.id, "certreporter", "report-authoring", "report");
  runtime.trajectories.append({ id: "source-event", workId: work.id, type: "message", at: "now", payload: { text: "Evidence" } });
  const { reflection } = await runtime.useCases.openWorkReflection(owner.id, work.id);
  const app = buildServer(runtime);
  const address = await app.listen({ host: "127.0.0.1", port: 0 });
  const cookie = (userId = owner.id) => ({ cookie: `forge_session=${runtime.webSessions.issue(userId)}` });
  const path = `/api/v1/reflections/${reflection.id}/runs`;
  return { runtime, app, address, owner, other, admin, reflection, cookie, path, close: async () => { await app.close(); runtime.db.close(); rmSync(root, { recursive: true, force: true }); } };
}
async function nextEvent(reader: ReadableStreamDefaultReader<Uint8Array>, buffer: { text: string }): Promise<ReflectionRunEvent> {
  while (!buffer.text.includes("\n\n")) {
    const next = await reader.read();
    if (next.done) throw new Error("SSE closed before the expected event");
    buffer.text += new TextDecoder().decode(next.value);
  }
  const index = buffer.text.indexOf("\n\n");
  const frame = buffer.text.slice(0, index);
  buffer.text = buffer.text.slice(index + 2);
  const data = frame.split("\n").find((line) => line.startsWith("data: "));
  if (!data) return nextEvent(reader, buffer);
  return JSON.parse(data.slice(6)) as ReflectionRunEvent;
}

test("real HTTP streams partial text, survives disconnect, restores snapshots and accepts once", async () => {
  const barrier = gate();
  let calls = 0;
  const f = await fixture({ analyze: async (input) => {
    calls++;
    input.onProgress?.({ type: "text.delta", text: "中文的部分回答" });
    await barrier.promise;
    return { outcome: "analysis", analysis: "完整的回答", attribution: "", citedEventIds: [] };
  } });
  try {
    const accepted = await f.app.inject({ method: "POST", url: f.path, headers: f.cookie(), payload: { message: "Discuss", requestId: "same-request" } });
    assert.equal(accepted.statusCode, 202);
    const run = accepted.json().run as ReflectionRun;
    const stream = await fetch(`${f.address}${f.path}/${run.id}/events`, { headers: f.cookie() });
    assert.match(stream.headers.get("content-type")!, /text\/event-stream/);
    const reader = stream.body!.getReader();
    const partial = await nextEvent(reader, { text: "" });
    assert.equal(partial.type, "snapshot");
    assert.equal(partial.run.status, "running");
    assert.equal(partial.run.text, "中文的部分回答");
    await reader.cancel();
    assert.equal((await f.app.inject({ method: "POST", url: f.path, headers: f.cookie(), payload: { message: "Discuss", requestId: "same-request" } })).statusCode, 200);
    assert.equal((await f.app.inject({ method: "POST", url: f.path, headers: f.cookie(), payload: { message: "Changed", requestId: "same-request" } })).statusCode, 409);
    assert.equal((await f.app.inject({ method: "POST", url: f.path, headers: f.cookie(), payload: { message: "Again", requestId: "another-request" } })).statusCode, 409);
    assert.equal(f.runtime.db.reflectionMessages(f.reflection.id).filter((message) => message.role === "user").length, 1);
    const resumed = await fetch(`${f.address}${f.path}/${run.id}/events`, { headers: f.cookie() });
    const resumedReader = resumed.body!.getReader();
    const buffer = { text: "" };
    assert.equal((await nextEvent(resumedReader, buffer)).run.text, "中文的部分回答");
    barrier.release();
    let final = await nextEvent(resumedReader, buffer);
    while (final.run.status === "running") final = await nextEvent(resumedReader, buffer);
    assert.equal(final.type, "completed");
    assert.equal(final.run.text, "完整的回答");
    assert.ok(final.run.agentMessageId);
    assert.equal(calls, 1);
    await resumedReader.cancel();
  } finally { barrier.release(); await f.close(); }
});

test("permissions, same-origin protection and validation precede acceptance", async () => {
  const f = await fixture({ analyze: async () => ({ outcome: "analysis", analysis: "Done", attribution: "", citedEventIds: [] }) });
  try {
    const send = (headers: Record<string, string>, message = "Discuss") => f.app.inject({ method: "POST", url: f.path, headers, payload: { message, requestId: "request-1" } });
    assert.equal((await send({})).statusCode, 401);
    assert.equal((await send(f.cookie(f.other.id))).statusCode, 403);
    assert.equal((await send(f.cookie(f.admin.id))).statusCode, 403);
    assert.equal((await send({ ...f.cookie(), origin: "https://evil.example" })).statusCode, 403);
    assert.equal((await send(f.cookie(), "/unknown Analyze")).statusCode, 400);
    assert.equal(f.runtime.db.reflectionMessages(f.reflection.id).length, 1);
    const { run } = (await send(f.cookie())).json();
    await f.runtime.useCases.reflectionRuns!.wait(f.reflection.id, run.id);
    assert.equal((await f.app.inject({ method: "GET", url: `${f.path}/current`, headers: f.cookie(f.other.id) })).statusCode, 403);
    assert.equal((await f.app.inject({ method: "GET", url: `${f.path}/current`, headers: f.cookie(f.admin.id) })).statusCode, 200);
    assert.equal((await f.app.inject({ method: "POST", url: `${f.path}/${run.id}/cancel`, headers: f.cookie(f.admin.id) })).statusCode, 403);
    assert.equal((await f.app.inject({ method: "GET", url: `${f.path}/wrong-run/events`, headers: f.cookie() })).statusCode, 404);
  } finally { await f.close(); }
});

test("stop preserves a written candidate, excludes governance, and never records a complete partial reply", async () => {
  const entered = gate();
  const finish = gate();
  const f = await fixture({ analyze: async (input) => {
    const events = await input.readTrajectory!(0, 1);
    const path = "subject-knowledge/stream-note.md";
    await input.writeDraftFile!(path, "---\nid: stream-note\ntitle: Source\nsummary: Source\ntopics: [evidence]\n---\n\nPreserve sources.\n", [events[0].id], "Preserve sources");
    input.onProgress?.({ type: "text.delta", text: "Partial answer" });
    entered.release();
    await finish.promise;
    await input.writeDraftFile!(path, "Must not overwrite", [events[0].id], "Must not write");
    throw new Error("Must not reach");
  } });
  try {
    const { run } = await f.runtime.useCases.startReflectionRun(f.owner.id, f.reflection.id, "/domain-knowledge Save lesson", "request-stop");
    await entered.promise;
    const scope = `reflection:${f.reflection.id}`;
    const before = f.runtime.drafts.workspace(f.owner.id, scope)!;
    for (const action of [
      () => f.runtime.omChanges.discard(f.owner.id, scope),
      () => f.runtime.omChanges.rebase(f.owner.id, scope),
      () => f.runtime.omChanges.commit(f.owner.id, scope, "digest", "commit-stop-request"),
    ]) await assert.rejects(() => f.runtime.useCases.mutateOmDraft(f.owner.id, scope, async () => { await action(); }), /ReflectionAlreadyRunning/);
    await assert.rejects(() => f.runtime.useCases.mutateOmDraft(f.admin.id, scope, async () => {}), /ReflectionNotOwned/);
    assert.equal((await f.runtime.useCases.cancelReflectionRun(f.owner.id, f.reflection.id, run.id)).status, "cancelling");
    finish.release();
    assert.equal((await f.runtime.useCases.reflectionRuns!.wait(f.reflection.id, run.id)).status, "cancelled");
    assert.deepEqual(f.runtime.drafts.workspace(f.owner.id, scope), before);
    assert.equal(f.runtime.db.reflectionMessages(f.reflection.id).length, 2);
    assert(f.runtime.drafts.workspace(f.owner.id, scope)?.edits.some((edit) => edit.path === "subject-knowledge/stream-note.md"));
    assert.equal(f.runtime.db.reflection(f.reflection.id)?.status, "active");
  } finally { finish.release(); await f.close(); }
});

test("saved snapshots survive database restart and interrupted runs are not re-executed", async () => {
  const root = mkdtempSync(join(tmpdir(), "forge-run-restart-"));
  let db = new ForgeDatabase(root);
  try {
    const user = testUser(db, "restart@example.invalid", false);
    const work = db.createWork(user.id, "certreporter", "report-authoring", "report");
    const reflection = db.openReflection({ workId: work.id, ownerUserId: user.id, lensId: "conversation", lensVersion: 0, lensPrompt: "", question: "", evidenceEventIds: [], omRevision: "revision" }, "Intro");
    const run = db.createReflectionRun({ id: "run", reflectionId: reflection.id, ownerUserId: user.id, requestId: "request-1", message: "Discuss", status: "running", sequence: 1, text: "Partial", tools: [], createdAt: "now", updatedAt: "now" });
    assert.throws(() => db.createReflectionRun({ ...run, id: "duplicate" }));
    assert.equal(db.reflectionMessages(reflection.id).length, 2);
    db.close();
    db = new ForgeDatabase(root);
    db.interruptReflectionRuns("later");
    assert.equal(db.reflectionRun(run.id)?.status, "interrupted");
    assert.equal(db.reflectionRun(run.id)?.text, "Partial");
    assert.equal(db.reflectionRun(run.id)?.sequence, 2);
  } finally { db.close(); rmSync(root, { recursive: true, force: true }); }
});

for (const outcome of ["completed", "failed", "cancelled"] as const) test(`disabling lets an accepted Reflection settle as ${outcome}, then revokes its session`, async () => {
  const entered = gate(), finish = gate();
  const f = await fixture({ analyze: async () => {
    entered.release(); await finish.promise;
    if (outcome === "failed") throw new Error("SyntheticFailure");
    return { outcome: "analysis", analysis: "Accepted work retained", attribution: "", citedEventIds: [] };
  } });
  try {
    const ownerCookie = f.cookie();
    const accepted = await f.app.inject({ method: "POST", url: f.path, headers: ownerCookie, payload: { message: "Accepted before disable", requestId: `drain-${outcome}` } });
    assert.equal(accepted.statusCode, 202); const run = accepted.json().run as ReflectionRun;
    await entered.promise;
    const disabled = await f.app.inject({ method: "PATCH", url: `/api/v1/users/${f.owner.id}`, headers: f.cookie(f.admin.id), payload: { expectedVersion: f.owner.version, requestId: `disable-${outcome}`, reason: "Offboarding with accepted Reflection", enabled: false } });
    assert.equal(disabled.json().user.status, "draining");
    assert.equal((await f.app.inject({ url: `${f.path}/current`, headers: ownerCookie })).statusCode, 200);
    assert.equal((await f.app.inject({ method: "POST", url: f.path, headers: ownerCookie, payload: { message: "New request", requestId: "forbidden-request" } })).statusCode, 403);
    if (outcome === "cancelled") assert.equal((await f.app.inject({ method: "POST", url: `${f.path}/${run.id}/cancel`, headers: ownerCookie })).statusCode, 200);
    finish.release();
    assert.equal((await f.runtime.useCases.reflectionRuns!.wait(f.reflection.id, run.id)).status, outcome);
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(f.runtime.db.userById(f.owner.id)!.status, "disabled");
    assert.equal((await f.app.inject({ url: "/api/v1/auth/me", headers: ownerCookie })).statusCode, 401);
    assert(f.runtime.db.reflectionMessages(f.reflection.id).some(message => message.content === "Accepted before disable"));
  } finally { finish.release(); await f.close(); }
});
