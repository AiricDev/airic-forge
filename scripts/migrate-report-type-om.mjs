#!/usr/bin/env node
/** One-time, explicit OM package migration for existing persistent Forge projects. */
import { cpSync, existsSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const project = process.env.FORGE_PROJECT_DIR ?? "/project";
const seed = process.env.FORGE_SEED_PROJECT_DIR ?? "/app/seed/project";
const packagePath = "work-definitions/report-type-definition";
const source = join(seed, packagePath);
if (!existsSync(join(source, "work.yml"))) throw new Error("ReportTypePackageSeedMissing");

const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
const worktrees = git(project, "worktree", "list", "--porcelain").split(/\n\n/).map((entry) => {
  const path = entry.match(/^worktree (.+)$/m)?.[1];
  const branch = entry.match(/^branch refs\/heads\/(.+)$/m)?.[1];
  return { path, branch };
});
const targets = ["main", ...git(project, "for-each-ref", "--format=%(refname:short)", "refs/heads/users/").split("\n").filter(Boolean)];
for (const branch of targets) {
  const worktree = worktrees.find((item) => item.branch === branch)?.path;
  if (!worktree) throw new Error(`CheckedOutWorktreeRequired: ${branch}`);
  const destination = join(worktree, packagePath);
  if (existsSync(destination)) {
    if (!existsSync(join(destination, "work.yml"))) throw new Error(`PartialReportTypePackage: ${branch}`);
    console.log(`Already present: ${branch}`);
    continue;
  }
  if (git(worktree, "status", "--porcelain", "--untracked-files=all")) throw new Error(`DirtyWorktree: ${branch}`);
  cpSync(source, destination, { recursive: true });
  git(worktree, "add", "--", packagePath);
  git(worktree, "-c", "user.name=AiricForge", "-c", "user.email=forge@localhost", "commit", "-m", "Install Report Type Work package\n\nMigration-Source: AiricForge Stage 5");
  console.log(`Installed: ${branch} ${git(worktree, "rev-parse", "HEAD")}`);
}
