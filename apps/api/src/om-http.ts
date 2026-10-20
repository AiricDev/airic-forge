import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { OmEdit } from "@airic-forge/domain";
import type { ForgeRuntime } from "./runtime.js";
import { cookieToken } from "./web-session-store.js";

export function registerOmHttp(app: FastifyInstance, runtime: ForgeRuntime) {
  const authorized = (request: FastifyRequest) => {
    const actor = runtime.webSessions.userId(cookieToken(request.headers.cookie));
    if (!actor) throw new Error("Unauthorized");
    if (request.method !== "GET" && (request.headers["sec-fetch-site"] === "cross-site" || (request.headers.origin && ![runtime.config.allowedOrigin, runtime.config.publicUrl, `${request.protocol}://${request.headers.host}`].includes(request.headers.origin)))) throw new Error("Forbidden");
    return actor;
  };
  const respond = async (request: FastifyRequest, reply: FastifyReply, action: (actor: string) => Promise<unknown>) => {
    try { return reply.send(await action(authorized(request))); }
    catch (error) {
      const code = error instanceof Error ? error.message : "";
      const safe = /^(Unauthorized|Forbidden|ReflectionNotOwned|ReflectionAlreadyRunning|Om[A-Za-z]+|ActiveRevisionChanged|OrganizationRevisionChanged|OrganizationAlreadyCurrent|InvalidOmDraft|InvalidGitToken|ReflectionMessageRequired|CapabilityCatalogNotAccepted|UserWorktreeDirty)$/.test(code) ? code : code.startsWith("InvalidOperatingModel:") ? code : "OmRequestFailed";
      return reply.code(code === "Unauthorized" ? 401 : ["Forbidden", "ReflectionNotOwned"].includes(code) ? 403 : /Changed|Conflict|InProgress|Running|Exists/.test(code) ? 409 : 400).send({ error: safe });
    }
  };
  app.get("/api/v1/reflections", (request, reply) => respond(request, reply, async (actor) => ({ reflections: await runtime.useCases.personalReflections(actor) })));
  app.post<{ Body: { question: string } }>("/api/v1/reflections", (request, reply) => respond(request, reply, (actor) => runtime.useCases.openPersonalReflection(actor, request.body?.question)));
  app.get("/api/v1/om/workspaces", (request, reply) => respond(request, reply, async (actor) => ({ workspaces: runtime.db.workspaces(actor) })));
  app.get<{ Params: { scope: string } }>("/api/v1/om/workspaces/:scope", (request, reply) => respond(request, reply, (actor) => runtime.omChanges.read(actor, request.params.scope)));
  app.put<{ Params: { scope: string }; Body: { baseRevision: string; edits: OmEdit[]; summary: string } }>("/api/v1/om/workspaces/:scope", (request, reply) => respond(request, reply, (actor) => runtime.useCases.mutateOmDraft(actor, request.params.scope, () => runtime.omChanges.save(actor, request.params.scope, request.body))));
  app.delete<{ Params: { scope: string } }>("/api/v1/om/workspaces/:scope", (request, reply) => respond(request, reply, async (actor) => {
    await runtime.useCases.mutateOmDraft(actor, request.params.scope, () => runtime.omChanges.discard(actor, request.params.scope)); return { discarded: true };
  }));
  app.post<{ Params: { scope: string } }>("/api/v1/om/workspaces/:scope/rebase", (request, reply) => respond(request, reply, (actor) => runtime.useCases.mutateOmDraft(actor, request.params.scope, () => runtime.omChanges.rebase(actor, request.params.scope))));
  app.post<{ Params: { scope: string }; Body: { digest: string; requestId: string } }>("/api/v1/om/workspaces/:scope/commit", (request, reply) => respond(request, reply, (actor) => runtime.useCases.mutateOmDraft(actor, request.params.scope, () => runtime.omChanges.commit(actor, request.params.scope, request.body?.digest, request.body?.requestId))));
  app.post("/api/v1/om/sync", (request, reply) => respond(request, reply, (actor) => runtime.omChanges.sync(actor)));
  app.get("/api/v1/git/tokens", (request, reply) => respond(request, reply, async (actor) => ({ tokens: await runtime.gitAccess.list(actor), cloneUrl: `${runtime.config.publicUrl ?? `http://127.0.0.1:${runtime.config.port}`}/git/personal/${actor}.git` })));
  app.post<{ Body: { name: string; days?: number } }>("/api/v1/git/tokens", (request, reply) => respond(request, reply, (actor) => runtime.gitAccess.issue(actor, request.body?.name, request.body?.days)));
  app.delete<{ Params: { id: string } }>("/api/v1/git/tokens/:id", (request, reply) => respond(request, reply, async (actor) => { await runtime.gitAccess.revoke(actor, request.params.id); return { revoked: true }; }));
}
