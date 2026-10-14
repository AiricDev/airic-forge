import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync, mkdirSync, symlinkSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { GitOperatingModel } from "./git-om.js";

const seed = resolve(process.cwd(), "../../seed/certlab");
const knowledge = (id: string) => `---\nid: ${id}\ntitle: Source scope\nsummary: Preserve original revision and limitations.\ntopics: [evidence]\nreview_state: candidate\n---\n\nSynthetic candidate, not professional verification.\n`;

test("nested candidate registration uses stable IDs, reviews tracked precedents and shares only selected paths", () => {
  const root = mkdtempSync(join(tmpdir(), "forge-nested-learning-"));
  try {
    const om = new GitOperatingModel(join(root, "project"), join(root, "data"), seed);
    om.initialize();
    const user = om.ensureUserBranch("author");
    const base = om.head(user.branch);
    const candidate = om.createProposal("author", "nested", base);
    const path = "subject-knowledge/standards/alpha/2026/clauses/1/interpretation.md";
    const precedent = "precedents/alpha/2026/source-scope.md";
    const navigation = "subject-knowledge/standards/alpha/README.md";
    om.writeProposalFile(candidate.worktree, path, knowledge("alpha-2026-clause-1"));
    om.writeProposalFile(candidate.worktree, precedent, knowledge("precedent-alpha-source-scope"));
    om.writeProposalFile(candidate.worktree, navigation, "# Navigation\n\nCandidate paths are not approved rules.\n");
    om.makeKnowledgeAvailable(candidate.worktree, "report-authoring", [path, precedent, navigation]);
    om.commitProposal(candidate.worktree, "Review nested learning");
    const revision = om.head(candidate.branch);
    assert.deepEqual(om.knowledgeIssues(revision), []);
    assert(om.workDefinition(revision, "report-authoring").knowledge.available.includes("alpha-2026-clause-1"));
    assert(!om.workDefinition(revision, "report-authoring").knowledge.available.includes("interpretation"));
    assert(!om.workDefinition(revision, "report-authoring").knowledge.available.includes("README"));
    assert.equal(om.knowledgePath(revision, "alpha-2026-clause-1"), path);
    assert.match(om.proposalDiff(candidate.worktree, base), /precedents\/alpha\/2026\/source-scope.md/);
    assert.equal(om.head(user.branch), base);
    const adopted = om.adoptProposal(user.branch, user.worktree, candidate.branch, base, {});
    assert(om.divergence(adopted, base).changedPaths.includes(precedent));
    const contribution = om.prepareContribution("share", adopted, base, base, [path, precedent, "work-definitions/report-authoring/work.yml"], "Share selected candidate only");
    const main = om.acceptContribution(contribution.branch, base);
    assert.equal(om.knowledgePath(main, "precedent-alpha-source-scope"), precedent);
    assert.equal(om.head(user.branch), adopted);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("candidate files and their parent directories cannot redirect reads or writes through symlinks", () => {
  const root = mkdtempSync(join(tmpdir(), "forge-proposal-links-"));
  try {
    const om = new GitOperatingModel(join(root, "project"), join(root, "data"), seed);
    om.initialize();
    const candidate = om.createProposal("author", "links", om.head("main"));
    const outside = join(root, "outside");
    mkdirSync(outside);
    writeFileSync(join(outside, "private.md"), "Unchanged private source");
    symlinkSync(outside, join(candidate.worktree, "subject-knowledge/standards"));
    assert.throws(() => om.writeProposalFile(candidate.worktree, "subject-knowledge/standards/private.md", "Changed"), /ProposalPathNotAllowed/);
    assert.throws(() => om.proposalFile(candidate.worktree, "subject-knowledge/standards/private.md"), /ProposalPathNotAllowed/);
    symlinkSync(join(outside, "private.md"), join(candidate.worktree, "subject-knowledge/linked.md"));
    assert.throws(() => om.makeKnowledgeAvailable(candidate.worktree, "report-authoring", ["subject-knowledge/linked.md"]), /ProposalPathNotAllowed/);
    assert.equal(readFileSync(join(outside, "private.md"), "utf8"), "Unchanged private source");
  } finally { rmSync(root, { recursive: true, force: true }); }
});
