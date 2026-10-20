import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { parse, stringify } from "yaml";
import { isAllowedOmDocumentPath, isAllowedProposalPath, type ValidationIssue, type WorkDefinition } from "@airic-forge/domain";

const run = (cwd: string, args: string[], options: { input?: string; env?: NodeJS.ProcessEnv; raw?: boolean } = {}): string => {
  const result = spawnSync("git", args, { cwd, input: options.input, env: { ...process.env, ...options.env, GIT_OPTIONAL_LOCKS: "0" }, encoding: "utf8", maxBuffer: 16 * 1024 * 1024, timeout: 30_000 });
  if (result.status !== 0) {
    const cause = result.error?.message || result.stderr?.trim() || (result.signal ? `terminated by ${result.signal}` : `exit ${result.status}`);
    throw new Error(`git ${args.join(" ")} failed: ${cause}`);
  }
  return options.raw ? result.stdout : result.stdout.trim();
};

export class GitOperatingModel {
  private readonly knowledgeIndexes = new Map<string, Map<string, string[]>>();

  constructor(readonly projectDir: string, readonly dataDir: string, readonly seedProjectDir: string) {}

  initialize(): void {
    const seed = realpathSync(this.seedProjectDir);
    for (const directory of [this.projectDir, this.dataDir]) {
      const target = existsSync(directory) ? realpathSync(directory) : resolve(directory);
      if (target === seed || target.startsWith(`${seed}/`) || seed.startsWith(`${target}/`)) throw new Error("OmSeedRuntimeOverlap");
    }
    mkdirSync(this.projectDir, { recursive: true });
    if (!existsSync(join(this.projectDir, ".git"))) {
      if (readdirSync(this.projectDir).length === 0) {
        const files: string[] = [];
        const scan = (relative: string) => {
          const path = join(this.seedProjectDir, relative);
          if (lstatSync(path).isSymbolicLink()) throw new Error("OmSeedSymlinkNotAllowed");
          if (lstatSync(path).isDirectory()) {
            for (const entry of readdirSync(path)) scan(`${relative}/${entry}`);
          } else if (isAllowedOmDocumentPath(relative)) files.push(relative);
        };
        for (const directory of ["work-definitions", "subject-knowledge", "precedents"]) {
          if (existsSync(join(this.seedProjectDir, directory))) scan(directory);
        }
        for (const path of files) {
          mkdirSync(resolve(this.projectDir, path, ".."), { recursive: true });
          cpSync(join(this.seedProjectDir, path), join(this.projectDir, path));
        }
      }
      run(this.projectDir, ["init", "--initial-branch=main"]);
      run(this.projectDir, ["add", "."]);
      run(this.projectDir, ["commit", "-m", "Initialize AiricForge Operating Model", "-m", "Co-authored-by: factory-droid[bot] <138933559+factory-droid[bot]@users.noreply.github.com>"]);
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
    return run(this.projectDir, ["ls-tree", "-r", "--name-only", revision, "work-definitions", "subject-knowledge", "precedents"])
      .split("\n").filter(isAllowedOmDocumentPath);
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

  includesRevision(branch: string, revision: string): boolean {
    if (!/^[0-9a-f]{40}$/.test(revision)) return false;
    return spawnSync("git", ["merge-base", "--is-ancestor", revision, branch], { cwd: this.projectDir }).status === 0;
  }

  workDefinition(revision: string, id: string): WorkDefinition {
    if (!/^[a-z][a-z0-9-]*$/.test(id)) throw new Error("InvalidWorkDefinitionId");
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
    if (!isAllowedOmDocumentPath(path)) throw new Error("invalid OM document path");
    if (!run(this.projectDir, ["ls-tree", revision, "--", path]).startsWith("100644 ")
      && !run(this.projectDir, ["ls-tree", revision, "--", path]).startsWith("100755 ")) throw new Error("OmDocumentNotRegularFile");
    return run(this.projectDir, ["show", `${revision}:${path}`], { raw: true });
  }

  knownKnowledge(revision: string): Set<string> {
    return new Set(this.knowledgeIndex(revision).keys());
  }

  private knowledgeIndex(revision: string): Map<string, string[]> {
    // Cache immutable commits, never a movable branch name or a draft worktree.
    const commit = /^[0-9a-f]{40}$/.test(revision)
      ? revision : run(this.projectDir, ["rev-parse", "--verify", `${revision}^{commit}`]);
    const cached = this.knowledgeIndexes.get(commit);
    if (cached) return cached;
    const index = new Map<string, string[]>();
    for (const path of this.listFiles(commit).filter((path) => /^(subject-knowledge|precedents)\//.test(path)
      && !path.endsWith("README.md"))) {
      const raw = this.document(commit, path);
      const match = raw.match(/^---\s*\n([\s\S]*?)\n---/);
      if (!match) continue;
      const metadata = parse(match[1]) as { id?: string };
      if (metadata?.id) index.set(metadata.id, [...(index.get(metadata.id) ?? []), path]);
    }
    if (this.knowledgeIndexes.size >= 4) this.knowledgeIndexes.delete(this.knowledgeIndexes.keys().next().value!);
    this.knowledgeIndexes.set(commit, index);
    return index;
  }

  knowledgePath(revision: string, id: string): string {
    const paths = this.knowledgeIndex(revision).get(id) ?? [];
    if (paths.length !== 1) throw new Error("KnowledgeIdentityNotUnique");
    return paths[0];
  }

  knowledgeIssues(revision: string): ValidationIssue[] {
    const names = this.listFiles(revision).filter((path) => /^(subject-knowledge|precedents)\//.test(path)).join("\n");
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
      if (/^subject-knowledge\/[^/]+\.md$/.test(path) && id !== path.split("/").pop()?.replace(/\.md$/, "")) issues.push({ path, message: "Subject Knowledge id must match its file name" });
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
    const result = spawnSync("git", ["status", "--porcelain", "--untracked-files=all"], { cwd: worktree, env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" }, encoding: "utf8" });
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
    return readFileSync(this.proposalDestination(worktree, path), "utf8");
  }

  private proposalDestination(worktree: string, path: string): string {
    if (!isAllowedProposalPath(path) || lstatSync(worktree).isSymbolicLink()) throw new Error("ProposalPathNotAllowed");
    let destination = resolve(worktree);
    const parts = path.split("/");
    for (const [index, part] of parts.entries()) {
      destination = join(destination, part);
      const stat = lstatSync(destination, { throwIfNoEntry: false });
      if (stat && (stat.isSymbolicLink() || (index < parts.length - 1 ? !stat.isDirectory() : !stat.isFile()))) throw new Error("ProposalPathNotAllowed");
    }
    return destination;
  }

  proposalDiff(worktree: string, baseRevision: string): string {
    const tracked = run(worktree, ["diff", "--no-ext-diff", baseRevision, "--", "work-definitions", "subject-knowledge", "precedents"]);
    const untracked = run(worktree, ["ls-files", "--others", "--exclude-standard"]).split("\n").filter(Boolean);
    const additions = untracked.map((path) => {
      if (!isAllowedProposalPath(path)) return `Invalid path: ${path}`;
      const content = this.proposalFile(worktree, path).split("\n").map((line) => `+${line}`).join("\n");
      return `diff --git a/${path} b/${path}\nnew file mode 100644\n--- /dev/null\n+++ b/${path}\n${content}`;
    });
    return [tracked, ...additions].filter(Boolean).join("\n");
  }

  writeProposalFile(worktree: string, path: string, content: string): void {
    const destination = this.proposalDestination(worktree, path);
    mkdirSync(resolve(destination, ".."), { recursive: true }); writeFileSync(destination, content, "utf8");
  }

  makeKnowledgeAvailable(worktree: string, workDefinitionId: string, knowledgePaths: string[]): void {
    const knowledgeIds = knowledgePaths.flatMap((path) => {
      if (!/^(subject-knowledge|precedents)\//.test(path)) throw new Error("ProposalPathNotAllowed");
      const raw = this.proposalFile(worktree, path);
      if (path.endsWith("/README.md")) return [];
      const match = raw.match(/^---\s*\n([\s\S]*?)\n---/);
      const metadata = match ? parse(match[1]) as { id?: unknown } : undefined;
      if (typeof metadata?.id !== "string" || !/^[a-z][a-z0-9.-]*$/.test(metadata.id)) throw new Error("InvalidSubjectKnowledgeIdentity");
      return [metadata.id];
    });
    if (!knowledgeIds.length) return;
    const path = `work-definitions/${workDefinitionId}/work.yml`;
    const definition = parse(this.proposalFile(worktree, path)) as { knowledge?: { bootstrap?: string[]; available?: string[] } };
    if (!definition.knowledge || !Array.isArray(definition.knowledge.available)) throw new Error("InvalidWorkKnowledgeDeclaration");
    definition.knowledge.available = [...new Set([...definition.knowledge.available, ...knowledgeIds])];
    this.writeProposalFile(worktree, path, stringify(definition));
  }

  commitProposal(worktree: string, title: string): void {
    if (!this.proposalChanges(worktree).length) throw new Error("ProposalHasNoChanges");
    run(worktree, ["add", "."]); run(worktree, ["commit", "-m", title]);
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
      const continued = spawnSync("git", ["-c", "core.editor=true", "rebase", "--continue"], { cwd: worktree, encoding: "utf8", env: { ...process.env, GIT_EDITOR: "true" } });
      if (continued.status !== 0) throw new Error(`ProposalRebaseConflict: ${continued.stderr.trim() || continued.stdout.trim()}`);
      return;
    }
    if (this.proposalChanges(worktree).length) this.commitProposal(worktree, "Save Proposal before rebase");
    const result = spawnSync("git", ["rebase", "--onto", newBase, oldBase], { cwd: worktree, encoding: "utf8" });
    if (result.status !== 0) throw new Error(`ProposalRebaseConflict: ${result.stderr.trim() || result.stdout.trim()}`);
  }

  adoptProposal(userBranch: string, userWorktree: string, proposalBranch: string, baseRevision: string, trailers: Record<string, string>): string {
    const active = this.head(userBranch);
    if (active !== baseRevision) throw new Error("ActiveRevisionChanged");
    const message = ["Adopt AiricForge Proposal", "", ...Object.entries(trailers).map(([key, value]) => `${key}: ${value}`)];
    try { run(userWorktree, ["merge", "--no-ff", proposalBranch, "-m", message.join("\n")]); }
    catch (error) { spawnSync("git", ["merge", "--abort"], { cwd: userWorktree, encoding: "utf8" }); throw error; }
    return this.head(userBranch);
  }

  divergence(sourceRevision: string, targetRevision: string): { baseRevision: string; changedPaths: string[]; diff: string } {
    const baseRevision = run(this.projectDir, ["merge-base", sourceRevision, targetRevision]);
    const personalPaths = new Set(run(this.projectDir, ["diff", "--no-renames", "--name-only", baseRevision, sourceRevision, "--", "work-definitions", "subject-knowledge", "precedents"]).split("\n").filter(Boolean));
    const changedPaths = run(this.projectDir, ["diff", "--no-renames", "--name-only", targetRevision, sourceRevision, "--", "work-definitions", "subject-knowledge", "precedents"]).split("\n").filter(path => personalPaths.has(path));
    const diff = changedPaths.length ? run(this.projectDir, ["diff", "--no-ext-diff", "--no-textconv", "--no-renames", targetRevision, sourceRevision, "--", ...changedPaths], { raw: true }) : "";
    return { baseRevision, changedPaths, diff };
  }

  pinContributionSource(contributionId: string, sourceRevision: string): void {
    if (!/^[a-zA-Z0-9_-]+$/.test(contributionId) || !/^[0-9a-f]{40}$/.test(sourceRevision)) throw new Error("InvalidContributionSource");
    run(this.projectDir, ["update-ref", `refs/forge/contributions/${contributionId}/source`, sourceRevision]);
  }

  prepareContribution(contributionId: string, sourceRevision: string, baseRevision: string, mainRevision: string, selectedPaths: string[], message: string, expectedCandidateRevision?: string): { branch: string; worktree: string; revision: string } {
    if (!/^[a-zA-Z0-9_-]+$/.test(contributionId)) throw new Error("InvalidContributionSource");
    if (this.head("main") !== mainRevision) throw new Error("OrganizationReviewStale");
    const changed = new Set(this.divergence(sourceRevision, mainRevision).changedPaths);
    if (!selectedPaths.length || selectedPaths.some((path) => !isAllowedOmDocumentPath(path) || !changed.has(path))) throw new Error("InvalidContributionSelection");
    const branch = `contributions/${contributionId}`;
    const worktree = resolve(this.dataDir, "worktrees", "contributions", contributionId);
    for (const revision of [baseRevision, mainRevision, sourceRevision]) {
      const entries = run(this.projectDir, ["ls-tree", "-r", revision, "--", ...selectedPaths]).split("\n").filter(Boolean);
      if (entries.some(entry => !/^100(?:644|755) blob /.test(entry))) throw new Error("OmDocumentNotRegularFile");
    }
    const patch = run(this.projectDir, ["diff", "--binary", "--full-index", "--no-ext-diff", "--no-textconv", "--no-renames", baseRevision, sourceRevision, "--", ...selectedPaths], { raw: true });
    if (!patch) throw new Error("ContributionHasNoChanges");
    const directory = mkdtempSync(join(tmpdir(), "forge-contribution-index-"));
    const env = { GIT_INDEX_FILE: join(directory, "index") };
    try {
      run(this.projectDir, ["read-tree", mainRevision], { env });
      try {
        const patchFile = join(directory, "patch");
        writeFileSync(patchFile, patch);
        run(this.projectDir, ["apply", "--cached", "--3way", "--whitespace=nowarn", patchFile], { env });
      } catch (error) {
        const conflicts = run(this.projectDir, ["diff", "--name-only", "--diff-filter=U"], { env });
        if (conflicts) throw new Error(`OrganizationPathConflict: ${conflicts.replace(/\n/g, ", ")}`);
        throw error;
      }
      const tree = run(this.projectDir, ["write-tree"], { env });
      if (tree === run(this.projectDir, ["rev-parse", `${mainRevision}^{tree}`])) throw new Error("ContributionHasNoChanges");
      if (expectedCandidateRevision && this.head(branch) !== expectedCandidateRevision) throw new Error("ContributionChangedAfterReview");
      const revision = run(this.projectDir, ["commit-tree", tree, "-p", expectedCandidateRevision ?? mainRevision], { input: message + "\n" });
      if (expectedCandidateRevision) return { branch, worktree: "", revision };
      mkdirSync(resolve(worktree, ".."), { recursive: true });
      if (existsSync(worktree)) {
        if (this.proposalChanges(worktree).length) throw new Error("ContributionWorktreeDirty");
        run(worktree, ["reset", "--hard", revision]);
      } else run(this.projectDir, ["worktree", "add", "-b", branch, worktree, revision]);
      return { branch, worktree, revision };
    } finally { rmSync(directory, { recursive: true, force: true }); }
  }

  acceptContribution(candidateBranch: string, expectedMainRevision: string, expectedCandidateRevision?: string, reviewer?: string): string {
    if (this.head("main") !== expectedMainRevision) throw new Error("OrganizationReviewStale");
    if (!this.includesRevision(candidateBranch, expectedMainRevision)) throw new Error("OrganizationReviewStale");
    if (expectedCandidateRevision && this.head(candidateBranch) !== expectedCandidateRevision) throw new Error("ContributionChangedAfterReview");
    if (run(this.projectDir, ["status", "--porcelain", "--untracked-files=all"])) throw new Error("OrganizationWorktreeDirty");
    const message = ["Merge organization OM contribution", "", `AiricForge-Contribution: ${candidateBranch.replace(/^contributions\//, "")}`, ...(reviewer ? [`AiricForge-Reviewer: ${reviewer}`] : [])].join("\n");
    try { run(this.projectDir, ["merge", "--no-ff", candidateBranch, "-m", message]); }
    catch (error) { spawnSync("git", ["merge", "--abort"], { cwd: this.projectDir }); throw error; }
    return this.head("main");
  }

  synchronizeProposal(worktree: string, personalRevision: string, mainRevision: string): void {
    const base = run(this.projectDir, ["merge-base", personalRevision, mainRevision]);
    this.rebaseProposal(worktree, base, mainRevision);
  }

  adoptSynchronizedProposal(userBranch: string, userWorktree: string, proposalBranch: string, baseRevision: string, expectedMainRevision: string, trailers: Record<string, string>): string {
    if (this.head(userBranch) !== baseRevision) throw new Error("ActiveRevisionChanged");
    if (this.head("main") !== expectedMainRevision) throw new Error("OrganizationRevisionChanged");
    if (this.proposalChanges(userWorktree).length) throw new Error("UserWorktreeDirty");
    const message = ["Adopt organization OM synchronization", "", ...Object.entries(trailers).map(([key, value]) => `${key}: ${value}`), `AiricForge-Upstream: ${expectedMainRevision}`].join("\n");
    try {
      run(userWorktree, ["merge", "--no-commit", "--no-ff", "-s", "ours", proposalBranch]);
      run(userWorktree, ["restore", "--source", proposalBranch, "--staged", "--worktree", "."]);
      if (run(userWorktree, ["write-tree"]) !== run(userWorktree, ["rev-parse", `${proposalBranch}^{tree}`])) throw new Error("SynchronizedTreeMismatch");
      run(userWorktree, ["commit", "-m", message]);
    } catch (error) { spawnSync("git", ["merge", "--abort"], { cwd: userWorktree, encoding: "utf8" }); throw error; }
    return this.head(userBranch);
  }
}
