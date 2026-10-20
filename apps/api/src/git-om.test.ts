import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { GitOperatingModel } from "./git-om.js";
import { validateWorkDefinition } from "@airic-forge/domain";

test("a missing Git working directory reports the launch failure rather than trimming undefined stderr", () => {
  const root = mkdtempSync(join(tmpdir(), "forge-git-missing-"));
  try {
    const om = new GitOperatingModel(join(root, "missing"), join(root, "data"), resolve("../../seed/project"));
    assert.throws(() => om.head("main"), /git rev-parse main failed: .*ENOENT/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("a proposal is based on active HEAD and adoption creates a new active revision", () => {
  const root = mkdtempSync(join(tmpdir(), "airic-forge-git-"));
  try {
    const om = new GitOperatingModel(join(root, "project"), join(root, "data"), resolve(process.cwd(), "../../seed/project"));
    om.initialize();
    const user = om.ensureUserBranch("user-1");
    const base = om.head(user.branch);
    const proposal = om.createProposal("user-1", "proposal-1", base);
    const policyPath = "work-definitions/report-authoring/policy.md";
    om.writeProposalFile(proposal.worktree, policyPath, `${readFileSync(join(proposal.worktree, policyPath), "utf8")}\n\nA new governed rule.\n`);
    om.commitProposal(proposal.worktree, "Add governed rule");
    const active = om.adoptProposal(user.branch, user.worktree, proposal.branch, base, { "AiricForge-Proposal": "proposal-1" });
    assert.notEqual(active, base);
    assert.match(om.document(active, policyPath), /A new governed rule/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("migrated report-authoring package resolves every declared document", () => {
  const root = mkdtempSync(join(tmpdir(), "airic-forge-git-"));
  try {
    const om = new GitOperatingModel(join(root, "project"), join(root, "data"), resolve(process.cwd(), "../../seed/project"));
    om.initialize();
    const revision = om.head("main");
    const definition = om.workDefinition(revision, "report-authoring");
    const knownCapabilities = new Set(["report.context", "report.read", "report.gaps", "report.update-master", "report.update-data"]);
    assert.deepEqual(validateWorkDefinition(definition, knownCapabilities, om.knownKnowledge(revision)), []);
    assert.equal(definition.documents.length, 5);
    for (const document of definition.documents) {
      assert.ok(om.document(revision, `work-definitions/report-authoring/${document.path}`).length > 0);
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("proposal work.yml edits are visible before commit", () => {
  const root = mkdtempSync(join(tmpdir(), "airic-forge-git-"));
  try {
    const om = new GitOperatingModel(join(root, "project"), join(root, "data"), resolve(process.cwd(), "../../seed/project"));
    om.initialize();
    const user = om.ensureUserBranch("user-1");
    const proposal = om.createProposal("user-1", "proposal-yml", om.head(user.branch));
    const path = "work-definitions/report-authoring/work.yml";
    om.writeProposalFile(proposal.worktree, path, readFileSync(join(proposal.worktree, path), "utf8") + "\n# Reviewed change\n");
    assert.deepEqual(om.proposalChanges(proposal.worktree), [path]);
    assert.throws(() => om.writeProposalFile(proposal.worktree, "../outside.md", "bad"), /ProposalPathNotAllowed/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("candidate Subject Knowledge without front matter is rejected", () => {
  const root = mkdtempSync(join(tmpdir(), "airic-forge-git-"));
  try {
    const om = new GitOperatingModel(join(root, "project"), join(root, "data"), resolve(process.cwd(), "../../seed/project"));
    om.initialize();
    const user = om.ensureUserBranch("user-1");
    const proposal = om.createProposal("user-1", "proposal-sk", om.head(user.branch));
    om.writeProposalFile(proposal.worktree, "subject-knowledge/test.md", "# Missing metadata");
    om.commitProposal(proposal.worktree, "Add candidate knowledge");
    assert.match(om.knowledgeIssues(om.head(proposal.branch))[0]?.message ?? "", /front matter/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("a second Proposal cannot merge after active HEAD advances", () => {
  const root = mkdtempSync(join(tmpdir(), "airic-forge-git-"));
  try {
    const om = new GitOperatingModel(join(root, "project"), join(root, "data"), resolve(process.cwd(), "../../seed/project"));
    om.initialize();
    const user = om.ensureUserBranch("user-1");
    const base = om.head(user.branch);
    const first = om.createProposal("user-1", "first", base);
    const second = om.createProposal("user-1", "second", base);
    const path = "work-definitions/report-authoring/policy.md";
    om.writeProposalFile(first.worktree, path, readFileSync(join(first.worktree, path), "utf8") + "\nFirst change.\n");
    om.writeProposalFile(second.worktree, path, readFileSync(join(second.worktree, path), "utf8") + "\nSecond change.\n");
    om.commitProposal(first.worktree, "First change");
    om.commitProposal(second.worktree, "Second change");
    om.adoptProposal(user.branch, user.worktree, first.branch, base, {});
    assert.throws(() => om.adoptProposal(user.branch, user.worktree, second.branch, base, {}), /ActiveRevisionChanged/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("a conflicting Proposal rebase keeps conflict text for manual resolution", () => {
  const root = mkdtempSync(join(tmpdir(), "airic-forge-rebase-"));
  try {
    const om = new GitOperatingModel(join(root, "project"), join(root, "data"), resolve(process.cwd(), "../../seed/project"));
    om.initialize();
    const user = om.ensureUserBranch("user-1");
    const base = om.head(user.branch);
    const first = om.createProposal("user-1", "conflict-first", base);
    const second = om.createProposal("user-1", "conflict-second", base);
    const path = "work-definitions/report-authoring/policy.md";
    const original = om.proposalFile(first.worktree, path);
    om.writeProposalFile(first.worktree, path, `${original}\nFirst rule.\n`);
    om.writeProposalFile(second.worktree, path, `${original}\nSecond rule.\n`);
    om.commitProposal(first.worktree, "First rule");
    om.commitProposal(second.worktree, "Second rule");
    const active = om.adoptProposal(user.branch, user.worktree, first.branch, base, {});
    assert.throws(() => om.rebaseProposal(second.worktree, base, active), /ProposalRebaseConflict/);
    assert.deepEqual(om.proposalConflicts(second.worktree), [path]);
    assert.match(om.proposalFile(second.worktree, path), /<<<<<<< /);
    om.writeProposalFile(second.worktree, path, `${om.document(active, path)}\nSecond rule.\n`);
    om.rebaseProposal(second.worktree, base, active);
    assert.deepEqual(om.proposalConflicts(second.worktree), []);
    const adopted = om.adoptProposal(user.branch, user.worktree, second.branch, active, {});
    assert.match(om.document(adopted, path), /First rule/);
    assert.match(om.document(adopted, path), /Second rule/);
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
    const om = new ObservedOm(join(root, "project"), join(root, "data"), resolve(process.cwd(), "../../seed/project"));
    om.initialize();
    const user = om.ensureUserBranch("index-owner");
    const proposal = om.createProposal("index-owner", "knowledge-index", om.head(user.branch));
    const path = "subject-knowledge/standards/example/clauses/12-2-3/precedent.md";
    const text = (id: string) => `---\nid: ${id}\ntitle: Example\nsummary: Fixed source\ntopics: [example]\n---\nHistorical example.\n`;
    om.writeProposalFile(proposal.worktree, path, text("example-clause"));
    om.commitProposal(proposal.worktree, "Add clause precedent");
    const first = om.head(proposal.branch);
    const known = om.knownKnowledge(first);
    const readsAfterIndex = om.knowledgeReads;
    for (let pass = 0; pass < 3; pass++) {
      for (const id of known) assert.ok(om.knowledgePath(first, id));
    }
    assert.equal(om.knowledgeReads, readsAfterIndex, "all IDs share one scan of the fixed commit");
    assert.equal(om.knowledgePath(proposal.branch, "example-clause"), path);

    om.writeProposalFile(proposal.worktree, path, text("renamed-clause"));
    om.commitProposal(proposal.worktree, "Rename candidate identity");
    const second = om.head(proposal.branch);
    assert.equal(om.knowledgePath(proposal.branch, "renamed-clause"), path);
    assert.throws(() => om.knowledgePath(second, "example-clause"), /KnowledgeIdentityNotUnique/);
    assert.equal(om.knowledgePath(first, "example-clause"), path, "old fixed sources remain readable");
    assert.throws(() => om.knowledgePath(first, "renamed-clause"), /KnowledgeIdentityNotUnique/);

    om.writeProposalFile(proposal.worktree, "precedents/example/duplicate.md", text("renamed-clause"));
    om.commitProposal(proposal.worktree, "Create duplicate identity for validation");
    assert.throws(() => om.knowledgePath(proposal.branch, "renamed-clause"), /KnowledgeIdentityNotUnique/);
    assert.ok(om.knowledgeIssues(om.head(proposal.branch)).some(issue => /must be unique/.test(issue.message)));
  } finally { rmSync(root, { recursive: true, force: true }); }
});
