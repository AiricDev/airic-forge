import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { isAllowedOmDocumentPath, type OmDraft, type OmWorkspace, type OmWorkspacePort } from "@airic-forge/domain";
import { git, type PersonalGitOperatingModel } from "./personal-git-om.js";

/** Metadata describes an unfinished conversation; file content lives only in the worktree. */
type DraftContext = Pick<OmWorkspace, "summary" | "conflicts" | "upstreamRevision">;

export class GitOmWorkspaces implements OmWorkspacePort {
  constructor(private readonly om: PersonalGitOperatingModel) {}

  directory(owner: string, scope: string) {
    if (!/^[a-zA-Z0-9_-]+$/.test(owner) || !/^(manual|sync|reflection:[a-zA-Z0-9_-]+|archive:[a-zA-Z0-9_-]+)$/.test(scope)) throw new Error("InvalidOmScope");
    const directory = resolve(realpathSync(this.om.dataDir), "worktrees", "drafts", owner, scope);
    let current = directory;
    while (current !== dirname(current)) {
      if (lstatSync(current, { throwIfNoEntry: false })?.isSymbolicLink()) throw new Error("OmDraftSymlinkNotAllowed");
      current = dirname(current);
    }
    return directory;
  }

  private contextPath(directory: string) {
    return resolve(directory, git(directory, ["rev-parse", "--git-path", "forge-draft.json"]));
  }

  private destination(directory: string, path: string) {
    if (!isAllowedOmDocumentPath(path)) throw new Error("OmPathNotAllowed");
    let destination = directory;
    for (const part of path.split("/")) {
      destination = join(destination, part);
      if (lstatSync(destination, { throwIfNoEntry: false })?.isSymbolicLink()) throw new Error("OmDraftSymlinkNotAllowed");
    }
    return destination;
  }

  workspace(ownerUserId: string, scope: string): OmWorkspace | undefined {
    const directory = this.directory(ownerUserId, scope);
    if (!existsSync(directory)) return undefined;
    const baseRevision = git(directory, ["rev-parse", "HEAD"]);
    const context = JSON.parse(readFileSync(this.contextPath(directory), "utf8")) as DraftContext;
    const paths = [...new Set([
      ...git(directory, ["diff", "--no-renames", "--name-only", "-z", "HEAD"]).split("\0"),
      ...git(directory, ["ls-files", "--others", "--exclude-standard", "-z"]).split("\0"),
    ].filter(Boolean))].sort();
    const edits = paths.map((path) => {
      const destination = this.destination(directory, path);
      if (existsSync(destination) && !lstatSync(destination).isFile()) throw new Error("OmDocumentNotRegularFile");
      return { path, content: existsSync(destination) ? readFileSync(destination, "utf8") : null };
    });
    return { ownerUserId, scope, baseRevision, ...context, edits };
  }

  workspaces(owner: string): OmWorkspace[] {
    const root = dirname(this.directory(owner, "manual"));
    return existsSync(root) ? readdirSync(root).sort().map((scope) => this.workspace(owner, scope)!).filter(Boolean) : [];
  }

  saveWorkspace(workspace: OmWorkspace): void {
    const { ownerUserId, scope, baseRevision, edits, summary, conflicts, upstreamRevision } = workspace;
    const directory = this.directory(ownerUserId, scope);
    for (const edit of edits) this.destination(directory, edit.path);
    const previous = this.workspace(ownerUserId, scope);
    if (!previous) {
      mkdirSync(dirname(directory), { recursive: true });
      git(this.om.projectDir, ["worktree", "add", "--detach", directory, baseRevision]);
    } else {
      const tracked = new Set(this.om.listFiles(previous.baseRevision));
      for (const edit of previous.edits) {
        if (tracked.has(edit.path)) git(directory, ["restore", "--source=HEAD", "--staged", "--worktree", "--", edit.path]);
        else rmSync(this.destination(directory, edit.path), { force: true });
      }
      if (previous.baseRevision !== baseRevision) git(directory, ["checkout", "--detach", baseRevision]);
    }
    for (const edit of edits) {
      const destination = this.destination(directory, edit.path);
      if (edit.content === null) rmSync(destination, { force: true });
      else { mkdirSync(dirname(destination), { recursive: true }); writeFileSync(destination, edit.content); }
    }
    writeFileSync(this.contextPath(directory), JSON.stringify({ summary, conflicts, ...(upstreamRevision ? { upstreamRevision } : {}) }));
  }

  discardWorkspace(owner: string, scope: string): void {
    const directory = this.directory(owner, scope);
    if (existsSync(directory)) git(this.om.projectDir, ["worktree", "remove", "--force", directory]);
  }

  draftsForUser(owner: string): OmDraft[] {
    const draft = this.workspace(owner, "manual");
    if (!draft) return [];
    const updatedAt = statSync(this.contextPath(this.directory(owner, "manual"))).mtime.toISOString();
    return draft.edits.filter((edit) => edit.content !== null).map((edit) => ({ ownerUserId: owner, path: edit.path, content: edit.content!, baseRevision: draft.baseRevision, updatedAt }));
  }
  saveDraft(draft: OmDraft): void {
    const current = this.workspace(draft.ownerUserId, "manual");
    this.saveWorkspace({ ownerUserId: draft.ownerUserId, scope: "manual", baseRevision: draft.baseRevision, summary: current?.summary || "Update personal OM", conflicts: [], edits: [...(current?.edits ?? []).filter((edit) => edit.path !== draft.path), { path: draft.path, content: draft.content }] });
  }
  discardDraft(owner: string, path: string): void {
    const current = this.workspace(owner, "manual");
    if (current) this.saveWorkspace({ ...current, edits: current.edits.filter((edit) => edit.path !== path) });
  }
}
