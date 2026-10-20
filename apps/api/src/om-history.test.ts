import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { git, PersonalGitOperatingModel } from "./personal-git-om.js";

for (const legacyRelease of [false, true]) {
  test(`OM commits and organization acceptance use commit history without creating releases (legacy release: ${legacyRelease})`, () => {
    const root = mkdtempSync(join(tmpdir(), "forge-om-history-"));
    try {
      const om = new PersonalGitOperatingModel(join(root, "project"), join(root, "data"), resolve("../../seed/project"));
      om.initialize();
      const user = om.ensureUserBranch("history-owner");
      const base = om.head("main");
      const initialEntry = om.history("main")[0];
      if (legacyRelease) git(om.projectDir, ["branch", "releases/existing-snapshot", base]);
      const branches = () => git(om.projectDir, ["for-each-ref", "--format=%(refname:short)", "refs/heads/"]).split("\n").sort();
      const initialBranches = branches();
      const path = "work-definitions/report-authoring/policy.md";
      let content = om.document(base, path);
      const versions: Array<{ revision: string; subject: string }> = [];
      for (const subject of ["Clarify report policy", "Refine report policy"]) {
        const previous = om.head(user.branch);
        content += `\n${subject}.\n`;
        const revision = om.prepareOmCommit({
          ownerUserId: "history-owner", baseRevision: previous,
          edits: [{ path, content }], summary: subject,
          trailers: { "AiricForge-Source": "history-regression" },
        });
        assert.equal(om.publishOmCommit("history-owner", previous, revision), revision);
        assert.deepEqual(branches(), initialBranches);
        versions.unshift({ revision, subject });
      }
      assert.deepEqual(
        om.history(user.branch).map(({ revision, subject }) => ({ revision, subject })),
        [...versions, { revision: base, subject: initialEntry.subject }],
      );
      assert.equal(om.document(base, path).includes("Refine report policy."), false);
      assert.match(om.document(versions[1].revision, path), /Clarify report policy/);
      const candidate = om.prepareContribution(
        "history-review", versions[0].revision, base, base, [path],
        "Accept reviewed report policy\n\nOnly selected changes enter the organization OM.",
      );
      assert.equal(om.acceptContribution(candidate.branch, base), candidate.revision);
      assert.deepEqual(branches(), [...initialBranches, candidate.branch].sort());
      assert.deepEqual(
        om.history("main").map(({ revision, subject }) => ({ revision, subject })),
        [{ revision: candidate.revision, subject: "Accept reviewed report policy" }, { revision: base, subject: initialEntry.subject }],
      );
      assert.equal(om.document(candidate.revision, path), content);
      assert.deepEqual(
        git(om.projectDir, ["for-each-ref", "--format=%(refname:short) %(objectname)", "refs/heads/releases/"]),
        legacyRelease ? `releases/existing-snapshot ${base}` : "",
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}
