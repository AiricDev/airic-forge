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
    accounts: {} as never, works: {} as never, om: {} as never, certReporter: {} as never, trajectories: {} as never,
  });
  await assert.rejects(() => useCases.appSession("expired"), /AppSessionExpired/);
  assert.equal(grants.has("expired"), false);
});

test("bootstrap validates the authoritative report before creating a Forge account or Work", async () => {
  let writes = 0;
  const useCases = new ForgeUseCases({
    certReporter: { identity: async () => ({ appId: "certreporter", appUserId: "a", email: "a@example.com", displayName: "A" }), reportContext: async () => ({ resource: { namespace: "certreporter", resourceType: "report", resourceId: "other-report" } }), catalog: async () => { throw new Error("unused"); } },
    accounts: { ensureUser: () => { writes++; throw new Error("must not create user"); } } as never,
    works: { createWork: () => { writes++; throw new Error("must not create Work"); } } as never,
    om: {} as never, sessions: {} as never, passwordSetups: {} as never, passwordCodec: {} as never, trajectories: {} as never,
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
    },
    accounts: {
      linkedUserId: () => "forge-alice",
      userByEmail: () => ({ id: "forge-bob", email: "bob@example.com", role: "user", activeBranch: "users/forge-bob", createdAt: "2026-10-02T00:00:00.000Z", passwordConfigured: true }),
      ensureUser: () => { writes++; throw new Error("must not create user"); },
    } as never,
    works: { createWork: () => { writes++; throw new Error("must not create Work"); } } as never,
    om: {} as never, sessions: {} as never, passwordSetups: {} as never, passwordCodec: {} as never, trajectories: {} as never,
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
    accounts: {} as never, om: {} as never, certReporter: {} as never, passwordSetups: {} as never, passwordCodec: {} as never, trajectories: {} as never,
    system: { id: () => "id", digest: () => "digest", now: () => "2026-10-02T00:00:00.000Z" }, initialAdminEmails: new Set(),
  });
  await assert.rejects(() => useCases.completeWork("grant", "other-work"), /WorkNotOwned/);
  assert.equal(completed, false);
});
