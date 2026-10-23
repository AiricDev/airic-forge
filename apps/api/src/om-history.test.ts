import assert from "node:assert/strict";
import test from "node:test";
import { git } from "./personal-git-om.js";
import { createTestOmCommit } from "./om-commit-fixture.js";
import { omFixture } from "./om-test-fixture.js";

test("personal and organization versions retain commit history without auxiliary release branches", async () => {
  const f = omFixture();
  try {
    const om = f.runtime.om;
    const branch = `users/${f.owner.id}`;
    const base = om.head("main");
    const initialEntry = om.history("main")[0];
    const path = "work-definitions/document-task/policy.md";
    let content = om.document(base, path);
    const versions: Array<{ revision: string; subject: string }> = [];
    for (const subject of ["Clarify report policy", "Refine report policy"]) {
      content += `\n${subject}.\n`;
      const committed = await createTestOmCommit(f.runtime, f.owner.id, [{ path, content }], subject);
      versions.unshift({ revision: committed.revision, subject });
    }
    assert.deepEqual(om.history(branch).map(({ revision, subject }) => ({ revision, subject })), [...versions, { revision: base, subject: initialEntry.subject }]);
    assert.equal(om.document(base, path).includes("Refine report policy."), false);
    assert.match(om.document(versions[1].revision, path), /Clarify report policy/);
    const contribution = await f.runtime.useCases.createOrganizationContribution(f.admin.id, f.owner.id, "Share policy", "");
    const selected = await f.runtime.useCases.reviewOrganizationContribution(f.admin.id, contribution.id, [path]);
    const accepted = await f.runtime.useCases.acceptOrganizationContribution(f.admin.id, contribution.id, selected.reviewedRevision!);
    assert(om.includesRevision(accepted.revision, selected.reviewedRevision!));
    assert.equal(om.document(selected.reviewedRevision!, path), content);
    assert.equal(git(om.projectDir, ["for-each-ref", "--format=%(refname:short)", "refs/heads/releases/"]), "");
  } finally { await f.close(); }
});
