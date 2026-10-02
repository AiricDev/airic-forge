import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { GitOperatingModel } from "./git-om.js";
import { validateWorkDefinition } from "@airic-forge/domain";

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
