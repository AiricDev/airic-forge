import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { GitOperatingModel } from "./git-om.js";
import { validateWorkDefinition, isAllowedOmDocumentPath, isAllowedProposalPath } from "@airic-forge/domain";
import { initialCapabilityIds } from "./certlab-test-catalog.js";

const initialOm = resolve("../../../certlab/.airic");
test("authorized initial assessment OM resolves nested IDs at a fixed HEAD without importing design", { skip: !existsSync(initialOm) }, () => {
  const root = mkdtempSync(join(tmpdir(), "forge-initial-om-"));
  const original = readFileSync(join(initialOm, "work-definitions/certification-assessment/work.yml"));
  try {
    const om = new GitOperatingModel(join(root, "project"), join(root, "data"), initialOm);
    om.initialize();
    const head = om.head("main");
    const wd = om.workDefinition(head, "certification-assessment");
    assert.deepEqual(om.knowledgeIssues(head), []);
    assert.deepEqual(validateWorkDefinition(wd, new Set(initialCapabilityIds), om.knownKnowledge(head)), []);
    for (const id of [...wd.knowledge.bootstrap, ...wd.knowledge.available]) {
      const path = om.knowledgePath(head, id);
      assert.match(om.document(head, path), new RegExp(`id: ${id}`));
    }
    assert.equal(om.knowledgePath(head, "semi-s2-0724-clause-12-2-3"), "subject-knowledge/standards/semi-s2/0724/clauses/12-2-3/interpretation.md");
    assert.match(om.knowledgePath(head, "precedent-semi-s2-0724-emo-circuit"), /^precedents\//);
    assert(!existsSync(join(root, "project/design")));
    assert(!existsSync(join(root, "project/README.md")));
    assert.throws(() => om.document(head, "design/source-inventory.json"), /invalid OM document/);
    assert.throws(() => om.document(head, "subject-knowledge/../../README.md"), /invalid OM document/);
    assert.throws(() => om.knowledgePath(head, "not-a-known-id"), /KnowledgeIdentityNotUnique/);
    assert.deepEqual(readFileSync(join(initialOm, "work-definitions/certification-assessment/work.yml")), original);
    assert.equal(om.head("main"), head);
    // B5 explicitly governs nested proposal paths; lens/author/review still control writes.
    assert(isAllowedOmDocumentPath("precedents/semi-s2/0724/emo-circuit.md"));
    assert(isAllowedProposalPath("precedents/semi-s2/0724/emo-circuit.md"));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("seed symlinks and source/runtime overlap are rejected before importing files", () => {
  const root = mkdtempSync(join(tmpdir(), "forge-unsafe-seed-"));
  try {
    const seed = join(root, "seed");
    mkdirSync(join(seed, "subject-knowledge"), { recursive: true });
    writeFileSync(join(root, "private.md"), "not authorized");
    symlinkSync(join(root, "private.md"), join(seed, "subject-knowledge/linked.md"));
    const om = new GitOperatingModel(join(root, "project"), join(root, "data"), seed);
    assert.throws(() => om.initialize(), /OmSeedSymlinkNotAllowed/);
    assert(!existsSync(join(root, "project/subject-knowledge/linked.md")));
    assert.throws(() => new GitOperatingModel(seed, join(root, "data"), seed).initialize(), /OmSeedRuntimeOverlap/);
    assert(!existsSync(join(seed, ".git")));
  } finally { rmSync(root, { recursive: true, force: true }); }
});
