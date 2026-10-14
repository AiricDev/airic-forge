import assert from "node:assert/strict";
import test from "node:test";
import { ForgeUseCases } from "./use-cases.js";
import type { AppSessionPort, SessionGrant } from "./ports.js";

test("expired ACP grants are removed before any app capability can be used", async () => {
  const grants = new Map<string, SessionGrant>([["expired", { ticket: "expired", expiresAt: "2020-01-01T00:00:00.000Z", forgeUserId: "u", workId: "w", sessionId: "s", appToken: "secret", reportId: "r" }]]);
  const sessions: AppSessionPort = { put: (grant) => { grants.set(grant.ticket, grant); }, get: (ticket) => grants.get(ticket), claim: (ticket) => grants.get(ticket), remove: (ticket) => { grants.delete(ticket); } };
  const useCases = new ForgeUseCases({
    sessions,
    passwordSetups: { issue: () => "setup", consume: () => undefined },
    passwordCodec: { hash: (value) => value, verify: () => false },
    system: { id: () => "id", digest: () => "digest", now: () => "2026-10-02T00:00:00.000Z" },
    initialAdminEmails: new Set(),
    accounts: {} as never, works: {} as never, om: {} as never, certReporter: {} as never, catalogs: {} as never, agents: {} as never, trajectories: {} as never,
  });
  await assert.rejects(() => useCases.appSession("expired"), /AppSessionExpired/);
  assert.equal(grants.has("expired"), false);
});

test("bootstrap validates the authoritative report before creating a Forge account or Work", async () => {
  let writes = 0;
  const useCases = new ForgeUseCases({
    certReporter: { identity: async () => ({ appId: "certreporter", appUserId: "a", email: "a@example.com", displayName: "A" }), reportContext: async () => ({ resource: { namespace: "certreporter", resourceType: "report", resourceId: "other-report" } }), catalog: async () => { throw new Error("unused"); }, openApi: async () => { throw new Error("unused"); } } as never,
    accounts: { ensureUser: () => { writes++; throw new Error("must not create user"); } } as never,
    works: { createWork: () => { writes++; throw new Error("must not create Work"); } } as never,
    om: {} as never, catalogs: {} as never, agents: {} as never, sessions: {} as never, passwordSetups: {} as never, passwordCodec: {} as never, trajectories: {} as never,
    system: { id: () => "id", digest: () => "digest", now: () => "2026-10-02T00:00:00.000Z" }, initialAdminEmails: new Set(),
  });
  await assert.rejects(() => useCases.bootstrap({ token: "app-token", reportId: "requested-report" }), /InvalidReportContext/);
  assert.equal(writes, 0);
});

test("bootstrap rejects an App identity whose verified Email now maps to another Forge user", async () => {
  let writes = 0;
  const useCases = new ForgeUseCases({
    certReporter: {
      identity: async () => ({ appId: "certreporter", appUserId: "app-alice", email: "bob@example.com", displayName: "Bob" }),
      reportContext: async () => ({ resource: { namespace: "certreporter", resourceType: "report", resourceId: "report-1" } }),
      catalog: async () => { throw new Error("unused"); },
      openApi: async () => { throw new Error("unused"); },
    } as never,
    accounts: {
      linkedUserId: () => "forge-alice",
      userByEmail: () => ({ id: "forge-bob", email: "bob@example.com", role: "user", activeBranch: "users/forge-bob", createdAt: "2026-10-02T00:00:00.000Z", passwordConfigured: true }),
      ensureUser: () => { writes++; throw new Error("must not create user"); },
    } as never,
    works: { createWork: () => { writes++; throw new Error("must not create Work"); } } as never,
    om: {} as never, catalogs: {} as never, agents: {} as never, sessions: {} as never, passwordSetups: {} as never, passwordCodec: {} as never, trajectories: {} as never,
    system: { id: () => "id", digest: () => "digest", now: () => "2026-10-02T00:00:00.000Z" }, initialAdminEmails: new Set(),
  });
  await assert.rejects(() => useCases.bootstrap({ token: "app-token", reportId: "report-1" }), /AppIdentityEmailConflict/);
  assert.equal(writes, 0);
});

test("a Work ticket cannot complete a different Work", async () => {
  let completed = false;
  const useCases = new ForgeUseCases({
    sessions: { get: () => ({ ticket: "grant", expiresAt: "2026-10-03T00:00:00.000Z", forgeUserId: "user", workId: "own-work", sessionId: "session", appToken: "app-token", reportId: "report" }), claim: () => undefined, put: () => {}, remove: () => {} },
    works: { completeWork: () => { completed = true; } } as never,
    accounts: {} as never, om: {} as never, certReporter: {} as never, catalogs: {} as never, agents: {} as never, passwordSetups: {} as never, passwordCodec: {} as never, trajectories: {} as never,
    system: { id: () => "id", digest: () => "digest", now: () => "2026-10-02T00:00:00.000Z" }, initialAdminEmails: new Set(),
  });
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
    accounts: { userById: (id: string) => id === "owner" ? { id, role: "user" } : undefined } as never, catalogs: {} as never, certReporter: {} as never, agents: {} as never, sessions: {} as never,
    passwordSetups: {} as never, passwordCodec: {} as never, trajectories: {} as never,
    system: { id: () => "id", digest: () => "digest", now: () => "now" }, initialAdminEmails: new Set(),
  });
  const first = await useCases.openWorkReflection("owner", "work-1");
  const second = await useCases.openWorkReflection("owner", "work-1");
  assert.equal(first.reflection.id, second.reflection.id);
  assert.equal(records.length, 1);
  assert.equal(messages.length, 1);
  assert.equal(messages[0]?.role, "agent");
  await assert.rejects(() => useCases.openWorkReflection("other", "work-1"), /WorkNotOwned/);
});

test("only an admin can import and accept a catalog whose capabilities have OpenAPI paths", async () => {
  const candidate = { id: "catalog-1", appId: "certreporter", domainRelease: "certreporter/v1", digest: "digest-1", acceptedAt: "", capabilities: [
    { id: "report.context", kind: "query" as const, title: "Context", description: "", inputSchema: {}, outputSchema: {} },
    { id: "report.update-master", kind: "command" as const, title: "Update", description: "", inputSchema: {}, outputSchema: {} },
  ] };
  let imported = false; let accepted = false;
  const grant = (forgeUserId: string) => ({ ticket: forgeUserId, expiresAt: "2026-10-03T00:00:00.000Z", forgeUserId, workId: "work", sessionId: "session", appToken: "app-token", reportId: "report" });
  const useCases = new ForgeUseCases({
    sessions: { get: (ticket) => grant(ticket), claim: () => undefined, put: () => {}, remove: () => {} },
    accounts: { userById: (id: string) => ({ id, email: `${id}@example.com`, role: id === "admin" ? "admin" : "user", activeBranch: `users/${id}`, createdAt: "2026-10-02T00:00:00.000Z", passwordConfigured: true }) } as never,
    certReporter: { catalog: async () => candidate, openApi: async () => ({ paths: { "/airic/v1/queries/report.context": {}, "/airic/v1/commands/report.update-master": {} } }) } as never,
    catalogs: { saveCandidate: () => { imported = true; }, candidate: () => imported ? candidate : undefined, candidates: () => imported ? [candidate] : [], accept: () => { accepted = true; }, accepted: () => undefined },
    works: {} as never, om: {} as never, agents: {} as never, passwordSetups: {} as never, passwordCodec: {} as never, trajectories: {} as never,
    system: { id: () => "id", digest: () => "digest", now: () => "2026-10-02T00:00:00.000Z" }, initialAdminEmails: new Set(),
  });
  await assert.rejects(() => useCases.importCatalog("user"), /Forbidden/);
  assert.equal(imported, false);
  await useCases.importCatalog("admin");
  assert.equal(imported, true);
  await useCases.acceptCatalog("admin", "digest-1");
  assert.equal(accepted, true);
  const overview = await useCases.catalogOverview("admin");
  assert.equal(overview.accepted, null);
  assert.equal(overview.candidates[0]?.digest, "digest-1");
  await assert.rejects(() => useCases.catalogOverview("user"), /Forbidden/);
  accepted = false;
  await useCases.acceptCatalogFromWorkspace("admin", "digest-1");
  assert.equal(accepted, true);
  await assert.rejects(() => useCases.acceptCatalogFromWorkspace("user", "digest-1"), /Forbidden/);
});

test("a Work Turn exposes only accepted and allowed tools, records an unknown command, and reconciles without replay", async () => {
  const events: Array<{ type: string; turnId?: string; payload: Record<string, unknown> }> = [];
  const calls: string[] = [];
  const catalog = { id: "catalog", appId: "certreporter", domainRelease: "certreporter/v1", digest: "accepted", acceptedAt: "now", capabilities: [
    { id: "report.context", title: "Context", description: "", kind: "query" as const, inputSchema: {}, outputSchema: {} },
    { id: "report.update-master", title: "Update", description: "", kind: "command" as const, inputSchema: {}, outputSchema: {} },
    { id: "report.unallowed", title: "Unallowed", description: "", kind: "command" as const, inputSchema: {}, outputSchema: {} },
  ] };
  const grant = { ticket: "ticket", expiresAt: "2026-10-03T00:00:00.000Z", forgeUserId: "user", workId: "work", sessionId: "session", appToken: "secret", reportId: "report" };
  let nextId = 0;
  const useCases = new ForgeUseCases({
    sessions: { get: () => grant, claim: () => grant, put: () => {}, remove: () => {} },
    works: { activeWork: () => ({ id: "work" }), userForWork: () => "user", nextTurn: () => ({ id: "turn", workId: "work", sequence: 1, status: "running", omRevision: "head", catalogDigest: "accepted", contextDigest: "context", startedAt: "now" }), completeTurn: () => {} } as never,
    om: { head: () => "head", workDefinition: () => ({ schemaVersion: 1, id: "report-authoring", title: "Report", description: "", capabilities: { allowed: ["report.context", "report.update-master"] }, documents: [], knowledge: { bootstrap: [], available: [] }, completion: { mode: "user", requiredCapabilities: [] } }), knownKnowledge: () => new Set() } as never,
    catalogs: { accepted: () => catalog } as never,
    certReporter: {
      catalog: async () => catalog,
      reportContext: async () => ({ resource: { namespace: "certreporter", resourceType: "report", resourceId: "report", revision: "3" } }),
      submitCommand: async (_token: string, id: string, body: Record<string, unknown>) => { calls.push(id); assert.equal(body.expectedDomainRelease, "certreporter/v1"); return { status: "unknown" as const }; },
      receipt: async () => { calls.push("receipt"); return calls.filter((item) => item === "receipt").length > 1 ? { status: "committed" } : undefined; },
    } as never,
    agents: { runWork: async ({ tools }: { tools: Array<{ capability: { id: string }; invoke: (input: Record<string, unknown>) => Promise<unknown> }> }) => {
      assert.deepEqual(tools.map((tool) => tool.capability.id), ["report.context", "report.update-master"]);
      await assert.rejects(() => tools[1].invoke({ reportId: "other", expectedRevision: 3 }), /CommandTargetMismatch/);
      assert.deepEqual(await tools[1].invoke({ reportId: "report", expectedRevision: 3 }), { status: "unknown", commandId: "cmd_4" });
      await assert.rejects(() => tools[1].invoke({ reportId: "report", expectedRevision: 3 }), /UnresolvedCommandBlocksFurtherWrites/);
      return { text: "Result needs reconciliation" };
    } } as never,
    trajectories: { append: (event: { type: string; turnId?: string; payload: Record<string, unknown> }) => { events.push(event); }, read: () => events } as never,
    system: { id: (prefix) => `${prefix}_${++nextId}`, now: () => "2026-10-02T00:00:00.000Z", digest: () => "context" },
    accounts: {} as never, passwordSetups: {} as never, passwordCodec: {} as never, initialAdminEmails: new Set(),
  });
  await useCases.startTurn("ticket", "Update this report");
  assert.equal(calls.filter((item) => item === "report.update-master").length, 1);
  assert.equal(events.find((event) => event.type === "action" && event.payload.status === "unknown")?.payload.commandId, "cmd_4");
  const recovered = await useCases.recoverCommand("ticket", "cmd_4");
  assert.equal(recovered.status, "committed");
  assert.equal(calls.filter((item) => item === "report.update-master").length, 1);
});
