import { cpSync, existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { parse } from "yaml";
import { isAllowedProposalPath, type ValidationIssue, type WorkDefinition } from "@airic-forge/domain";

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

  listFiles(revision: string): string[] {
    return run(this.projectDir, ["ls-tree", "-r", "--name-only", revision, "work-definitions", "subject-knowledge"])
      .split("\n").filter((path) => /^(work-definitions\/[a-z0-9-]+\/(?:work\.yml|[a-z0-9-]+\.md)|subject-knowledge\/[a-z0-9-]+\.md)$/.test(path));
  }

  workDefinition(revision: string, id: string): WorkDefinition {
    const raw = run(this.projectDir, ["show", `${revision}:work-definitions/${id}/work.yml`]);
    const parsed = parse(raw) as WorkDefinition;
    if (!parsed || parsed.id !== id || parsed.schemaVersion !== 1 || !Array.isArray(parsed.documents)
      || !Array.isArray(parsed.capabilities?.allowed) || !Array.isArray(parsed.knowledge?.bootstrap)
      || !Array.isArray(parsed.knowledge?.available) || !Array.isArray(parsed.completion?.requiredCapabilities)) {
      throw new Error(`InvalidOperatingModel: invalid work definition ${id}`);
    }
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
      if (metadata?.id) known.add(metadata.id);
    }
    return known;
  }

  knowledgeIssues(revision: string): ValidationIssue[] {
    const names = run(this.projectDir, ["ls-tree", "-r", "--name-only", revision, "subject-knowledge"]);
    const issues: ValidationIssue[] = [];
    const ids = new Set<string>();
    for (const path of names.split("\n").filter((name) => name.endsWith(".md") && !name.endsWith("README.md"))) {
      const raw = this.document(revision, path);
      const match = raw.match(/^---\s*\n([\s\S]*?)\n---/);
      if (!match) { issues.push({ path, message: "Subject Knowledge needs YAML front matter" }); continue; }
      let metadata: { id?: unknown; title?: unknown; summary?: unknown; topics?: unknown };
      try { metadata = parse(match[1]) as typeof metadata; }
      catch { issues.push({ path, message: "invalid Subject Knowledge front matter" }); continue; }
      const id = typeof metadata?.id === "string" ? metadata.id : "";
      if (!/^[a-z][a-z0-9.-]*$/.test(id)) issues.push({ path, message: "Subject Knowledge needs a stable id" });
      if (ids.has(id)) issues.push({ path, message: "Subject Knowledge id must be unique" });
      ids.add(id);
      if (typeof metadata?.title !== "string" || !metadata.title.trim()) issues.push({ path, message: "Subject Knowledge needs a title" });
      if (typeof metadata?.summary !== "string" || !metadata.summary.trim()) issues.push({ path, message: "Subject Knowledge needs a summary" });
      if (!Array.isArray(metadata?.topics) || metadata.topics.some((topic) => typeof topic !== "string")) issues.push({ path, message: "Subject Knowledge topics must be a string list" });
    }
    return issues;
  }

  createProposal(userId: string, proposalId: string, baseRevision: string): { branch: string; worktree: string } {
    const branch = `proposals/${proposalId}`;
    const worktree = resolve(this.dataDir, "worktrees", "proposals", proposalId);
    mkdirSync(resolve(worktree, ".."), { recursive: true });
    run(this.projectDir, ["worktree", "add", "-b", branch, worktree, baseRevision]);
    return { branch, worktree };
  }

  proposalChanges(worktree: string): string[] {
    const result = spawnSync("git", ["status", "--porcelain", "--untracked-files=all"], { cwd: worktree, encoding: "utf8" });
    if (result.status !== 0) throw new Error(`git status failed: ${result.stderr.trim()}`);
    return result.stdout.split("\n").filter(Boolean).map((line) => line.slice(3));
  }

  writeProposalFile(worktree: string, path: string, content: string): void {
    if (!isAllowedProposalPath(path)) throw new Error("ProposalPathNotAllowed");
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
