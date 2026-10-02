import { cpSync, existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { parse } from "yaml";
import type { WorkDefinition } from "@airic-forge/domain";

const run = (cwd: string, args: string[]): string => {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr.trim()}`);
  return result.stdout.trim();
};

export class GitOperatingModel {
  constructor(readonly projectDir: string, readonly dataDir: string, readonly seedProjectDir: string) {}

  initialize(): void {
    mkdirSync(this.projectDir, { recursive: true });
    if (!existsSync(join(this.projectDir, ".git"))) {
      if (readdirSync(this.projectDir).length === 0) cpSync(this.seedProjectDir, this.projectDir, { recursive: true });
      run(this.projectDir, ["init", "--initial-branch=main"]);
      run(this.projectDir, ["add", "."]);
      run(this.projectDir, ["-c", "user.name=AiricForge", "-c", "user.email=forge@localhost", "commit", "-m", "Initialize AiricForge Operating Model"]);
    }
  }

  ensureUserBranch(userId: string): { branch: string; worktree: string } {
    const branch = `users/${userId}`;
    const branchRef = `refs/heads/${branch}`;
    const exists = spawnSync("git", ["show-ref", "--verify", "--quiet", branchRef], { cwd: this.projectDir }).status === 0;
    if (!exists) run(this.projectDir, ["branch", branch, "main"]);
    const worktree = resolve(this.dataDir, "worktrees", "users", userId);
    if (!existsSync(worktree)) { mkdirSync(resolve(worktree, ".."), { recursive: true }); run(this.projectDir, ["worktree", "add", worktree, branch]); }
    return { branch, worktree };
  }

  head(branch: string): string { return run(this.projectDir, ["rev-parse", branch]); }

  workDefinition(revision: string, id: string): WorkDefinition {
    const raw = run(this.projectDir, ["show", `${revision}:work-definitions/${id}/work.yml`]);
    const parsed = parse(raw) as WorkDefinition;
    if (!parsed || parsed.id !== id) throw new Error(`invalid work definition ${id}`);
    return parsed;
  }

  document(revision: string, path: string): string {
    if (path.startsWith("/") || path.includes("..")) throw new Error("invalid OM document path");
    return run(this.projectDir, ["show", `${revision}:${path}`]);
  }

  knownKnowledge(revision: string): Set<string> {
    const names = run(this.projectDir, ["ls-tree", "-r", "--name-only", revision, "subject-knowledge"]);
    const known = new Set<string>();
    for (const path of names.split("\n").filter((name) => name.endsWith(".md") && !name.endsWith("README.md"))) {
      const raw = this.document(revision, path);
      const match = raw.match(/^---\s*\n([\s\S]*?)\n---/);
      if (!match) continue;
      const metadata = parse(match[1]) as { id?: string };
      if (metadata.id) known.add(metadata.id);
    }
    return known;
  }

  createProposal(userId: string, proposalId: string, baseRevision: string): { branch: string; worktree: string } {
    const branch = `proposals/${proposalId}`;
    const worktree = resolve(this.dataDir, "worktrees", "proposals", proposalId);
    mkdirSync(resolve(worktree, ".."), { recursive: true });
    run(this.projectDir, ["worktree", "add", "-b", branch, worktree, baseRevision]);
    return { branch, worktree };
  }

  proposalChanges(worktree: string): string[] { return run(worktree, ["diff", "--name-only", "HEAD"]).split("\n").filter(Boolean); }

  writeProposalFile(worktree: string, path: string, content: string): void {
    if (!/^(work-definitions\/[a-z0-9-]+\/|subject-knowledge\/).+\.md$/.test(path) || path.includes("..")) throw new Error("ProposalPathNotAllowed");
    const destination = resolve(worktree, path);
    if (!destination.startsWith(`${resolve(worktree)}/`)) throw new Error("ProposalPathNotAllowed");
    mkdirSync(resolve(destination, ".."), { recursive: true }); writeFileSync(destination, content, "utf8");
  }

  commitProposal(worktree: string, title: string): void {
    if (!this.proposalChanges(worktree).length) throw new Error("ProposalHasNoChanges");
    run(worktree, ["add", "."]); run(worktree, ["-c", "user.name=AiricForge", "-c", "user.email=forge@localhost", "commit", "-m", title]);
  }

  adoptProposal(userBranch: string, userWorktree: string, proposalBranch: string, baseRevision: string, trailers: Record<string, string>): string {
    const active = this.head(userBranch);
    if (active !== baseRevision) throw new Error("ActiveRevisionChanged");
    const message = ["Adopt AiricForge Proposal", "", ...Object.entries(trailers).map(([key, value]) => `${key}: ${value}`)];
    run(userWorktree, ["merge", "--no-ff", proposalBranch, "-m", message.join("\n")]);
    return this.head(userBranch);
  }
}
