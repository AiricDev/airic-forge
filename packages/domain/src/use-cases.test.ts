import assert from "node:assert/strict";
import test from "node:test";
import { ForgeUseCases } from "./use-cases.js";
import type { AppSessionPort, SessionGrant, WorkActivity } from "./ports.js";

test("expired ACP grants are removed before any app capability can be used", async () => {
  const grants = new Map<string, SessionGrant>([["expired", { ticket: "expired", expiresAt: "2020-01-01T00:00:00.000Z", forgeUserId: "u", workId: "w", sessionId: "s", appToken: "secret", reportId: "r" }]]);
  const sessions: AppSessionPort = { put: (grant) => { grants.set(grant.ticket, grant); }, get: (ticket) => grants.get(ticket), claim: (ticket) => grants.get(ticket), remove: (ticket) => { grants.delete(ticket); } };
  const useCases = new ForgeUseCases({
    sessions,
    passwordSetups: { issue: () => "setup", consume: () => undefined },
    passwordCodec: { hash: (value) => value, verify: () => false },
    system: { id: () => "id", digest: () => "digest", now: () => "2026-10-02T00:00:00.000Z" },
    accounts: { userById: (id: string) => ({ id, status: "active", version: 0, role: "user" }), finishUserDrain: () => false } as never, works: {} as never, om: {} as never, app: {} as never, toolSnapshots: { recordToolSnapshot: () => {} } as never, agents: {} as never, trajectories: {} as never,
  });
  await assert.rejects(() => useCases.appSession("expired"), /AppSessionExpired/);
  assert.equal(grants.has("expired"), false);
});

test("bootstrap validates the authoritative report before creating a Forge account or Work", async () => {
  let writes = 0;
  const useCases = new ForgeUseCases({
    app: { identity: async () => ({ appId: "certlab", appUserId: "a", email: "a@example.com", displayName: "A" }), reportContext: async () => ({ resource: { namespace: "certlab", resourceType: "report", resourceId: "other-report" } }), discoverTools: async () => { throw new Error("unused"); } } as never,
    accounts: { ensureUser: () => { writes++; throw new Error("must not create user"); } } as never,
    works: { createWork: () => { writes++; throw new Error("must not create Work"); } } as never,
    om: {} as never, toolSnapshots: { recordToolSnapshot: () => {} } as never, agents: {} as never, sessions: {} as never, passwordSetups: {} as never, passwordCodec: {} as never, trajectories: {} as never,
    system: { id: () => "id", digest: () => "digest", now: () => "2026-10-02T00:00:00.000Z" }, });
  await assert.rejects(() => useCases.bootstrap({ token: "app-token", reportId: "requested-report" }), /InvalidReportContext/);
  assert.equal(writes, 0);
});

test("bootstrap rejects an App identity whose verified Email now maps to another Forge user", async () => {
  let writes = 0;
  const useCases = new ForgeUseCases({
    app: {
      identity: async () => ({ appId: "certlab", appUserId: "app-alice", email: "bob@example.com", displayName: "Bob" }),
      reportContext: async () => ({ resource: { namespace: "certlab", resourceType: "report", resourceId: "report-1" } }),
      discoverTools: async () => { throw new Error("unused"); },
    } as never,
    accounts: {
      linkedUserId: () => "forge-alice",
      userByEmail: () => ({ id: "forge-bob", email: "bob@example.com", role: "user", status: "active", version: 0, activeBranch: "users/forge-bob", createdAt: "2026-10-02T00:00:00.000Z", passwordConfigured: true }),
      ensureUser: () => { writes++; throw new Error("must not create user"); },
    } as never,
    works: { createWork: () => { writes++; throw new Error("must not create Work"); } } as never,
    om: {} as never, toolSnapshots: { recordToolSnapshot: () => {} } as never, agents: {} as never, sessions: {} as never, passwordSetups: {} as never, passwordCodec: {} as never, trajectories: {} as never,
    system: { id: () => "id", digest: () => "digest", now: () => "2026-10-02T00:00:00.000Z" }, });
  await assert.rejects(() => useCases.bootstrap({ token: "app-token", reportId: "report-1" }), /AppIdentityEmailConflict/);
  assert.equal(writes, 0);
});

test("a Work ticket cannot complete a different Work", async () => {
  let completed = false;
  const useCases = new ForgeUseCases({
    sessions: { get: () => ({ ticket: "grant", expiresAt: "2026-10-03T00:00:00.000Z", forgeUserId: "user", workId: "own-work", sessionId: "session", appToken: "app-token", reportId: "report" }), claim: () => undefined, put: () => {}, remove: () => {} },
    works: { completeWork: () => { completed = true; } } as never,
    accounts: { userById: (id: string) => ({ id, status: "active", version: 0, role: "user" }), finishUserDrain: () => false } as never, om: {} as never, app: {} as never, toolSnapshots: { recordToolSnapshot: () => {} } as never, agents: {} as never, passwordSetups: {} as never, passwordCodec: {} as never, trajectories: {} as never,
    system: { id: () => "id", digest: () => "digest", now: () => "2026-10-02T00:00:00.000Z" }, });
  await assert.rejects(() => useCases.completeWork("grant", "other-work"), /WorkNotOwned/);
  assert.equal(completed, false);
});

test("opening a Work Reflection twice returns one conversation and one introduction", async () => {
  const records: Array<{ id: string; workId: string; ownerUserId: string }> = [];
  const messages: Array<{ id: string; reflectionId: string; role: "agent" | "user"; content: string; at: string }> = [];
  const useCases = new ForgeUseCases({
    works: {
      work: () => ({ id: "work-1", ownerUserId: "owner" }),
      reflectionsForWork: () => [...records].reverse(),
      openReflection: (input: { workId: string; ownerUserId: string }, introduction: string) => {
        if (!records.length) {
          records.push({ id: "reflection-1", workId: input.workId, ownerUserId: input.ownerUserId });
          messages.push({ id: "intro", reflectionId: records[0].id, role: "agent", content: introduction, at: "now" });
        }
        return records[0];
      },
      reflection: (id: string) => records.find((record) => record.id === id),
      reflectionMessages: () => messages,
      appendReflectionMessage: (id: string, role: "agent" | "user", content: string) => { messages.push({ id: `message-${messages.length}`, reflectionId: id, role, content, at: "now" }); },
      proposalForReflection: () => undefined,
    } as never,
    om: { head: () => "revision-1" } as never,
    accounts: { userById: (id: string) => id === "owner" ? { id, role: "user", status: "active", version: 0 } : { id, role: "user", status: "active", version: 0 } } as never, toolSnapshots: { recordToolSnapshot: () => {} } as never, app: {} as never, agents: {} as never, sessions: {} as never,
    passwordSetups: {} as never, passwordCodec: {} as never, trajectories: {} as never,
    system: { id: () => "id", digest: () => "digest", now: () => "now" }, });
  const first = await useCases.openWorkReflection("owner", "work-1");
  const second = await useCases.openWorkReflection("owner", "work-1");
  assert.equal(first.reflection.id, second.reflection.id);
  assert.equal(records.length, 1);
  assert.equal(messages.length, 1);
  assert.equal(messages[0]?.role, "agent");
  await assert.rejects(() => useCases.openWorkReflection("other", "work-1"), /WorkNotOwned/);
});


test("a Work Turn exposes MCP tools without catalog acceptance or WD restrictions, records an unknown command, and reconciles without replay", async () => {
  const events: Array<{ type: string; turnId?: string; payload: Record<string, unknown> }> = [];
  const calls: string[] = [];
  const catalog = { id: "catalog", appId: "certlab", domainRelease: "certlab/v1", digest: "accepted", discoveredAt: "now", tools: [
    { id: "report.context", title: "Context", description: "", kind: "query" as const, inputSchema: {}, outputSchema: {} },
    { id: "assessment.save-draft", receiptScope: "assessment.save_draft", title: "Update", description: "", kind: "command" as const, inputSchema: {}, outputSchema: {} },
    { id: "report.unallowed", title: "Unallowed", description: "", kind: "command" as const, inputSchema: {}, outputSchema: {} },
  ] };
  const grant = { ticket: "ticket", expiresAt: "2026-10-03T00:00:00.000Z", forgeUserId: "user", workId: "work", sessionId: "session", appToken: "secret", reportId: "report" };
  let nextId = 0;
  const useCases = new ForgeUseCases({
    sessions: { get: () => grant, claim: () => grant, put: () => {}, remove: () => {} },
    works: { work: () => ({ id: "work", goal: "Save draft", ownerUserId: "user", entityId: "report", appId: "certlab", status: "active" }), activeWork: () => ({ id: "work" }), userForWork: () => "user", nextTurn: () => ({ id: "turn", workId: "work", sequence: 1, status: "running", omRevision: "head", catalogDigest: "accepted", contextDigest: "context", startedAt: "now" }), completeTurn: () => {} } as never,
    om: { head: () => "head", workDefinition: () => ({ schemaVersion: 1, id: "report-authoring", title: "Report", description: "", capabilities: { allowed: ["report.context", "assessment.save-draft"] }, documents: [], knowledge: { bootstrap: [], available: [] }, completion: { mode: "user", requiredCapabilities: [] } }), knownKnowledge: () => new Set() } as never,
    toolSnapshots: { recordToolSnapshot: () => {}, toolSnapshot: () => catalog } as never,
    app: {
      discoverTools: async () => catalog,
      reportContext: async () => ({ resource: { namespace: "certlab", resourceType: "report", resourceId: "report", projectId: "project" } }),
      query: async () => ({ assessment: { id: "assessment", report_id: "report", record_no: 3 } }),
      submitCommand: async (_token: string, id: string, body: Record<string, unknown>) => { calls.push(id); assert.equal(body.expectedDomainRelease, "certlab/v1"); return { status: "unknown" as const }; },
      receipt: async () => { calls.push("receipt"); return calls.filter((item) => item === "receipt").length > 1 ? { status: "committed" } : undefined; },
    } as never,
    agents: { runWork: async ({ tools }: { tools: Array<{ capability: { id: string }; invoke: (input: Record<string, unknown>) => Promise<unknown> }> }) => {
      assert.deepEqual(tools.map((tool) => tool.capability.id), ["report.context", "assessment.save-draft", "report.unallowed"]);
      await assert.rejects(() => tools[1].invoke({ report_id: "other", assessment_id: "assessment", expected_record_no: 3 }), /CommandTargetMismatch/);
      const outcome = await tools[1].invoke({ assessment_id: "assessment", expected_record_no: 3 }) as Record<string, unknown>;
      assert.equal(outcome.status, "unknown");
      assert.match(String(outcome.commandId), /^cmd_/);
      assert.match(String(outcome.actionEventId), /^evt_/);
      await assert.rejects(() => tools[1].invoke({ assessment_id: "assessment", expected_record_no: 3 }), /UnresolvedCommandBlocksFurtherWrites/);
      return { text: "Result needs reconciliation" };
    } } as never,
    trajectories: { append: (event: { type: string; turnId?: string; payload: Record<string, unknown> }) => { events.push(event); }, read: () => events } as never,
    system: { id: (prefix) => `${prefix}_${++nextId}`, now: () => "2026-10-02T00:00:00.000Z", digest: () => "context" },
    accounts: { userById: (id: string) => ({ id, status: "active", version: 0, role: "user" }), finishUserDrain: () => false } as never, passwordSetups: {} as never, passwordCodec: {} as never, });
  const activities: WorkActivity[] = [];
  await useCases.startTurn("ticket", "Update this report", undefined, [], undefined, undefined, undefined, value => activities.push(value));
  assert.equal(activities[0].phase, "preparing");
  assert(activities.some(value => value.phase === "context" && value.status === "completed"));
  assert(activities.some(value => value.capabilityId === "assessment.save-draft" && value.status === "running"));
  assert(activities.some(value => value.status === "failed" && value.code === "CommandTargetMismatch"));
  assert(activities.some(value => value.status === "unknown" && value.code === "CommandResultUnknown"));
  assert(!JSON.stringify(activities).includes("secret"));
  assert(!JSON.stringify(activities).includes("expected_record_no"));
  assert(events.some(event => event.payload.activity));
  assert.equal(calls.filter((item) => item === "assessment.save-draft").length, 1);
  const commandId = String(events.find((event) => event.type === "action" && event.payload.status === "unknown")?.payload.commandId);
  assert.match(commandId, /^cmd_/);
  const recovered = await useCases.recoverCommand("ticket", commandId);
  assert.equal(recovered.status, "committed");
  assert.equal(calls.filter((item) => item === "assessment.save-draft").length, 1);
});
