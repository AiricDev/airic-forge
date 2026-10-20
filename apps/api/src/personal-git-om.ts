import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { isAllowedOmDocumentPath, type OmEdit, type OmRevisionPort } from "@airic-forge/domain";
import { GitOperatingModel } from "./git-om.js";
import { parse, stringify } from "yaml";

export function git(cwd: string, args: string[], input?: string | Buffer, env?: NodeJS.ProcessEnv): string {
  const result = spawnSync("git", args, { cwd, input, env: { ...process.env, ...env }, encoding: "utf8", timeout: 30_000, maxBuffer: 16 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`GitOperationFailed: ${(result.error?.message || result.stderr?.trim() || result.signal || `exit ${result.status}`).slice(0, 1000)}`);
  return result.stdout.trimEnd();
}

export class PersonalGitOperatingModel extends GitOperatingModel implements OmRevisionPort {
  private readonly checkedTrees = new Set<string>();
  routeKnowledge(baseRevision: string, edits: OmEdit[], workDefinitionId: string): OmEdit[] {
    const ids = edits.flatMap((edit) => {
      if (!/^(subject-knowledge|precedents)\//.test(edit.path) || edit.path.endsWith("README.md") || edit.content === null) return [];
      const match = /^---\s*\n([\s\S]*?)\n---/.exec(edit.content);
      const metadata = match ? parse(match[1]) as { id?: string } : undefined;
      return typeof metadata?.id === "string" ? [metadata.id] : [];
    });
    if (!ids.length) return edits;
    const path = `work-definitions/${workDefinitionId}/work.yml`;
    const edited = edits.find((edit) => edit.path === path);
    if (edited?.content === null) return edits;
    const definition = parse(edited?.content ?? this.document(baseRevision, path)) as { knowledge?: { available?: string[] } };
    if (!Array.isArray(definition.knowledge?.available)) return edits;
    definition.knowledge.available = [...new Set([...definition.knowledge.available, ...ids])];
    return [...edits.filter((edit) => edit.path !== path), { path, content: stringify(definition) }];
  }
  personalCommitCount(): number {
    const branches = git(this.projectDir, ["for-each-ref", "--format=%(refname)", "refs/heads/users/"]).split("\n").filter(Boolean);
    return branches.length ? Number(git(this.projectDir, ["rev-list", "--count", ...branches, "^main"])) : 0;
  }
  prepareOmCommit(input: Parameters<OmRevisionPort["prepareOmCommit"]>[0]): string {
    const directory = mkdtempSync(join(tmpdir(), "forge-om-index-"));
    const env = { GIT_INDEX_FILE: join(directory, "index") };
    try {
      git(this.projectDir, ["read-tree", input.baseRevision], undefined, env);
      for (const edit of input.edits) {
        if (!isAllowedOmDocumentPath(edit.path)) throw new Error("OmPathNotAllowed");
        if (edit.content === null) git(this.projectDir, ["update-index", "--force-remove", "--", edit.path], undefined, env);
        else {
          const contentFile = join(directory, "blob");
          writeFileSync(contentFile, edit.content);
          const blob = git(this.projectDir, ["hash-object", "-w", "--no-filters", contentFile]);
          git(this.projectDir, ["update-index", "--add", "--cacheinfo", `100644,${blob},${edit.path}`], undefined, env);
        }
      }
      const tree = git(this.projectDir, ["write-tree"], undefined, env);
      if (!input.upstreamRevision && tree === git(this.projectDir, ["rev-parse", `${input.baseRevision}^{tree}`])) throw new Error("OmHasNoChanges");
      const message = [input.summary.replace(/\s+/g, " ").trim(), "", ...Object.entries(input.trailers).map(([key, value]) => `${key}: ${value.replace(/[\r\n]/g, " ")}`)].join("\n");
      const parents = ["-p", input.baseRevision, ...(input.upstreamRevision ? ["-p", input.upstreamRevision] : [])];
      return git(this.projectDir, ["commit-tree", tree, ...parents], message);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  }
  publishOmCommit(ownerUserId: string, expectedRevision: string, revision: string): string {
    if (!/^[a-zA-Z0-9_-]+$/.test(ownerUserId) || !/^[0-9a-f]{40}$/.test(revision)) throw new Error("InvalidOmRevision");
    const workspace = this.ensureUserBranch(ownerUserId);
    if (this.head(workspace.branch) !== expectedRevision) throw new Error("ActiveRevisionChanged");
    if (git(workspace.worktree, ["status", "--porcelain", "--untracked-files=all"])) throw new Error("UserWorktreeDirty");
    if (!this.includesRevision(revision, expectedRevision)) throw new Error("OmNonFastForward");
    git(workspace.worktree, ["-c", "core.hooksPath=/dev/null", "merge", "--ff-only", revision]);
    return this.head(workspace.branch);
  }
  commitForRequest(ownerUserId: string, requestId: string) {
    const revision = git(this.projectDir, ["log", `users/${ownerUserId}`, "--first-parent", "--fixed-strings", `--grep=AiricForge-Request: ${requestId}`, "--format=%H", "-1"]);
    if (!revision) return undefined;
    const message = git(this.projectDir, ["show", "-s", "--format=%B", revision]);
    if (!message.split("\n").includes(`AiricForge-Request: ${requestId}`)) return undefined;
    return { revision, digest: /^AiricForge-Digest: (.+)$/m.exec(message)?.[1] ?? "" };
  }
  mergeOmEdits(baseRevision: string, activeRevision: string, edits: OmEdit[]) {
    const baseFiles = new Set(this.listFiles(baseRevision));
    const activeFiles = new Set(this.listFiles(activeRevision));
    const result: OmEdit[] = [];
    const conflicts: string[] = [];
    const directory = mkdtempSync(join(tmpdir(), "forge-om-merge-"));
    try {
      for (const edit of edits) {
        if (!isAllowedOmDocumentPath(edit.path)) throw new Error("OmPathNotAllowed");
        const base = baseFiles.has(edit.path) ? this.document(baseRevision, edit.path) : null;
        const active = activeFiles.has(edit.path) ? this.document(activeRevision, edit.path) : null;
        if (active === edit.content) continue;
        if (active === base) { result.push(edit); continue; }
        if (base === edit.content) continue;
        if (active === null || edit.content === null || base === null) {
          conflicts.push(edit.path);
          result.push({ path: edit.path, content: `<<<<<<< current\n${active ?? "(deleted)"}\n=======\n${edit.content ?? "(deleted)"}\n>>>>>>> draft\n` });
          continue;
        }
        const current = join(directory, "current");
        const original = join(directory, "base");
        const draft = join(directory, "draft");
        writeFileSync(current, active); writeFileSync(original, base); writeFileSync(draft, edit.content);
        const merged = spawnSync("git", ["merge-file", "-p", "-L", "draft", "-L", "base", "-L", "current", draft, original, current], { encoding: "utf8", timeout: 30_000 });
        if (merged.status === null || merged.status < 0 || merged.status > 127) throw new Error("OmMergeFailed");
        if (merged.status !== 0) conflicts.push(edit.path);
        result.push({ path: edit.path, content: merged.stdout });
      }
      return { edits: result, conflicts };
    } finally { rmSync(directory, { recursive: true, force: true }); }
  }
  organizationMerge(baseRevision: string, upstreamRevision: string) {
    const ancestor = git(this.projectDir, ["merge-base", baseRevision, upstreamRevision]);
    const files = new Set(this.listFiles(upstreamRevision));
    const changed = git(this.projectDir, ["diff", "--name-only", ancestor, upstreamRevision]).split("\n").filter(Boolean);
    return this.mergeOmEdits(ancestor, baseRevision, changed.map((path) => ({ path, content: files.has(path) ? this.document(upstreamRevision, path) : null })));
  }
  checkIncomingHistory(baseRevision: string, revision: string) {
    if (!/^[0-9a-f]{40}$/.test(baseRevision) || !/^[0-9a-f]{40}$/.test(revision) || !this.includesRevision(revision, baseRevision)) throw new Error("OmNonFastForward");
    const commits = git(this.projectDir, ["rev-list", revision, `^${baseRevision}`]).split("\n").filter(Boolean);
    if (commits.length > 1000) throw new Error("OmHistoryTooLarge");
    for (const commit of commits) this.checkExportTree(commit);
  }
  checkExportTree(revision: string) {
    const tree = git(this.projectDir, ["rev-parse", `${revision}^{tree}`]);
    if (this.checkedTrees.has(tree)) return;
    const entries = git(this.projectDir, ["ls-tree", "-r", "-l", "-z", "--full-tree", tree]).split("\0").filter(Boolean);
    if (entries.length > 10_000) throw new Error("OmTreeTooLarge");
    for (const entry of entries) {
      const match = /^(100644|100755) blob ([0-9a-f]{40})\s+(\d+)\t(.+)$/.exec(entry);
      if (!match || !isAllowedOmDocumentPath(match[4])) throw new Error("OmPathNotAllowed");
      if (Number(match[3]) > 100_000) throw new Error("OmFileTooLarge");
    }
    this.checkedTrees.add(tree);
  }
}
