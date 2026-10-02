import assert from "node:assert/strict";
import test from "node:test";
import { ForgeUseCases } from "./use-cases.js";
import type { AppSessionPort, SessionGrant } from "./ports.js";

test("expired ACP grants are removed before any app capability can be used", async () => {
  const grants = new Map<string, SessionGrant>([["expired", { ticket: "expired", expiresAt: "2020-01-01T00:00:00.000Z", forgeUserId: "u", workId: "w", sessionId: "s", appToken: "secret", reportId: "r" }]]);
  const sessions: AppSessionPort = { put: (grant) => { grants.set(grant.ticket, grant); }, get: (ticket) => grants.get(ticket), remove: (ticket) => { grants.delete(ticket); } };
  const useCases = new ForgeUseCases({
    sessions,
    system: { id: () => "id", digest: () => "digest", now: () => "2026-10-02T00:00:00.000Z" },
    initialAdminEmails: new Set(),
    accounts: {} as never, works: {} as never, om: {} as never, certReporter: {} as never, trajectories: {} as never,
  });
  await assert.rejects(() => useCases.appSession("expired"), /AppSessionExpired/);
  assert.equal(grants.has("expired"), false);
});
