import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { parse } from "yaml";
import { isAllowedOmDocumentPath, type ValidationIssue, type WorkDefinition } from "@airic-forge/domain";

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

  constructor(readonly projectDir: string, readonly dataDir: string, readonly seedProjectDir?: string) {}

  initialize(): void {
    if (existsSync(join(this.projectDir, ".git")) && spawnSync("git", ["rev-parse", "--verify", "HEAD"], { cwd: this.projectDir, timeout: 30_000 }).status === 0) return;
    if (!existsSync(join(this.projectDir, ".git"))) {
      if (this.seedProjectDir) {
        const seed = realpathSync(this.seedProjectDir);
        for (const directory of [this.projectDir, this.dataDir]) {
          const target = existsSync(directory) ? realpathSync(directory) : resolve(directory);
          if (target === seed || target.startsWith(`${seed}/`) || seed.startsWith(`${target}/`)) throw new Error("OmSeedRuntimeOverlap");
        }
      }
      mkdirSync(this.projectDir, { recursive: true });
      if (this.seedProjectDir && readdirSync(this.projectDir).length === 0) {
        const seedProjectDir = this.seedProjectDir;
        const files: string[] = [];
        const scan = (relative: string) => {
          const path = join(seedProjectDir, relative);
          if (lstatSync(path).isSymbolicLink()) throw new Error("OmSeedSymlinkNotAllowed");
          if (lstatSync(path).isDirectory()) {
            for (const entry of readdirSync(path)) scan(`${relative}/${entry}`);
          } else if (isAllowedOmDocumentPath(relative)) files.push(relative);
        };
        for (const directory of ["work-definitions", "subject-knowledge", "precedents"]) {
          if (existsSync(join(seedProjectDir, directory))) scan(directory);
        }
        for (const path of files) {
          mkdirSync(resolve(this.projectDir, path, ".."), { recursive: true });
          cpSync(join(seedProjectDir, path), join(this.projectDir, path));
        }
      }
      run(this.projectDir, ["init", "--initial-branch=main"]);
    }
    for (const directory of ["work-definitions", "subject-knowledge", "precedents"]) {
      if (existsSync(join(this.projectDir, directory))) run(this.projectDir, ["add", "--", directory]);
    }
    run(this.projectDir, ["commit", "--allow-empty", "-m", "Initialize AiricForge Operating Model", "-m", "Co-authored-by: factory-droid[bot] <138933559+factory-droid[bot]@users.noreply.github.com>"]);
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
      || !Array.isArray(parsed.knowledge?.bootstrap)
      || !Array.isArray(parsed.knowledge?.available) || !parsed.completion) {
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

  prepareContribution(contributionId: string, sourceRevision: string, baseRevision: string, mainRevision: string, selectedPaths: string[], message: string, expectedCandidateRevision: string): { revision: string } {
    if (!/^[a-zA-Z0-9_-]+$/.test(contributionId)) throw new Error("InvalidContributionSource");
    if (this.head("main") !== mainRevision) throw new Error("OrganizationReviewStale");
    const changed = new Set(this.divergence(sourceRevision, mainRevision).changedPaths);
    if (!selectedPaths.length || selectedPaths.some((path) => !isAllowedOmDocumentPath(path) || !changed.has(path))) throw new Error("InvalidContributionSelection");
    const branch = `contributions/${contributionId}`;
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
      if (this.head(branch) !== expectedCandidateRevision) throw new Error("ContributionChangedAfterReview");
      const revision = run(this.projectDir, ["commit-tree", tree, "-p", expectedCandidateRevision], { input: message + "\n" });
      return { revision };
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

}
