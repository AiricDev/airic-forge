import assert from "node:assert/strict";
import test from "node:test";
import { ForgeUseCases } from "./use-cases.js";
import type { OrganizationContribution, OrganizationContributionPort } from "./ports.js";

const record: OrganizationContribution = { id: "con-test", authorUserId: "author", sourceRevision: "source", baseMainRevision: "main-base", reason: "Share policy", evidence: "", status: "open", selectedPaths: ["work-definitions/document-task/policy.md"], candidateBranch: "contributions/con-test", reviewedRevision: "candidate", selectionRevision: "candidate", createdAt: "now" };
function fixture(overrides: Partial<OrganizationContribution> = {}) {
  let accepted = 0;
  const current = { ...record, ...overrides };
  const organization: OrganizationContributionPort = {
    contribution: () => current, contributions: () => [current], createContribution: () => {}, saveSelection: () => {}, abandonContribution: () => {},
  };
  const useCases = new ForgeUseCases({
    accounts: { userById: (id: string) => ({ id, status: "active", version: 0, role: id === "admin" ? "admin" : "user" }) } as never,
    organization,
    om: { head: (branch: string) => branch === "main" ? "main-base" : "candidate", acceptContribution: () => { accepted++; return "merge"; }, knowledgeIssues: () => [], knownKnowledge: () => new Set(), listFiles: () => [] } as never,
    toolSnapshots: {} as never,
    works: {} as never, app: {} as never, agents: {} as never, sessions: {} as never, passwordSetups: {} as never, passwordCodec: {} as never, trajectories: {} as never, system: {} as never, });
  return { useCases, accepted: () => accepted };
}

test("only an administrator can merge a current selected contribution", async () => {
  const f = fixture();
  await assert.rejects(() => f.useCases.acceptOrganizationContribution("member", record.id, "candidate"), /Forbidden/);
  await assert.rejects(() => f.useCases.acceptOrganizationContribution("admin", record.id, "previous-candidate"), /ContributionReviewRequired/);
  assert.equal(f.accepted(), 0);
  assert.deepEqual(await f.useCases.acceptOrganizationContribution("admin", record.id, "candidate"), { revision: "merge" });
  assert.equal(f.accepted(), 1);
});

test("a changed branch requires selection again and a stale base cannot merge", async () => {
  const changed = fixture({ selectionRevision: undefined });
  await assert.rejects(() => changed.useCases.acceptOrganizationContribution("admin", record.id, "candidate"), /ContributionSelectionRequired/);
  assert.equal(changed.accepted(), 0);
  const stale = fixture({ baseMainRevision: "old-main" });
  await assert.rejects(() => stale.useCases.acceptOrganizationContribution("admin", record.id, "candidate"), /OrganizationReviewStale/);
  assert.equal(stale.accepted(), 0);
});

test("a contribution already contained in main is idempotently accepted without another merge", async () => {
  const f = fixture({ status: "accepted", acceptedRevision: "existing-merge" });
  assert.deepEqual(await f.useCases.acceptOrganizationContribution("admin", record.id, "candidate"), { revision: "existing-merge" });
  assert.equal(f.accepted(), 0);
});
