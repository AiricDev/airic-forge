import { loadAppPort } from "./app-adapter.js";
import { bindInstanceRoots } from "./instance-binding.js";
import { acquireServiceLock } from "./service-lock.js";
import { checkAgentResources, resolveAgentResources } from "./agent-resources.js";
import { registerUserHttp } from "./user-http.js";
import Fastify from "fastify";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import { loadConfig } from "./config.js";
import { ForgeRuntime } from "./runtime.js";
import { cookieToken, sessionCookie } from "./web-session-store.js";
import { fileURLToPath } from "node:url";
import { readFile, access } from "node:fs/promises";
import { join } from "node:path";
import { registerReflectionHttp } from "./reflection-http.js";
import { registerOmHttp } from "./om-http.js";
import { registerGitHttp } from "./git-http.js";

type BootstrapBody = { appId: string; workType: string; entityId: string; selection?: Record<string, unknown>; workId?: string };
type RpcRequest = { id?: string | number; method?: string; params?: Record<string, unknown> };

const bearer = (value: unknown): string => {
  const header = String(value ?? ""); const match = /^Bearer\s+(.+)$/i.exec(header);
  if (!match) throw new Error("MissingBearerToken"); return match[1];
};

export function buildServer(runtime = new ForgeRuntime(loadConfig())) {
  runtime.bindUserLifecycle();
  const app = Fastify({ logger: true, bodyLimit: 9 * 1024 * 1024, trustProxy: runtime.config.trustedProxy ?? false });
  void app.register(cors, { origin: runtime.config.allowedOrigin, credentials: true });
  void app.register(websocket);
  registerUserHttp(app, runtime);
  registerReflectionHttp(app, runtime);
  registerOmHttp(app, runtime);
  registerGitHttp(app, runtime);
  app.addContentTypeParser(/^(application\/pdf|application\/octet-stream|application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.document|text\/plain)$/i, { parseAs: "buffer" }, (_request, body, done) => done(null, body));

  app.get("/health", async () => ({ status: "ok", service: "airic-forge" }));

  const sendWorkspace = async (reply: import("fastify").FastifyReply) => {
    try { return reply.type("text/html; charset=utf-8").send(await readFile(join(runtime.config.webDistDir, "index.html"))); }
    catch { return reply.type("application/json").code(404).send({ error: "WebWorkspaceNotBuilt" }); }
  };
  app.get("/", async (_request, reply) => sendWorkspace(reply));
  app.get("/reflections", async (_request, reply) => sendWorkspace(reply));
  app.get("/reflections/:reflectionId", async (_request, reply) => sendWorkspace(reply));
  app.get("/works", async (_request, reply) => sendWorkspace(reply));
  app.get<{ Params: { workId: string } }>("/works/:workId", async (_request, reply) => sendWorkspace(reply));
  app.get<{ Params: { file: string } }>("/assets/:file", async (request, reply) => {
    const file = request.params.file;
    if (!/^[a-zA-Z0-9_.-]+$/.test(file)) return reply.code(404).send({ error: "NotFound" });
    const type = file.endsWith(".js") ? "text/javascript" : file.endsWith(".css") ? "text/css" : file.endsWith(".svg") ? "image/svg+xml" : file.endsWith(".woff2") ? "font/woff2" : file.endsWith(".woff") ? "font/woff" : "application/octet-stream";
    try { return reply.type(type).send(await readFile(join(runtime.config.webDistDir, "assets", file))); }
    catch { return reply.code(404).send({ error: "NotFound" }); }
  });

  app.post<{ Body: BootstrapBody }>("/api/v1/app-sessions/bootstrap", async (request, reply) => {
    try {
      const body = request.body;
      if (typeof body.appId !== "string" || !body.appId || (runtime.config.appId !== undefined && body.appId !== runtime.config.appId) || typeof body.workType !== "string" || !body.workType || typeof body.entityId !== "string" || !body.entityId || Object.keys(body).some(key => !["appId", "workType", "entityId", "selection", "workId"].includes(key))) return reply.code(400).send({ error: "UnsupportedAppContext" });
      const result = await runtime.useCases.bootstrap({ token: bearer(request.headers.authorization), appId: body.appId, entityId: body.entityId, workType: body.workType, selection: body.selection, workId: body.workId });
      const workspaceAvailable = await access(join(runtime.config.webDistDir, "index.html")).then(() => true, () => false);
      return reply.code(201).send({ ...result, acpUrl: "/acp", workspaceAvailable, workspaceUrl: runtime.config.publicUrl ?? "http://127.0.0.1:4175" });
    } catch (error) { return reply.code(401).send({ error: error instanceof Error ? error.message : "BootstrapFailed" }); }
  });

  app.post<{ Body: {appId:string; workType:string; entityId: string } }>("/api/v1/app-sessions/works", async (request, reply) => {
    try { return reply.send(await runtime.useCases.appWorks(bearer(request.headers.authorization), request.body.entityId, request.body.workType, request.body.appId)); }
    catch (error) { return reply.code(403).send({ error: error instanceof Error ? error.message : "AppWorksFailed" }); }
  });

  app.put("/api/v1/app-sessions/evidence", async (request, reply) => {
    try {
      const encodedName = String(request.headers["x-forge-filename"] ?? "");
      if (!encodedName || encodedName.length > 400 || !Buffer.isBuffer(request.body)) throw new Error("InvalidEvidenceUpload");
      const filename = decodeURIComponent(encodedName);
      return reply.code(201).send(await runtime.useCases.attachEvidence(String(request.headers["x-forge-ticket"] ?? ""), filename, String(request.headers["content-type"] ?? ""), request.body));
    } catch (error) { return reply.code(400).send({ error: error instanceof Error ? error.message : "EvidenceUploadFailed" }); }
  });

  app.post<{ Params: { ticket: string }; Body: { password: string } }>("/api/v1/app-sessions/:ticket/password", async (request, reply) => {
    try {
      await runtime.useCases.setPassword(request.params.ticket, request.body.password);
      return reply.code(204).send();
    } catch (error) { return reply.code(400).send({ error: error instanceof Error ? error.message : "PasswordSetupFailed" }); }
  });




  app.get("/api/v1/agent-environment", async (request, reply) => {
    const actor = runtime.webSessions.userId(cookieToken(request.headers.cookie));
    if (!actor) return reply.code(401).send({ error: "Unauthorized" });
    try {
      await runtime.useCases.instanceSettings(actor);
      const [work, reflection] = await Promise.all([resolveAgentResources(runtime.config, "work"), resolveAgentResources(runtime.config, "reflection")]);
      return { deploymentId: runtime.config.deploymentId ?? "source", work: { digest: work.digest, files: work.files }, reflection: { digest: reflection.digest, files: reflection.files } };
    } catch (error) { return reply.code(error instanceof Error && error.message === "Forbidden" ? 403 : 503).send({ error: "AgentEnvironmentUnavailable" }); }
  });

  app.get("/api/v1/instance-settings", async (request, reply) => {
    const actorId = runtime.webSessions.userId(cookieToken(request.headers.cookie));
    if (!actorId) return reply.code(401).send({ error: "Unauthorized" });
    try { return reply.send(await runtime.useCases.instanceSettings(actorId)); }
    catch (error) {
      const forbidden = error instanceof Error && error.message === "Forbidden";
      return reply.code(forbidden ? 403 : 500).send({ error: forbidden ? "Forbidden" : "InstanceSettingsUnavailable" });
    }
  });


  app.post<{ Body: { email: string; password: string } }>("/api/v1/auth/login", async (request, reply) => {
    const user = await runtime.useCases.login(request.body.email, request.body.password);
    if (!user) return reply.code(401).send({ error: "InvalidCredentials" });
    let token: string;
    try { token = await runtime.useCases.users.withActive(user.id, async () => runtime.webSessions.issue(user.id)); }
    catch { return reply.code(401).send({ error: "InvalidCredentials" }); }
    reply.header("Set-Cookie", sessionCookie(token, request.protocol === "https"));
    const testIdentitySwitch = runtime.config.testIdentitySwitch && user.role === "admin"
      ? { originalUserId: user.id, users: await runtime.useCases.listUsers(user.id) } : undefined;
    return reply.send({ user, ...(testIdentitySwitch ? { testIdentitySwitch } : {}) });
  });

  app.get("/api/v1/auth/me", async (request, reply) => {
    const token = cookieToken(request.headers.cookie);
    const userId = runtime.webSessions.userId(token);
    if (!userId) return reply.code(401).send({ error: "Unauthorized" });
    const user = await runtime.useCases.webUser(userId);
    if (!user) return reply.code(401).send({ error: "Unauthorized" });
    const originalUserId = runtime.webSessions.originalUserId(token);
    const originalUser = originalUserId ? await runtime.useCases.webUser(originalUserId) : undefined;
    const testIdentitySwitch = runtime.config.testIdentitySwitch && originalUser?.role === "admin" && originalUser.status === "active"
      ? { originalUserId, users: await runtime.useCases.listUsers(originalUser.id) } : undefined;
    return reply.send({ user, ...(testIdentitySwitch ? { testIdentitySwitch } : {}) });
  });

  app.post<{ Body: { userId: string } }>("/api/v1/auth/test-identity", async (request, reply) => {
    if (!runtime.config.testIdentitySwitch) return reply.code(404).send({ error: "NotFound" });
    const token = cookieToken(request.headers.cookie);
    const originalUserId = runtime.webSessions.originalUserId(token);
    if (!originalUserId) return reply.code(401).send({ error: "Unauthorized" });
    const originalUser = await runtime.useCases.webUser(originalUserId);
    if (originalUser?.role !== "admin" || originalUser.status !== "active") return reply.code(403).send({ error: "Forbidden" });
    const user = await runtime.useCases.webUser(request.body?.userId);
    if (!user || user.status !== "active") return reply.code(404).send({ error: "UserNotFound" });
    runtime.webSessions.switchUser(token, user.id);
    return reply.send({ user });
  });

  app.get("/api/v1/users", async (request, reply) => {
    const actorId = runtime.webSessions.userId(cookieToken(request.headers.cookie));
    if (!actorId) return reply.code(401).send({ error: "Unauthorized" });
    try { return reply.send({ users: await runtime.useCases.listUsers(actorId) }); }
    catch { return reply.code(403).send({ error: "Forbidden" }); }
  });

  app.get<{ Params: { ownerId: string }; Querystring: { page?: string } }>("/api/v1/users/:ownerId/works", async (request, reply) => {
    const actorId = runtime.webSessions.userId(cookieToken(request.headers.cookie));
    if (!actorId) return reply.code(401).send({ error: "Unauthorized" });
    const rawPage = request.query.page ?? "1";
    if (!/^[1-9]\d{0,5}$/.test(rawPage) || Number(rawPage) > 100_000) return reply.code(400).send({ error: "InvalidWorkPage" });
    try { return reply.send(await runtime.useCases.worksForUser(actorId, request.params.ownerId, Number(rawPage))); }
    catch { return reply.code(403).send({ error: "Forbidden" }); }
  });

  app.get<{ Querystring: { page?: string; ownerId?: string; workType?: string; status?: string } }>("/api/v1/works", async (request, reply) => {
    const actorId = runtime.webSessions.userId(cookieToken(request.headers.cookie));
    if (!actorId) return reply.code(401).send({ error: "Unauthorized" });
    const rawPage = request.query.page ?? "1";
    if (!/^[1-9]\d{0,5}$/.test(rawPage) || Number(rawPage) > 100_000) return reply.code(400).send({ error: "InvalidWorkPage" });
    try { return reply.send(await runtime.useCases.listWorks(actorId, { ...(request.query.ownerId ? { ownerUserId: request.query.ownerId } : {}), ...(request.query.workType ? { workType: request.query.workType as string } : {}), ...(request.query.status ? { status: request.query.status as "active" | "completed" } : {}) }, Number(rawPage))); }
    catch (error) { return reply.code(error instanceof Error && error.message === "Forbidden" ? 403 : 400).send({ error: error instanceof Error ? error.message : "WorkListFailed" }); }
  });

  app.get<{ Params: { workId: string } }>("/api/v1/works/:workId", async (request, reply) => {
    const actorId = runtime.webSessions.userId(cookieToken(request.headers.cookie));
    if (!actorId) return reply.code(401).send({ error: "Unauthorized" });
    try { return reply.send(await runtime.useCases.workHistory(actorId, request.params.workId)); }
    catch (error) { return reply.code(error instanceof Error && error.message === "WorkNotFound" ? 404 : 403).send({ error: error instanceof Error ? error.message : "Forbidden" }); }
  });
  app.get<{ Params: { workId: string } }>("/api/v1/works/:workId/feedback", async (request, reply) => {
    const actorId = runtime.webSessions.userId(cookieToken(request.headers.cookie));
    if (!actorId) return reply.code(401).send({ error: "Unauthorized" });
    try { return reply.send({ feedback: await runtime.useCases.workFeedback(actorId, request.params.workId) }); }
    catch (error) { return reply.code(403).send({ error: error instanceof Error ? error.message : "Forbidden" }); }
  });
  app.post<{ Params: { workId: string }; Body: { kind: "required-human-decision" | "avoidable-correction" | "knowledge-helpful" | "work-outcome-correct" | "work-outcome-incorrect"; note: string } }>("/api/v1/works/:workId/feedback", async (request, reply) => {
    const actorId = runtime.webSessions.userId(cookieToken(request.headers.cookie));
    if (!actorId) return reply.code(401).send({ error: "Unauthorized" });
    try { return reply.code(201).send(await runtime.useCases.addWorkFeedback(actorId, request.params.workId, request.body.kind, request.body.note)); }
    catch (error) { return reply.code(error instanceof Error && error.message === "Forbidden" ? 403 : 400).send({ error: error instanceof Error ? error.message : "FeedbackRejected" }); }
  });
  app.get("/api/v1/measurements/baseline", async (request, reply) => {
    const actorId = runtime.webSessions.userId(cookieToken(request.headers.cookie));
    if (!actorId) return reply.code(401).send({ error: "Unauthorized" });
    try { return reply.send(await runtime.useCases.measurementBaseline(actorId)); }
    catch (error) { return reply.code(403).send({ error: error instanceof Error ? error.message : "Forbidden" }); }
  });

  app.post<{ Params: { commandId: string } }>("/api/v1/commands/:commandId/recover", async (request, reply) => {
    try { return reply.send(await runtime.useCases.recoverCommand(String(request.headers["x-forge-ticket"] ?? ""), request.params.commandId)); }
    catch (error) { return reply.code(403).send({ error: error instanceof Error ? error.message : "CommandRecoveryFailed" }); }
  });

  app.get<{ Params: { workId: string } }>("/api/v1/app-sessions/works/:workId/trajectory", async (request, reply) => {
    try { return reply.send({ events: await runtime.useCases.trajectory(String(request.headers["x-forge-ticket"] ?? ""), request.params.workId) }); }
    catch (error) { return reply.code(403).send({ error: error instanceof Error ? error.message : "TrajectoryUnavailable" }); }
  });

  app.post<{ Params: { workId: string } }>("/api/v1/app-sessions/works/:workId/complete", async (request, reply) => {
    try { await runtime.useCases.completeWork(String(request.headers["x-forge-ticket"] ?? ""), request.params.workId); return reply.code(204).send(); }
    catch (error) { return reply.code(403).send({ error: error instanceof Error ? error.message : "WorkCompletionFailed" }); }
  });

  app.get<{ Params: { ownerId: string }; Querystring: { revision?: string } }>("/api/v1/om/users/:ownerId", async (request, reply) => {
    const actorId = runtime.webSessions.userId(cookieToken(request.headers.cookie));
    if (!actorId) return reply.code(401).send({ error: "Unauthorized" });
    try { return reply.send(await runtime.useCases.personalOm(actorId, request.params.ownerId, request.query.revision)); }
    catch (error) { return reply.code(error instanceof Error && error.message === "OmRevisionNotReachable" ? 404 : 403).send({ error: error instanceof Error ? error.message : "Forbidden" }); }
  });

  app.get<{ Params: { ownerId: string } }>("/api/v1/om/users/:ownerId/history", async (request, reply) => {
    const actorId = runtime.webSessions.userId(cookieToken(request.headers.cookie));
    if (!actorId) return reply.code(401).send({ error: "Unauthorized" });
    try { return reply.send({ commits: await runtime.useCases.personalOmHistory(actorId, request.params.ownerId) }); }
    catch { return reply.code(403).send({ error: "Forbidden" }); }
  });

  app.get<{ Params: { ownerId: string }; Querystring: { path: string; revision?: string } }>("/api/v1/om/users/:ownerId/file", async (request, reply) => {
    const actorId = runtime.webSessions.userId(cookieToken(request.headers.cookie));
    if (!actorId) return reply.code(401).send({ error: "Unauthorized" });
    try { return reply.send(await runtime.useCases.personalOmFile(actorId, request.params.ownerId, request.query.path, request.query.revision)); }
    catch (error) { return reply.code(error instanceof Error && error.message === "Forbidden" ? 403 : 404).send({ error: error instanceof Error ? error.message : "OmFileNotFound" }); }
  });

  app.get<{ Params: { ownerId: string }; Querystring: { path: string; revision?: string } }>("/api/v1/om/users/:ownerId/manifest", async (request, reply) => {
    const actorId = runtime.webSessions.userId(cookieToken(request.headers.cookie));
    if (!actorId) return reply.code(401).send({ error: "Unauthorized" });
    try { return reply.send(await runtime.useCases.personalOmManifest(actorId, request.params.ownerId, request.query.path, request.query.revision)); }
    catch (error) { return reply.code(error instanceof Error && error.message === "Forbidden" ? 403 : 404).send({ error: error instanceof Error ? error.message : "OmManifestNotFound" }); }
  });

  app.get<{ Params: { ownerId: string } }>("/api/v1/om/users/:ownerId/drafts", async (request, reply) => {
    const actorId = runtime.webSessions.userId(cookieToken(request.headers.cookie));
    if (!actorId) return reply.code(401).send({ error: "Unauthorized" });
    try { return reply.send({ drafts: await runtime.useCases.personalOmDrafts(actorId, request.params.ownerId) }); }
    catch (error) { return reply.code(403).send({ error: error instanceof Error ? error.message : "Forbidden" }); }
  });
  app.put<{ Params: { ownerId: string }; Body: { path: string; content: string; baseRevision: string } }>("/api/v1/om/users/:ownerId/drafts", async (request, reply) => {
    const actorId = runtime.webSessions.userId(cookieToken(request.headers.cookie));
    if (!actorId) return reply.code(401).send({ error: "Unauthorized" });
    try { return reply.send(await runtime.useCases.savePersonalOmDraft(actorId, request.params.ownerId, request.body.path, request.body.content, request.body.baseRevision)); }
    catch (error) { return reply.code(error instanceof Error && error.message === "Forbidden" ? 403 : error instanceof Error && error.message === "OmDraftBaseChanged" ? 409 : 400).send({ error: error instanceof Error ? error.message : "OmDraftSaveFailed" }); }
  });
  app.delete<{ Params: { ownerId: string }; Querystring: { path: string } }>("/api/v1/om/users/:ownerId/drafts", async (request, reply) => {
    const actorId = runtime.webSessions.userId(cookieToken(request.headers.cookie));
    if (!actorId) return reply.code(401).send({ error: "Unauthorized" });
    try { await runtime.useCases.discardPersonalOmDraft(actorId, request.params.ownerId, request.query.path); return reply.code(204).send(); }
    catch (error) { return reply.code(error instanceof Error && error.message === "Forbidden" ? 403 : 400).send({ error: error instanceof Error ? error.message : "OmDraftDiscardFailed" }); }
  });

  app.get<{ Querystring: { revision?: string } }>("/api/v1/om/organization", async (request, reply) => {
    const actorId = runtime.webSessions.userId(cookieToken(request.headers.cookie));
    if (!actorId) return reply.code(401).send({ error: "Unauthorized" });
    try { return reply.send(await runtime.useCases.organizationOm(actorId, request.query.revision)); }
    catch (error) { return reply.code(404).send({ error: error instanceof Error ? error.message : "OmUnavailable" }); }
  });
  app.get("/api/v1/om/organization/history", async (request, reply) => {
    const actorId = runtime.webSessions.userId(cookieToken(request.headers.cookie));
    if (!actorId) return reply.code(401).send({ error: "Unauthorized" });
    return reply.send({ commits: await runtime.useCases.organizationOmHistory(actorId) });
  });
  app.get<{ Querystring: { path: string; revision?: string } }>("/api/v1/om/organization/file", async (request, reply) => {
    const actorId = runtime.webSessions.userId(cookieToken(request.headers.cookie));
    if (!actorId) return reply.code(401).send({ error: "Unauthorized" });
    try { return reply.send(await runtime.useCases.organizationOmFile(actorId, request.query.path, request.query.revision)); }
    catch (error) { return reply.code(404).send({ error: error instanceof Error ? error.message : "OmFileNotFound" }); }
  });
  app.get<{ Querystring: { path: string; revision?: string } }>("/api/v1/om/organization/manifest", async (request, reply) => {
    const actorId = runtime.webSessions.userId(cookieToken(request.headers.cookie));
    if (!actorId) return reply.code(401).send({ error: "Unauthorized" });
    try { return reply.send(await runtime.useCases.organizationOmManifest(actorId, request.query.path, request.query.revision)); }
    catch (error) { return reply.code(error instanceof Error && error.message === "Forbidden" ? 403 : 404).send({ error: error instanceof Error ? error.message : "OmManifestNotFound" }); }
  });
  app.get<{ Params: { userId: string } }>("/api/v1/organization/compare/:userId", async (request, reply) => {
    const actorId = runtime.webSessions.userId(cookieToken(request.headers.cookie));
    if (!actorId) return reply.code(401).send({ error: "Unauthorized" });
    try { return reply.send(await runtime.useCases.compareOrganizationSource(actorId, request.params.userId)); }
    catch (error) { return reply.code(403).send({ error: error instanceof Error ? error.message : "Forbidden" }); }
  });
  app.get("/api/v1/organization/contributions", async (request, reply) => {
    const actorId = runtime.webSessions.userId(cookieToken(request.headers.cookie));
    if (!actorId) return reply.code(401).send({ error: "Unauthorized" });
    try { return reply.send({ contributions: await runtime.useCases.organizationContributions(actorId) }); }
    catch { return reply.code(403).send({ error: "Forbidden" }); }
  });
  app.post<{ Body: { authorUserId: string; reason: string; evidence?: string } }>("/api/v1/organization/contributions", async (request, reply) => {
    const actorId = runtime.webSessions.userId(cookieToken(request.headers.cookie));
    if (!actorId) return reply.code(401).send({ error: "Unauthorized" });
    try { return reply.code(201).send(await runtime.useCases.createOrganizationContribution(actorId, request.body.authorUserId, request.body.reason, request.body.evidence ?? "")); }
    catch (error) { return reply.code(error instanceof Error && error.message === "Forbidden" ? 403 : 400).send({ error: error instanceof Error ? error.message : "ContributionCreationFailed" }); }
  });
  app.get<{ Params: { id: string } }>("/api/v1/organization/contributions/:id", async (request, reply) => {
    const actorId = runtime.webSessions.userId(cookieToken(request.headers.cookie));
    if (!actorId) return reply.code(401).send({ error: "Unauthorized" });
    try { return reply.send(await runtime.useCases.organizationContribution(actorId, request.params.id)); }
    catch (error) { return reply.code(error instanceof Error && error.message === "Forbidden" ? 403 : 404).send({ error: error instanceof Error ? error.message : "ContributionNotFound" }); }
  });
  app.post<{ Params: { id: string }; Body: { selectedPaths: string[] } }>("/api/v1/organization/contributions/:id/review", async (request, reply) => {
    const actorId = runtime.webSessions.userId(cookieToken(request.headers.cookie));
    if (!actorId) return reply.code(401).send({ error: "Unauthorized" });
    try { return reply.send(await runtime.useCases.reviewOrganizationContribution(actorId, request.params.id, request.body.selectedPaths)); }
    catch (error) { return reply.code(error instanceof Error && error.message === "Forbidden" ? 403 : 409).send({ error: error instanceof Error ? error.message : "ContributionReviewFailed" }); }
  });
  app.post<{ Params: { id: string }; Body: { reviewedRevision: string } }>("/api/v1/organization/contributions/:id/abandon", async (request, reply) => {
    const actorId = runtime.webSessions.userId(cookieToken(request.headers.cookie));
    if (!actorId) return reply.code(401).send({ error: "Unauthorized" });
    try { await runtime.useCases.abandonOrganizationContribution(actorId, request.params.id, request.body.reviewedRevision); return reply.send({ abandoned: true }); }
    catch (error) { return reply.code(error instanceof Error && error.message === "Forbidden" ? 403 : 409).send({ error: error instanceof Error ? error.message : "ContributionAbandonFailed" }); }
  });
  app.post<{ Params: { id: string }; Body: { reviewedRevision: string } }>("/api/v1/organization/contributions/:id/accept", async (request, reply) => {
    const actorId = runtime.webSessions.userId(cookieToken(request.headers.cookie));
    if (!actorId) return reply.code(401).send({ error: "Unauthorized" });
    try { return reply.send(await runtime.useCases.acceptOrganizationContribution(actorId, request.params.id, request.body.reviewedRevision)); }
    catch (error) { return reply.code(error instanceof Error && error.message === "Forbidden" ? 403 : 409).send({ error: error instanceof Error ? error.message : "ContributionAcceptanceFailed" }); }
  });
  app.post("/api/v1/auth/logout", async (request, reply) => {
    runtime.webSessions.revoke(cookieToken(request.headers.cookie));
    reply.header("Set-Cookie", sessionCookie("", request.protocol === "https").replace("Max-Age=1800", "Max-Age=0"));
    return reply.code(204).send();
  });

  app.get<{ Params: { workId: string } }>("/api/v1/works/:workId/trajectory", async (request, reply) => {
    const ticket = String(request.headers["x-forge-ticket"] ?? "");
    try {
      return reply.send({ events: await runtime.useCases.trajectory(ticket, request.params.workId) });
    } catch (error) { return reply.code(401).send({ error: error instanceof Error ? error.message : "Unauthorized" }); }
  });

  app.post<{ Params: { workId: string } }>("/api/v1/works/:workId/complete", async (request, reply) => {
    try {
      await runtime.useCases.completeWork(String(request.headers["x-forge-ticket"] ?? ""), request.params.workId); return reply.code(204).send();
    } catch (error) { return reply.code(400).send({ error: error instanceof Error ? error.message : "WorkCompletionFailed" }); }
  });

  app.get("/api/v1/reflection-lenses", async (request, reply) => {
    const actorId = runtime.webSessions.userId(cookieToken(request.headers.cookie));
    if (!actorId) return reply.code(401).send({ error: "Unauthorized" });
    return reply.send({ lenses: await runtime.useCases.reflectionLenses(actorId) });
  });

  app.patch<{ Params: { lensId: string }; Body: { enabled: boolean; prompt: string } }>("/api/v1/reflection-lenses/:lensId", async (request, reply) => {
    const actorId = runtime.webSessions.userId(cookieToken(request.headers.cookie));
    if (!actorId) return reply.code(401).send({ error: "Unauthorized" });
    try { return reply.send(await runtime.useCases.updateReflectionLens(actorId, request.params.lensId, request.body.enabled, request.body.prompt)); }
    catch (error) { return reply.code(error instanceof Error && error.message === "Forbidden" ? 403 : 400).send({ error: error instanceof Error ? error.message : "LensUpdateFailed" }); }
  });

  app.get<{ Params: { workId: string } }>("/api/v1/works/:workId/reflections", async (request, reply) => {
    const actorId = runtime.webSessions.userId(cookieToken(request.headers.cookie));
    if (!actorId) return reply.code(401).send({ error: "Unauthorized" });
    try { return reply.send({ reflections: await runtime.useCases.reflectionsForWork(actorId, request.params.workId) }); }
    catch (error) { return reply.code(403).send({ error: error instanceof Error ? error.message : "Forbidden" }); }
  });

  app.post<{ Params: { workId: string }; Body: { message: string } }>("/api/v1/works/:workId/reflections", async (request, reply) => {
    const actorId = runtime.webSessions.userId(cookieToken(request.headers.cookie));
    if (!actorId) return reply.code(401).send({ error: "Unauthorized" });
    try { return reply.code(201).send(await runtime.useCases.startReflectionConversation(actorId, request.params.workId, request.body?.message ?? "")); }
    catch (error) { return reply.code(error instanceof Error && ["WorkNotOwned", "ReflectionEvidenceMismatch"].includes(error.message) ? 403 : 400).send({ error: error instanceof Error ? error.message : "ReflectionFailed" }); }
  });

  app.post<{ Params: { workId: string } }>("/api/v1/works/:workId/reflection/open", async (request, reply) => {
    const actorId = runtime.webSessions.userId(cookieToken(request.headers.cookie));
    if (!actorId) return reply.code(401).send({ error: "Unauthorized" });
    try { return reply.send(await runtime.useCases.openWorkReflection(actorId, request.params.workId)); }
    catch (error) { return reply.code(error instanceof Error && error.message === "WorkNotOwned" ? 403 : 400).send({ error: error instanceof Error ? error.message : "ReflectionOpenFailed" }); }
  });

  app.get<{ Params: { reflectionId: string } }>("/api/v1/reflections/:reflectionId", async (request, reply) => {
    const actorId = runtime.webSessions.userId(cookieToken(request.headers.cookie));
    if (!actorId) return reply.code(401).send({ error: "Unauthorized" });
    try { return reply.send(await runtime.useCases.reflectionDetail(actorId, request.params.reflectionId)); }
    catch (error) { return reply.code(403).send({ error: error instanceof Error ? error.message : "ReflectionReadFailed" }); }
  });

  app.post<{ Params: { reflectionId: string }; Body: { message: string } }>("/api/v1/reflections/:reflectionId/messages", async (request, reply) => {
    const actorId = runtime.webSessions.userId(cookieToken(request.headers.cookie));
    if (!actorId) return reply.code(401).send({ error: "Unauthorized" });
    try { return reply.send(await runtime.useCases.continueReflection(actorId, request.params.reflectionId, request.body.message)); }
    catch (error) { return reply.code(error instanceof Error && ["Forbidden", "ReflectionNotOwned"].includes(error.message) ? 403 : 400).send({ error: error instanceof Error ? error.message : "ReflectionMessageFailed" }); }
  });

  app.get<{ Params: { reflectionId: string } }>("/api/v1/reflections/:reflectionId/suggestion.md", async (request, reply) => {
    const actorId = runtime.webSessions.userId(cookieToken(request.headers.cookie));
    if (!actorId) return reply.code(401).send({ error: "Unauthorized" });
    try { return reply.header("Content-Disposition", `attachment; filename="airicforge-suggestion-${request.params.reflectionId}.md"`).type("text/markdown; charset=utf-8").send(await runtime.useCases.reflectionSuggestion(actorId, request.params.reflectionId)); }
    catch (error) { return reply.code(403).send({ error: error instanceof Error ? error.message : "SuggestionUnavailable" }); }
  });

  app.after(() => app.get("/acp", { websocket: true }, (socket, request) => {
    if (request.headers.origin && request.headers.origin !== runtime.config.allowedOrigin) { socket.close(1008, "Origin not allowed"); return; }
    let ticket = "";
    const stopWatching = runtime.sessions.onRemove(removed => { if (ticket === removed) setImmediate(() => socket.close(4003,"User unavailable")); });
    socket.on("close", stopWatching);
    const send = (value: unknown) => { if (socket.readyState === 1) socket.send(JSON.stringify(value)); };
    socket.on("close", () => { if (ticket) void runtime.useCases.disconnectAcp(ticket); });
    socket.on("message", async (raw: unknown) => {
      let request: RpcRequest;
      try { request = JSON.parse(String(raw)) as RpcRequest; } catch { socket.send(JSON.stringify({ error: { code: -32700, message: "Parse error" } })); return; }
      try {
        if (request.method === "session/new") {
          if (ticket) throw new Error("AppSessionAlreadyConnected");
          const requestedTicket = String(request.params?.ticket ?? "");
          const session = await runtime.useCases.connectAcp(requestedTicket);
          ticket = requestedTicket;
          send({ jsonrpc: "2.0", id: request.id, result: { sessionId: session.sessionId, workId: session.workId, history: await runtime.useCases.sessionHistory(ticket) } }); return;
        }
        if (!ticket) throw new Error("AppSessionExpired");
        if (request.method === "session/history") { send({ jsonrpc: "2.0", id: request.id, result: await runtime.useCases.sessionHistory(ticket) }); return; }
        if (request.method === "session/feedback") {
          send({ jsonrpc: "2.0", id: request.id, result: await runtime.useCases.checkpointFeedback(ticket,
            request.params as unknown as import("@airic-forge/domain").CheckpointFeedback, String(request.id ?? "")) }); return;
        }
        if (request.method === "session/cancel") { send({ jsonrpc: "2.0", id: request.id, result: await runtime.useCases.cancelTurn(ticket) }); return; }
        if (request.method === "session/reconcile") { send({ jsonrpc: "2.0", id: request.id, result: await runtime.useCases.recoverCommand(ticket, String(request.params?.commandId ?? "")) }); return; }
        if (request.method === "session/prompt") {
          const message = String(request.params?.message ?? ""); if (!ticket || !message) throw new Error("InvalidPrompt");
          socket.send(JSON.stringify({ jsonrpc: "2.0", method: "session/update", params: { phase: "running" } }));
          const evidenceDigests = request.params?.evidenceDigests;
          if (evidenceDigests !== undefined && (!Array.isArray(evidenceDigests) || evidenceDigests.some((value) => typeof value !== "string"))) throw new Error("InvalidEvidenceSelection");
          const result = await runtime.useCases.startTurn(ticket, message, (text) => send({ jsonrpc: "2.0", method: "session/update", params: { phase: "text-delta", text } }), evidenceDigests as string[] | undefined, String(request.id ?? ""), (turnId) => send({ jsonrpc: "2.0", method: "session/update", params: { phase: "turn-started", turnId } }), (status) => send({ jsonrpc: "2.0", method: "session/update", params: { phase: "context-status", status } }), (activity) => send({ jsonrpc: "2.0", method: "session/update", params: { phase: "activity", activity } }));
          send({ jsonrpc: "2.0", method: "session/update", params: { phase: "completed", text: result.reply, turn: result.turn } });
          send({ jsonrpc: "2.0", id: request.id, result }); return;
        }
        socket.send(JSON.stringify({ jsonrpc: "2.0", id: request.id, error: { code: -32601, message: "Method not found" } }));
      } catch (error) { send({ jsonrpc: "2.0", id: request.id, error: { code: -32000, message: error instanceof Error ? error.message : "Runtime failure" } }); }
    });
  }));
  return app;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const config = loadConfig();
  const appPort = loadAppPort(config);
  bindInstanceRoots(config.projectDir, config.dataDir, config.organizationId, config.appId ?? "");
  await checkAgentResources(config);
  if (config.testIdentitySwitch && config.bindHost && config.bindHost !== "127.0.0.1") throw new Error("TestIdentitySwitchRequiresLoopback");
  const releaseLock = acquireServiceLock(config.dataDir);
  const runtime = new ForgeRuntime(config, appPort);
  const app = buildServer(runtime);
  let stopping = false;
  const stop = async () => {
    if (stopping) return; stopping = true;
    await runtime.useCases.shutdown();
    await app.close(); runtime.db.close(); releaseLock();
  };
  process.on("SIGTERM", () => { void stop(); });
  process.on("SIGINT", () => { void stop(); });
  await app.listen({ port: config.port, host: config.bindHost ?? (config.testIdentitySwitch ? "127.0.0.1" : "0.0.0.0") });
}
