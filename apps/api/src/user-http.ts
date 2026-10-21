import type { FastifyInstance } from "fastify";
import type { UserChange } from "@airic-forge/domain";
import type { ForgeRuntime } from "./runtime.js";
import { cookieToken } from "./web-session-store.js";

export function registerUserHttp(app: FastifyInstance, runtime: ForgeRuntime) {
  app.addHook("preHandler", async (request, reply) => {
    const url = request.url.split("?")[0];
    if (url === "/api/v1/auth/login" || url === "/api/v1/auth/logout") return;
    const userId = runtime.webSessions.userId(cookieToken(request.headers.cookie));
    if (!userId) return;
    const user = runtime.db.userById(userId);
    if (!user || user.status === "disabled") return reply.code(401).send({ error: "UserUnavailable" });
    if (user.status !== "draining") return;
    if (request.method === "GET" && url === "/api/v1/auth/me") return;
    const work = /^\/api\/v1\/works\/([^/]+)$/.exec(url);
    const reflection = /^\/api\/v1\/reflections\/([^/]+)(?:\/runs(?:\/[^/]+(?:\/events|\/cancel)?)?)?$/.exec(url);
    const readable = request.method === "GET";
    const stopping = request.method === "POST" && /\/runs\/[^/]+\/cancel$/.test(url);
    if ((readable && work && runtime.useCases.users.observing(userId,"work",work[1]))
      || ((readable || stopping) && reflection && runtime.useCases.users.observing(userId,"reflection",reflection[1]))) return;
    return reply.code(403).send({ error: "UserDraining" });
  });
  app.get<{ Params: { userId: string }; Querystring: { page?: string } }>("/api/v1/users/:userId", async (request, reply) => {
    const actor = runtime.webSessions.userId(cookieToken(request.headers.cookie));
    if (!actor) return reply.code(401).send({ error: "Unauthorized" });
    try { return reply.send(await runtime.useCases.users.detail(actor,request.params.userId,Number(request.query.page ?? 1))); }
    catch (error) { return failure(reply,error); }
  });
  app.patch<{ Params: { userId: string }; Body: UserChange }>("/api/v1/users/:userId", async (request, reply) => {
    const actor = runtime.webSessions.userId(cookieToken(request.headers.cookie));
    if (!actor) return reply.code(401).send({ error: "Unauthorized" });
    if (request.headers["sec-fetch-site"] === "cross-site" || (request.headers.origin && ![runtime.config.allowedOrigin,runtime.config.publicUrl,`${request.protocol}://${request.headers.host}`].includes(request.headers.origin))) return reply.code(403).send({ error: "Forbidden" });
    try { return reply.send({ user: await runtime.useCases.users.change(actor,request.params.userId,request.body) }); }
    catch (error) { return failure(reply,error); }
  });
}
function failure(reply: import("fastify").FastifyReply, error: unknown) {
  const code = error instanceof Error ? error.message : "UserManagementFailed";
  const codes: Record<string,number> = { Forbidden:403, UserUnavailable:403, UserNotFound:404, InvalidUserPage:400, InvalidUserChange:400, LastActiveAdministrator:409, UserVersionConflict:409, UserRequestConflict:409, UserStillDraining:409 };
  return reply.code(codes[code] ?? 500).send({ error: code in codes ? code : "UserManagementFailed" });
}
