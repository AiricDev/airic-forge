import { createHash } from "node:crypto";
import type { ForgeDatabase } from "./database.js";
import type { PersonalGitOperatingModel } from "./personal-git-om.js";
import { GitOmWorkspaces } from "./git-om-workspaces.js";
import { GitContributions } from "./git-contributions.js";
import { git } from "./personal-git-om.js";

/** Legacy tables remain intact for one rollback window; receipts prevent draft resurrection. */
export function migrateOmStateToGit(db: ForgeDatabase, om: PersonalGitOperatingModel, dryRun = true) {
  const drafts = new GitOmWorkspaces(om);
  const contributions = new GitContributions(om);
  const report: Array<{ source: string; status: "ready" | "verified" | "migrated"; paths?: number; operation?: "restore-accepted-branch" }> = [];
  const actions: Array<() => void> = [];
  const canonical = (value: unknown) => JSON.stringify(value);
  for (const user of db.listUsers()) {
    for (const workspace of db.workspaces(user.id)) {
      const source = `git-workspace:${user.id}:${workspace.scope}`;
      if (db.omMigrationDone(source)) continue;
      const current = drafts.workspace(user.id, workspace.scope);
      const files = new Set(om.listFiles(workspace.baseRevision));
      const normalized = { ...workspace, edits: workspace.edits.filter((edit) => {
        const original = files.has(edit.path) ? om.document(workspace.baseRevision, edit.path) : null;
        return original !== edit.content;
      }).sort((a, b) => a.path.localeCompare(b.path)) };
      const shape = (candidate: typeof workspace) => ({ ownerUserId: candidate.ownerUserId, scope: candidate.scope, baseRevision: candidate.baseRevision,
        summary: candidate.summary, conflicts: candidate.conflicts, upstreamRevision: candidate.upstreamRevision,
        edits: [...candidate.edits].sort((a, b) => a.path.localeCompare(b.path)).map(({ path, content }) => ({ path, content })) });
      const equivalent = (candidate: typeof workspace) => canonical(shape(candidate)) === canonical(shape(normalized));
      if (current && !equivalent(current)) throw new Error(`GitDraftMigrationConflict: ${source}`);
      om.head(workspace.baseRevision);
      report.push({ source, status: current ? "verified" : "ready", paths: normalized.edits.length });
      actions.push(() => {
        if (!current) drafts.saveWorkspace(workspace);
        const restored = drafts.workspace(user.id, workspace.scope)!;
        if (!equivalent(restored)) throw new Error(`GitDraftMigrationVerificationFailed: ${source}`);
        db.recordOmMigration(source);
      });
    }
  }
  for (const record of db.contributions()) {
    const source = `git-contribution:${record.id}`;
    if (db.omMigrationDone(source)) continue;
    let current = contributions.contribution(record.id);
    const restore = !current && record.status === "accepted" && record.acceptedRevision;
    if (restore) {
      if (!om.includesRevision("main", restore)) throw new Error(`GitContributionNotInMain: ${record.id}`);
      current = contributions.contribution(record.id, restore);
    }
    if (current && (current.sourceRevision !== record.sourceRevision || current.authorUserId !== record.authorUserId
      || current.baseMainRevision !== record.baseMainRevision || (record.status === "accepted" && current.status !== "accepted")
      || current.reason.replace(/\s+/g, " ").trim() !== record.reason.replace(/\s+/g, " ").trim()
      || current.evidence.replace(/\s+/g, " ").trim() !== record.evidence.replace(/\s+/g, " ").trim()
      || (record.status !== "open" && canonical([...current.selectedPaths].sort()) !== canonical([...record.selectedPaths].sort())))) throw new Error(`GitContributionMigrationConflict: ${record.id}`);
    if (!current && record.status !== "open") throw new Error(`GitContributionBranchMissing: ${record.id}`);
    report.push({ source, status: current && !restore ? "verified" : "ready", ...(restore ? { operation: "restore-accepted-branch" as const } : {}) });
    actions.push(() => {
      if (restore) git(om.projectDir, ["update-ref", `refs/heads/contributions/${record.id}`, restore, "0".repeat(40)]);
      if (!current) { om.pinContributionSource(record.id, record.sourceRevision); contributions.createContribution(record); }
      db.recordOmMigration(source);
    });
  }
  if (!dryRun) {
    for (const action of actions) action();
    for (const row of report) row.status = "migrated";
  }
  return { fingerprint: createHash("sha256").update(canonical(report)).digest("hex"), report };
}
