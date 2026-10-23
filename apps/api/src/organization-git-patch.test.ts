import assert from "node:assert/strict";
import test from "node:test";
import { omFixture } from "./om-test-fixture.js";
import { createTestOmCommit } from "./om-commit-fixture.js";
import { git } from "./personal-git-om.js";

const policy = "work-definitions/report-authoring/policy.md";
const method = "work-definitions/report-authoring/method.md";

test("selective acceptance removes identical content but not unaccepted changes from the next comparison", async () => {
  const f = omFixture();
  try {
    const initial = f.runtime.om.head("main");
    const author = await createTestOmCommit(f.runtime, f.owner.id, [
      { path: policy, content: f.runtime.om.document(initial, policy) + "\nShared policy.\n" },
      { path: method, content: f.runtime.om.document(initial, method) + "\nPrivate method.\n" },
    ], "Personal improvements");
    const record = await f.runtime.useCases.createOrganizationContribution(f.admin.id, f.owner.id, "Share only policy", "");
    const reviewed = await f.runtime.useCases.reviewOrganizationContribution(f.admin.id, record.id, [policy]);
    await f.runtime.useCases.acceptOrganizationContribution(f.admin.id, record.id, reviewed.reviewedRevision!);
    const comparison = await f.runtime.useCases.compareOrganizationSource(f.admin.id, f.owner.id);
    assert.equal(comparison.baseRevision, initial);
    assert.deepEqual(comparison.changedPaths, [method]);
    assert(!comparison.diff.includes(`a/${policy}`));
    assert.match(comparison.diff, /Private method/);
    assert.equal(f.runtime.om.head(`users/${f.owner.id}`), author.revision);
    const remaining = await f.runtime.useCases.createOrganizationContribution(f.admin.id, f.owner.id, "Share remaining method", "");
    const next = await f.runtime.useCases.reviewOrganizationContribution(f.admin.id, remaining.id, [method]);
    await f.runtime.useCases.acceptOrganizationContribution(f.admin.id, remaining.id, next.reviewedRevision!);
    assert.deepEqual((await f.runtime.useCases.compareOrganizationSource(f.admin.id, f.owner.id)).changedPaths, []);
    await assert.rejects(() => f.runtime.useCases.createOrganizationContribution(f.admin.id, f.owner.id, "Already shared", ""), /NoOrganizationChanges/);
    assert.deepEqual((await f.runtime.useCases.compareOrganizationSource(f.admin.id, f.other.id)).changedPaths, [], "organization-only updates must not be offered for reversal");
  } finally { await f.close(); }
});

test("document reads and selected Git patches preserve exact bytes, additions and deletions", async () => {
  const f = omFixture();
  try {
    const added = "work-definitions/report-authoring/shared-formatting.md";
    const deleted = "subject-knowledge/README.md";
    const content = "\n  # Leading spaces\r\n\tIndented text\r\n\r\n";
    const author = await createTestOmCommit(f.runtime, f.owner.id, [
      { path: policy, content },
      { path: deleted, content: null },
      { path: added, content: "A new selected file.\n\n" },
    ], "Preserve original documents");
    assert.equal(f.runtime.om.document(author.revision, policy), content);
    const record = await f.runtime.useCases.createOrganizationContribution(f.admin.id, f.owner.id, "Share selected documents exactly", "");
    const reviewed = await f.runtime.useCases.reviewOrganizationContribution(f.admin.id, record.id, [policy, deleted, added]);
    assert.equal(f.runtime.om.document(reviewed.reviewedRevision!, policy), content);
    assert.equal(f.runtime.om.document(reviewed.reviewedRevision!, added), "A new selected file.\n\n");
    assert(!f.runtime.om.listFiles(reviewed.reviewedRevision!).includes(deleted));
    for (const path of [policy, added]) {
      assert.equal(git(f.config.projectDir, ["rev-parse", `${reviewed.reviewedRevision}:${path}`]), git(f.config.projectDir, ["rev-parse", `${author.revision}:${path}`]));
    }
    assert.equal(f.runtime.om.head("main"), record.baseMainRevision);
    assert.equal(f.runtime.om.head(`users/${f.owner.id}`), author.revision);
  } finally { await f.close(); }
});

for (const conflict of [false, true]) {
  test(`Git three-way contribution ${conflict ? "rejects overlapping" : "merges independent"} changes without changing active branches`, async () => {
    const f = omFixture();
    try {
      const initial = f.runtime.om.head("main");
      const original = f.runtime.om.document(initial, policy);
      const author = await createTestOmCommit(f.runtime, f.owner.id, [{ path: policy, content: original.replace(/^.*$/m, "Personal policy heading.") }], "Personal policy change");
      await createTestOmCommit(f.runtime, f.other.id, [{ path: policy, content: conflict ? original.replace(/^.*$/m, "Organization policy heading.") : original + "\nIndependent organization ending.\n" }], "Organization policy change");
      const organizationRecord = await f.runtime.useCases.createOrganizationContribution(f.admin.id, f.other.id, "Publish organization policy", "");
      const organizationReview = await f.runtime.useCases.reviewOrganizationContribution(f.admin.id, organizationRecord.id, [policy]);
      const organization = await f.runtime.useCases.acceptOrganizationContribution(f.admin.id, organizationRecord.id, organizationReview.reviewedRevision!);
      const record = await f.runtime.useCases.createOrganizationContribution(f.admin.id, f.owner.id, "Share personal policy", "");
      const beforeRefs = git(f.config.projectDir, ["for-each-ref", "--format=%(refname) %(objectname)"]);
      if (conflict) {
        await assert.rejects(() => f.runtime.useCases.reviewOrganizationContribution(f.admin.id, record.id, [policy]), /OrganizationPathConflict/);
        assert.equal(f.runtime.organization.contribution(record.id)!.status, "open");
        assert.equal(git(f.config.projectDir, ["for-each-ref", "--format=%(refname) %(objectname)"]), beforeRefs);
      } else {
        const reviewed = await f.runtime.useCases.reviewOrganizationContribution(f.admin.id, record.id, [policy]);
        const merged = f.runtime.om.document(reviewed.reviewedRevision!, policy);
        assert.match(merged, /Personal policy heading/);
        assert.match(merged, /Independent organization ending/);
        assert.equal(f.runtime.om.document(reviewed.reviewedRevision!, method), f.runtime.om.document(organization.revision, method));
        assert.equal(git(f.config.projectDir, ["rev-parse", `${reviewed.reviewedRevision}^`]), record.reviewedRevision);
      }
      assert.equal(f.runtime.om.head("main"), organization.revision);
      assert.equal(f.runtime.om.head(`users/${f.owner.id}`), author.revision);
    } finally { await f.close(); }
  });
}
