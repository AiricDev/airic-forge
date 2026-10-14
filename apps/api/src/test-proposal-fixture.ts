import type { ProposalRecord } from "@airic-forge/domain";
import type { ForgeRuntime } from "./runtime.js";
import { systemPort } from "./system-port.js";

/** Build a historical Proposal state for governance tests without reopening manual creation in the product. */
export function createTestProposal(runtime: ForgeRuntime, ownerUserId: string, reason: string, evidence: string): ProposalRecord {
  const workspace = runtime.om.ensureUserBranch(ownerUserId);
  const baseRevision = runtime.om.head(workspace.branch);
  const id = systemPort.id("prp");
  const git = runtime.om.createProposal(ownerUserId, id, baseRevision);
  return runtime.db.createProposal({ id, ownerUserId, baseRevision, branchRef: git.branch, worktreePath: git.worktree, status: "open", source: "legacy-fixture", reason, evidence });
}
