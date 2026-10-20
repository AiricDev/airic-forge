import { isAllowedOmDocumentPath, validateWorkDefinition } from "./operating-model.js";
import type { AccountPort, CatalogPort, OperatingModelPort, SystemPort } from "./ports.js";

export interface OmEdit { path: string; content: string | null; }
/** Saved editing state, not an approval entity. Scope separates independent discussions. */
export interface OmWorkspace {
  ownerUserId: string;
  scope: string;
  baseRevision: string;
  edits: OmEdit[];
  summary: string;
  conflicts: string[];
  upstreamRevision?: string;
}
export interface OmWorkspacePort {
  workspace(ownerUserId: string, scope: string): OmWorkspace | undefined;
  workspaces(ownerUserId: string): OmWorkspace[];
  saveWorkspace(workspace: OmWorkspace): void;
  discardWorkspace(ownerUserId: string, scope: string): void;
}
export interface OmRevisionPort {
  routeKnowledge(baseRevision: string, edits: OmEdit[], workDefinitionId: string): OmEdit[];
  prepareOmCommit(input: { ownerUserId: string; baseRevision: string; edits: OmEdit[]; summary: string; trailers: Record<string, string>; upstreamRevision?: string }): string;
  publishOmCommit(ownerUserId: string, expectedRevision: string, revision: string): string;
  commitForRequest(ownerUserId: string, requestId: string): { revision: string; digest: string } | undefined;
  mergeOmEdits(baseRevision: string, activeRevision: string, edits: OmEdit[]): { edits: OmEdit[]; conflicts: string[] };
  organizationMerge(baseRevision: string, upstreamRevision: string): { edits: OmEdit[]; conflicts: string[] };
  checkIncomingHistory(baseRevision: string, revision: string): void;
}

export class PersonalOmChanges {
  private readonly writers = new Set<string>();
  constructor(private readonly ports: { accounts: AccountPort; catalogs: CatalogPort; om: OperatingModelPort & OmRevisionPort; drafts: OmWorkspacePort; system: SystemPort }) {}

  async own(actor: string, owner: string) {
    if (actor !== owner || !await this.ports.accounts.userById(actor)) throw new Error("Forbidden");
  }
  routeKnowledge(baseRevision: string, edits: OmEdit[], workDefinitionId: string) {
    return this.ports.om.routeKnowledge(baseRevision, edits, workDefinitionId);
  }
  async write<T>(owner: string, action: () => Promise<T>): Promise<T> {
    if (this.writers.has(owner)) throw new Error("OmWriteInProgress");
    this.writers.add(owner);
    try { return await action(); } finally { this.writers.delete(owner); }
  }
  async validate(revision: string) {
    const catalog = await this.ports.catalogs.accepted("certlab");
    if (!catalog) throw new Error("CapabilityCatalogNotAccepted");
    const issues = await this.ports.om.knowledgeIssues(revision);
    const known = await this.ports.om.knownKnowledge(revision);
    const files = await this.ports.om.listFiles(revision);
    for (const path of files.filter((path) => /^work-definitions\/[a-z0-9-]+\/work\.yml$/.test(path))) {
      const definition = await this.ports.om.workDefinition(revision, path.split("/")[1]);
      issues.push(...validateWorkDefinition(definition, new Set(catalog.capabilities.map((item) => item.id)), known));
      for (const document of definition.documents) {
        try { await this.ports.om.document(revision, `work-definitions/${definition.id}/${document.path}`); }
        catch { issues.push({ path, message: `missing document ${document.path}` }); }
      }
    }
    if (issues.length) throw new Error(`InvalidOperatingModel: ${issues.map((item) => `${item.path} ${item.message}`).join("; ")}`);
  }
  async read(actor: string, scope: string) {
    await this.own(actor, actor);
    if (!/^(manual|sync|reflection:[a-zA-Z0-9_-]+|archive:[a-zA-Z0-9_-]+)$/.test(scope)) throw new Error("InvalidOmScope");
    const draft = this.ports.drafts.workspace(actor, scope);
    const activeRevision = await this.ports.om.head(`users/${actor}`);
    const workspace = draft ?? { ownerUserId: actor, scope, baseRevision: activeRevision, edits: [], summary: "", conflicts: [] };
    return { ...workspace, activeRevision, digest: this.ports.system.digest(JSON.stringify(workspace)) };
  }
  async save(actor: string, scope: string, input: { baseRevision: string; edits: OmEdit[]; summary: string }) {
    return this.write(actor, async () => {
    await this.own(actor, actor);
    await this.read(actor, scope);
    if (!/^[0-9a-f]{40}$/.test(input.baseRevision) || !await this.ports.om.containsRevision(`users/${actor}`, input.baseRevision)) throw new Error("OmRevisionNotReachable");
    if (!input.summary.trim() || input.summary.length > 1000 || input.edits.length > 1000
      || new Set(input.edits.map((edit) => edit.path)).size !== input.edits.length
      || input.edits.some((edit) => !isAllowedOmDocumentPath(edit.path) || (edit.content !== null && (typeof edit.content !== "string" || new TextEncoder().encode(edit.content).byteLength > 100_000)))) throw new Error("InvalidOmDraft");
    const previous = this.ports.drafts.workspace(actor, scope);
    this.ports.drafts.saveWorkspace({ ownerUserId: actor, scope, ...input, summary: input.summary.trim(), conflicts: [], ...(previous?.upstreamRevision ? { upstreamRevision: previous.upstreamRevision } : {}) });
    return this.read(actor, scope);
    });
  }
  async discard(actor: string, scope: string) {
    return this.write(actor, async () => {
      await this.read(actor, scope);
      this.ports.drafts.discardWorkspace(actor, scope);
    });
  }
  async rebase(actor: string, scope: string) {
    return this.write(actor, async () => {
      const draft = await this.read(actor, scope);
      const merged = this.ports.om.mergeOmEdits(draft.baseRevision, draft.activeRevision, draft.edits);
      this.ports.drafts.saveWorkspace({ ownerUserId: actor, scope, baseRevision: draft.activeRevision, summary: draft.summary, ...merged, ...(draft.upstreamRevision ? { upstreamRevision: draft.upstreamRevision } : {}) });
      return this.read(actor, scope);
    });
  }
  async sync(actor: string) {
    return this.write(actor, async () => {
      await this.own(actor, actor);
      if (this.ports.drafts.workspace(actor, "sync")) throw new Error("OmSyncDraftExists");
      const baseRevision = await this.ports.om.head(`users/${actor}`);
      const upstreamRevision = await this.ports.om.head("main");
      if (await this.ports.om.includesRevision(`users/${actor}`, upstreamRevision)) throw new Error("OrganizationAlreadyCurrent");
      const merged = this.ports.om.organizationMerge(baseRevision, upstreamRevision);
      this.ports.drafts.saveWorkspace({ ownerUserId: actor, scope: "sync", baseRevision, upstreamRevision, summary: "Synchronize organization OM", ...merged });
      return this.read(actor, "sync");
    });
  }
  async commit(actor: string, scope: string, digest: string, requestId: string) {
    await this.own(actor, actor);
    if (!/^[a-zA-Z0-9_-]{8,100}$/.test(requestId)) throw new Error("OmRequestIdRequired");
    return this.write(actor, async () => {
      const receipt = this.ports.om.commitForRequest(actor, requestId);
      if (receipt) {
        if (receipt.digest !== digest) throw new Error("OmRequestConflict");
        const current = await this.read(actor, scope);
        if (current.digest === digest) this.ports.drafts.discardWorkspace(actor, scope);
        return { revision: receipt.revision };
      }
      const draft = await this.read(actor, scope);
      if (draft.digest !== digest) throw new Error("OmDraftChanged");
      if (draft.baseRevision !== draft.activeRevision) throw new Error("ActiveRevisionChanged");
      if (draft.conflicts.length || draft.edits.some((edit) => edit.content && /^(<<<<<<< |=======\s*$|>>>>>>> )/m.test(edit.content))) throw new Error("OmMergeConflict");
      if (!draft.edits.length && !draft.upstreamRevision) throw new Error("OmHasNoChanges");
      if (draft.upstreamRevision && await this.ports.om.head("main") !== draft.upstreamRevision) throw new Error("OrganizationRevisionChanged");
      const revision = this.ports.om.prepareOmCommit({ ownerUserId: actor, baseRevision: draft.baseRevision, edits: draft.edits, summary: draft.summary,
        trailers: { "AiricForge-Request": requestId, "AiricForge-Digest": digest, "AiricForge-Source": scope }, upstreamRevision: draft.upstreamRevision });
      this.ports.om.checkIncomingHistory(draft.baseRevision, revision);
      await this.validate(revision);
      this.ports.om.publishOmCommit(actor, draft.baseRevision, revision);
      this.ports.drafts.discardWorkspace(actor, scope);
      return { revision };
    });
  }
  async publish(actor: string, expectedRevision: string, revision: string) {
    await this.own(actor, actor);
    return this.write(actor, async () => {
      if (await this.ports.om.head(`users/${actor}`) !== expectedRevision) throw new Error("ActiveRevisionChanged");
      this.ports.om.checkIncomingHistory(expectedRevision, revision);
      await this.validate(revision);
      return { revision: this.ports.om.publishOmCommit(actor, expectedRevision, revision) };
    });
  }
}
