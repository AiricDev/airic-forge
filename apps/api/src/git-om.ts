import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { parse, stringify } from "yaml";
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

  history(branch: string): Array<{ revision: string; subject: string; at: string }> {
    return run(this.projectDir, ["log", "--first-parent", "--max-count=50", "--date=iso-strict", "--pretty=format:%H%x1f%s%x1f%aI", branch])
      .split("\n").filter(Boolean).map((line) => {
        const [revision, subject, at] = line.split("\x1f");
        return { revision, subject, at };
      });
  }

  containsRevision(branch: string, revision: string): boolean {
    if (!/^[0-9a-f]{40}$/.test(revision)) return false;
    return run(this.projectDir, ["rev-list", "--first-parent", branch]).split("\n").includes(revision);
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
      if (id !== path.split("/").pop()?.replace(/\.md$/, "")) issues.push({ path, message: "Subject Knowledge id must match its file name" });
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

  proposalChangedPaths(worktree: string, baseRevision: string): string[] {
    const committed = run(worktree, ["diff", "--name-only", baseRevision]);
    return [...new Set([...committed.split("\n").filter(Boolean), ...this.proposalChanges(worktree)])];
  }

  proposalConflicts(worktree: string): string[] {
    return run(worktree, ["diff", "--name-only", "--diff-filter=U"]).split("\n").filter(Boolean);
  }

  proposalFile(worktree: string, path: string): string {
    if (!isAllowedProposalPath(path)) throw new Error("ProposalPathNotAllowed");
    const destination = resolve(worktree, path);
    if (!destination.startsWith(`${resolve(worktree)}/`)) throw new Error("ProposalPathNotAllowed");
    return readFileSync(destination, "utf8");
  }

  proposalDiff(worktree: string, baseRevision: string): string {
    const tracked = run(worktree, ["diff", "--no-ext-diff", baseRevision, "--", "work-definitions", "subject-knowledge"]);
    const untracked = run(worktree, ["ls-files", "--others", "--exclude-standard"]).split("\n").filter(Boolean);
    const additions = untracked.map((path) => {
      if (!isAllowedProposalPath(path)) return `Invalid path: ${path}`;
      const content = this.proposalFile(worktree, path).split("\n").map((line) => `+${line}`).join("\n");
      return `diff --git a/${path} b/${path}\nnew file mode 100644\n--- /dev/null\n+++ b/${path}\n${content}`;
    });
    return [tracked, ...additions].filter(Boolean).join("\n");
  }

  writeProposalFile(worktree: string, path: string, content: string): void {
    if (!isAllowedProposalPath(path)) throw new Error("ProposalPathNotAllowed");
    const destination = resolve(worktree, path);
    if (!destination.startsWith(`${resolve(worktree)}/`)) throw new Error("ProposalPathNotAllowed");
    mkdirSync(resolve(destination, ".."), { recursive: true }); writeFileSync(destination, content, "utf8");
  }

  makeKnowledgeAvailable(worktree: string, workDefinitionId: string, knowledgeIds: string[]): void {
    const path = `work-definitions/${workDefinitionId}/work.yml`;
    if (!isAllowedProposalPath(path)) throw new Error("ProposalPathNotAllowed");
    const destination = resolve(worktree, path);
    const definition = parse(readFileSync(destination, "utf8")) as { knowledge?: { bootstrap?: string[]; available?: string[] } };
    if (!definition.knowledge || !Array.isArray(definition.knowledge.available)) throw new Error("InvalidWorkKnowledgeDeclaration");
    definition.knowledge.available = [...new Set([...definition.knowledge.available, ...knowledgeIds])];
    writeFileSync(destination, stringify(definition), "utf8");
  }

  commitProposal(worktree: string, title: string): void {
    if (!this.proposalChanges(worktree).length) throw new Error("ProposalHasNoChanges");
    run(worktree, ["add", "."]); run(worktree, ["-c", "user.name=AiricForge", "-c", "user.email=forge@localhost", "commit", "-m", title]);
  }

  rebaseProposal(worktree: string, oldBase: string, newBase: string): void {
    const rebasePath = run(worktree, ["rev-parse", "--git-path", "rebase-merge"]);
    const applyPath = run(worktree, ["rev-parse", "--git-path", "rebase-apply"]);
    const inProgress = existsSync(resolve(worktree, rebasePath)) || existsSync(resolve(worktree, applyPath));
    if (inProgress) {
      const ontoPath = resolve(worktree, rebasePath, "onto");
      if (existsSync(ontoPath) && readFileSync(ontoPath, "utf8").trim() !== newBase) throw new Error("ActiveRevisionChangedDuringRebase");
      const conflicts = this.proposalConflicts(worktree);
      for (const path of conflicts) {
        if (!isAllowedProposalPath(path)) throw new Error("ProposalPathNotAllowed");
        if (/^(<<<<<<< |=======\s*$|>>>>>>> )/m.test(this.proposalFile(worktree, path))) throw new Error(`ProposalRebaseConflict: resolve ${path} before continuing`);
      }
      if (this.proposalChanges(worktree).some((path) => !isAllowedProposalPath(path))) throw new Error("ProposalPathNotAllowed");
      run(worktree, ["add", "-A"]);
      const continued = spawnSync("git", ["-c", "user.name=AiricForge", "-c", "user.email=forge@localhost", "-c", "core.editor=true", "rebase", "--continue"], { cwd: worktree, encoding: "utf8", env: { ...process.env, GIT_EDITOR: "true" } });
      if (continued.status !== 0) throw new Error(`ProposalRebaseConflict: ${continued.stderr.trim() || continued.stdout.trim()}`);
      return;
    }
    if (this.proposalChanges(worktree).length) this.commitProposal(worktree, "Save Proposal before rebase");
    const result = spawnSync("git", ["-c", "user.name=AiricForge", "-c", "user.email=forge@localhost", "rebase", "--onto", newBase, oldBase], { cwd: worktree, encoding: "utf8" });
    if (result.status !== 0) throw new Error(`ProposalRebaseConflict: ${result.stderr.trim() || result.stdout.trim()}`);
  }

  adoptProposal(userBranch: string, userWorktree: string, proposalBranch: string, baseRevision: string, trailers: Record<string, string>): string {
    const active = this.head(userBranch);
    if (active !== baseRevision) throw new Error("ActiveRevisionChanged");
    const message = ["Adopt AiricForge Proposal", "", ...Object.entries(trailers).map(([key, value]) => `${key}: ${value}`)];
    try { run(userWorktree, ["-c", "user.name=AiricForge", "-c", "user.email=forge@localhost", "merge", "--no-ff", proposalBranch, "-m", message.join("\n")]); }
    catch (error) { spawnSync("git", ["merge", "--abort"], { cwd: userWorktree, encoding: "utf8" }); throw error; }
    return this.head(userBranch);
  }
}
