import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { GitOperatingModel } from "./git-om.js";
import { git } from "./personal-git-om.js";
import { validateWorkDefinition } from "@airic-forge/domain";

test("a missing Git working directory reports the launch failure rather than trimming undefined stderr", () => {
  const root = mkdtempSync(join(tmpdir(), "forge-git-missing-"));
  try {
    const om = new GitOperatingModel(join(root, "missing"), join(root, "data"), resolve("../../seed/certlab"));
    assert.throws(() => om.head("main"), /git rev-parse main failed: .*ENOENT/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("CertLab report-authoring seed resolves every declared document", () => {
  const root = mkdtempSync(join(tmpdir(), "airic-forge-git-"));
  try {
    const om = new GitOperatingModel(join(root, "project"), join(root, "data"), resolve(process.cwd(), "../../seed/certlab"));
    om.initialize();
    const revision = om.head("main");
    const definition = om.workDefinition(revision, "report-authoring");
    assert.deepEqual(validateWorkDefinition(definition, om.knownKnowledge(revision)), []);
    assert.equal(definition.documents.length, 5);
    for (const document of definition.documents) {
      assert.ok(om.document(revision, `work-definitions/report-authoring/${document.path}`).length > 0);
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("knowledge lookup reuses a commit index without hiding changed or duplicate identities", () => {
  const root = mkdtempSync(join(tmpdir(), "airic-forge-knowledge-index-"));
  class ObservedOm extends GitOperatingModel {
    knowledgeReads = 0;
    override document(revision: string, path: string): string {
      if (/^(subject-knowledge|precedents)\//.test(path)) this.knowledgeReads++;
      return super.document(revision, path);
    }
  }
  try {
    const om = new ObservedOm(join(root, "project"), join(root, "data"), resolve(process.cwd(), "../../seed/certlab"));
    om.initialize();
    const user = om.ensureUserBranch("index-owner");
    const save = (path: string, content: string, title: string) => {
      mkdirSync(resolve(user.worktree, path, ".."), { recursive: true });
      writeFileSync(join(user.worktree, path), content);
      git(user.worktree, ["add", "--", path]);
      git(user.worktree, ["commit", "-m", title]);
    };
    const path = "subject-knowledge/standards/example/clauses/12-2-3/precedent.md";
    const text = (id: string) => `---\nid: ${id}\ntitle: Example\nsummary: Fixed source\ntopics: [example]\n---\nHistorical example.\n`;
    save(path, text("example-clause"), "Add clause precedent");
    const first = om.head(user.branch);
    const known = om.knownKnowledge(first);
    const readsAfterIndex = om.knowledgeReads;
    for (let pass = 0; pass < 3; pass++) {
      for (const id of known) assert.ok(om.knowledgePath(first, id));
    }
    assert.equal(om.knowledgeReads, readsAfterIndex, "all IDs share one scan of the fixed commit");
    assert.equal(om.knowledgePath(user.branch, "example-clause"), path);

    save(path, text("renamed-clause"), "Rename candidate identity");
    const second = om.head(user.branch);
    assert.equal(om.knowledgePath(user.branch, "renamed-clause"), path);
    assert.throws(() => om.knowledgePath(second, "example-clause"), /KnowledgeIdentityNotUnique/);
    assert.equal(om.knowledgePath(first, "example-clause"), path, "old fixed sources remain readable");
    assert.throws(() => om.knowledgePath(first, "renamed-clause"), /KnowledgeIdentityNotUnique/);

    save("precedents/example/duplicate.md", text("renamed-clause"), "Create duplicate identity for validation");
    assert.throws(() => om.knowledgePath(user.branch, "renamed-clause"), /KnowledgeIdentityNotUnique/);
    assert.ok(om.knowledgeIssues(om.head(user.branch)).some(issue => /must be unique/.test(issue.message)));
  } finally { rmSync(root, { recursive: true, force: true }); }
});
