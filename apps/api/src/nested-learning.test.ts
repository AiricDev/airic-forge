import assert from "node:assert/strict";
import test from "node:test";
import { mkdirSync, symlinkSync, writeFileSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { omFixture } from "./om-test-fixture.js";

const knowledge = (id: string) => `---\nid: ${id}\ntitle: Source scope\nsummary: Preserve original revision and limitations.\ntopics: [evidence]\nreview_state: candidate\n---\n\nSynthetic candidate, not professional verification.\n`;

test("nested learning uses stable IDs and shares only explicitly selected paths", async () => {
  const f = omFixture();
  try {
    const { om } = f.runtime;
    const base = om.head(`users/${f.owner.id}`);
    const path = "subject-knowledge/standards/alpha/2026/clauses/1/interpretation.md";
    const precedent = "precedents/alpha/2026/source-scope.md";
    const navigation = "subject-knowledge/standards/alpha/README.md";
    const edits = f.runtime.omChanges.routeKnowledge(base, [
      { path, content: knowledge("alpha-2026-clause-1") },
      { path: precedent, content: knowledge("precedent-alpha-source-scope") },
      { path: navigation, content: "# Navigation\n\nCandidate paths are not approved rules.\n" },
    ], "report-authoring");
    const draft = await f.runtime.omChanges.save(f.owner.id, "manual", { baseRevision: base, edits, summary: "Preserve source scope" });
    assert.equal(om.head(`users/${f.owner.id}`), base);
    const { revision } = await f.runtime.omChanges.commit(f.owner.id, "manual", draft.digest, "nested-learning-commit");
    assert.deepEqual(om.knowledgeIssues(revision), []);
    const ids = om.workDefinition(revision, "report-authoring").knowledge.available;
    assert(ids.includes("alpha-2026-clause-1"));
    assert(!ids.includes("interpretation") && !ids.includes("README"));
    assert.equal(om.knowledgePath(revision, "alpha-2026-clause-1"), path);
    const contribution = await f.runtime.useCases.createOrganizationContribution(f.admin.id, f.owner.id, "Share source scope", "");
    const selection = await f.runtime.useCases.reviewOrganizationContribution(f.admin.id, contribution.id, [path, precedent, "work-definitions/report-authoring/work.yml"]);
    const accepted = await f.runtime.useCases.acceptOrganizationContribution(f.admin.id, contribution.id, selection.reviewedRevision!);
    assert.equal(om.knowledgePath(accepted.revision, "precedent-alpha-source-scope"), precedent);
    assert(!om.listFiles(accepted.revision).includes(navigation));
    assert.equal(om.head(`users/${f.owner.id}`), revision);
  } finally { await f.close(); }
});

test("draft symlinks cannot redirect candidate reads or writes", async () => {
  const f = omFixture();
  try {
    await f.save(f.owner.id, "manual", "subject-knowledge/example.md", knowledge("example"));
    const directory = f.runtime.drafts.directory(f.owner.id, "manual");
    const outside = join(f.root, "outside");
    mkdirSync(outside);
    writeFileSync(join(outside, "private.md"), "Unchanged private source");
    const tracked = "subject-knowledge/example.md";
    unlinkSync(join(directory, tracked));
    symlinkSync(join(outside, "private.md"), join(directory, tracked));
    await assert.rejects(() => f.save(f.owner.id, "manual", tracked, "Changed"), /OmDraftSymlinkNotAllowed/);
    assert.throws(() => f.runtime.drafts.workspace(f.owner.id, "manual"), /OmDraftSymlinkNotAllowed/);
    unlinkSync(join(directory, tracked));
    writeFileSync(join(directory, tracked), knowledge("example"));
    symlinkSync(outside, join(directory, "subject-knowledge/standards"));
    await assert.rejects(() => f.save(f.owner.id, "manual", "subject-knowledge/standards/private.md", "Changed"), /OmPathNotAllowed/);
    assert.equal(readFileSync(join(outside, "private.md"), "utf8"), "Unchanged private source");
  } finally { await f.close(); }
});
