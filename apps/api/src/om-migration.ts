import { existsSync, realpathSync } from "node:fs";
import { resolve, sep } from "node:path";
import type { OmWorkspace } from "@airic-forge/domain";
import type { ForgeDatabase } from "./database.js";
import type { PersonalGitOperatingModel } from "./personal-git-om.js";

/** Reads legacy records only. Historical commits and old worktrees are never removed. */
export function migrateOmDrafts(db: ForgeDatabase, om: PersonalGitOperatingModel, dryRun = true) {
  const report: Array<{ source: string; owner: string; scope: string; status: string }> = [];
  const reserved = new Set<string>();
  const occupied = (owner: string, scope: string) => Boolean(db.workspace(owner, scope) || reserved.has(`${owner}:${scope}`));
  for (const user of db.listUsers()) {
    const saved = db.legacyOmDrafts(user.id);
    if (saved.length) {
      const bases = new Set(saved.map((draft) => draft.baseRevision));
      for (const base of bases) {
        const scope = bases.size === 1 && !occupied(user.id, "manual") ? "manual" : `archive:manual-${base}`;
        const source = `manual:${user.id}:${base}`;
        if (db.workspace(user.id, scope) || db.omMigrationDone(source)) continue;
        const workspace: OmWorkspace = { ownerUserId: user.id, scope, baseRevision: base, summary: "Saved personal OM edits", conflicts: [], edits: saved.filter((draft) => draft.baseRevision === base).map(({ path, content }) => ({ path, content })) };
        reserved.add(`${user.id}:${scope}`);
        report.push({ source: "manual", owner: user.id, scope, status: "ready" });
        if (!dryRun) db.saveMigratedWorkspace(source, workspace);
      }
    }
  }
  for (const row of db.legacyOmProposals()) {
    if (row.status !== "open") continue;
    const source = `proposal:${row.id}`;
    if (db.omMigrationDone(source)) continue;
    const owner = String(row.owner_user_id);
    const archive = `archive:${row.id}`;
    const preferred = row.reflection_id ? `reflection:${row.reflection_id}` : row.source === "organization-sync" ? "sync" : archive;
    const scope = occupied(owner, preferred) ? archive : preferred;
    if (db.workspace(owner, archive) || db.workspace(owner, preferred)?.summary === `Migrated: ${String(row.reason)}`) continue;
    const directory = String(row.worktree_path);
    const safeRoot = resolve(om.dataDir, "worktrees");
    try {
      if (!existsSync(directory) || !realpathSync(directory).startsWith(`${realpathSync(safeRoot)}${sep}`)) throw new Error("LegacyWorktreeUnavailable");
      const baseRevision = String(row.base_revision);
      const paths = om.proposalChangedPaths(directory, baseRevision);
      const workspace: OmWorkspace = {
        ownerUserId: owner, scope, baseRevision, summary: `Migrated: ${String(row.reason)}`, conflicts: om.proposalConflicts(directory),
        edits: paths.map((path) => ({ path, content: existsSync(resolve(directory, path)) ? om.proposalFile(directory, path) : null })),
        ...(row.upstream_revision ? { upstreamRevision: String(row.upstream_revision) } : {}),
      };
      reserved.add(`${owner}:${scope}`);
      report.push({ source: String(row.id), owner, scope, status: "ready" });
      if (!dryRun) db.saveMigratedWorkspace(source, workspace);
    } catch {
      report.push({ source: String(row.id), owner, scope, status: "needs-manual-recovery" });
    }
  }
  return report;
}
