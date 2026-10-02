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
    catalogs: { saveCandidate: () => { imported = true; }, candidate: () => imported ? candidate : undefined, accept: () => { accepted = true; }, accepted: () => undefined },
    works: {} as never, om: {} as never, agents: {} as never, passwordSetups: {} as never, passwordCodec: {} as never, trajectories: {} as never,
    system: { id: () => "id", digest: () => "digest", now: () => "2026-10-02T00:00:00.000Z" }, initialAdminEmails: new Set(),
  });
  await assert.rejects(() => useCases.importCatalog("user"), /Forbidden/);
  assert.equal(imported, false);
  await useCases.importCatalog("admin");
  assert.equal(imported, true);
  await useCases.acceptCatalog("admin", "digest-1");
  assert.equal(accepted, true);
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
