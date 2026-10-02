import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { GitOperatingModel } from "./git-om.js";

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
