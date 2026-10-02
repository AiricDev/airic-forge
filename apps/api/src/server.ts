import Fastify from "fastify";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import { loadConfig } from "./config.js";
import { ForgeRuntime } from "./runtime.js";
import { cookieToken, sessionCookie } from "./web-session-store.js";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

type BootstrapBody = { appId: "certreporter"; workType: "report-authoring"; entityId: string; selection?: Record<string, unknown> };
type RpcRequest = { id?: string | number; method?: string; params?: Record<string, unknown> };
type AcpConnection = { socket: { on(event: "message" | "close", listener: (raw?: unknown) => void | Promise<void>): void; send(payload: string): void } };

const bearer = (value: unknown): string => {
  const header = String(value ?? ""); const match = /^Bearer\s+(.+)$/i.exec(header);
  if (!match) throw new Error("MissingBearerToken"); return match[1];
};

export function buildServer(runtime = new ForgeRuntime(loadConfig())) {
  const app = Fastify({ logger: true });
  void app.register(cors, { origin: runtime.config.allowedOrigin, credentials: true });
  void app.register(websocket);

  app.get("/health", async () => ({ status: "ok", service: "airic-forge" }));

  app.get("/", async (_request, reply) => {
    try { return reply.type("text/html; charset=utf-8").send(await readFile(join(runtime.config.webDistDir, "index.html"))); }
    catch { return reply.code(404).send({ error: "WebWorkspaceNotBuilt" }); }
  });
  app.get<{ Params: { file: string } }>("/assets/:file", async (request, reply) => {
    const file = request.params.file;
    if (!/^[a-zA-Z0-9_.-]+$/.test(file)) return reply.code(404).send({ error: "NotFound" });
    const type = file.endsWith(".js") ? "text/javascript" : file.endsWith(".css") ? "text/css" : file.endsWith(".svg") ? "image/svg+xml" : file.endsWith(".woff2") ? "font/woff2" : "application/octet-stream";
    try { return reply.type(type).send(await readFile(join(runtime.config.webDistDir, "assets", file))); }
    catch { return reply.code(404).send({ error: "NotFound" }); }
  });

  app.post<{ Body: BootstrapBody }>("/api/v1/app-sessions/bootstrap", async (request, reply) => {
    try {
      const body = request.body;
      if (body.appId !== "certreporter" || body.workType !== "report-authoring" || !body.entityId) return reply.code(400).send({ error: "UnsupportedAppContext" });
      const result = await runtime.useCases.bootstrap({ token: bearer(request.headers.authorization), reportId: body.entityId, selection: body.selection });
      return reply.code(201).send({ ...result, acpUrl: "/acp" });
    } catch (error) { return reply.code(401).send({ error: error instanceof Error ? error.message : "BootstrapFailed" }); }
  });

  app.post<{ Params: { ticket: string }; Body: { password: string } }>("/api/v1/app-sessions/:ticket/password", async (request, reply) => {
    try {
      await runtime.useCases.setPassword(request.params.ticket, request.body.password);
      return reply.code(204).send();
    } catch (error) { return reply.code(400).send({ error: error instanceof Error ? error.message : "PasswordSetupFailed" }); }
  });

  app.post<{ Body: { email: string; password: string } }>("/api/v1/auth/login", async (request, reply) => {
    const user = await runtime.useCases.login(request.body.email, request.body.password);
    if (!user) return reply.code(401).send({ error: "InvalidCredentials" });
    const token = runtime.webSessions.issue(user.id);
    reply.header("Set-Cookie", sessionCookie(token, request.protocol === "https"));
    return reply.send({ user });
  });

  app.get("/api/v1/auth/me", async (request, reply) => {
    const userId = runtime.webSessions.userId(cookieToken(request.headers.cookie));
    if (!userId) return reply.code(401).send({ error: "Unauthorized" });
    const user = await runtime.useCases.webUser(userId);
    return user ? reply.send({ user }) : reply.code(401).send({ error: "Unauthorized" });
  });

  app.get("/api/v1/users", async (request, reply) => {
    const actorId = runtime.webSessions.userId(cookieToken(request.headers.cookie));
    if (!actorId) return reply.code(401).send({ error: "Unauthorized" });
    try { return reply.send({ users: await runtime.useCases.listUsers(actorId) }); }
    catch { return reply.code(403).send({ error: "Forbidden" }); }
  });

  app.get<{ Params: { ownerId: string } }>("/api/v1/om/users/:ownerId", async (request, reply) => {
    const actorId = runtime.webSessions.userId(cookieToken(request.headers.cookie));
    if (!actorId) return reply.code(401).send({ error: "Unauthorized" });
    try { return reply.send(await runtime.useCases.personalOm(actorId, request.params.ownerId)); }
    catch { return reply.code(403).send({ error: "Forbidden" }); }
  });

  app.get<{ Params: { ownerId: string }; Querystring: { path: string } }>("/api/v1/om/users/:ownerId/file", async (request, reply) => {
    const actorId = runtime.webSessions.userId(cookieToken(request.headers.cookie));
    if (!actorId) return reply.code(401).send({ error: "Unauthorized" });
    try { return reply.send(await runtime.useCases.personalOmFile(actorId, request.params.ownerId, request.query.path)); }
    catch (error) { return reply.code(error instanceof Error && error.message === "Forbidden" ? 403 : 404).send({ error: error instanceof Error ? error.message : "OmFileNotFound" }); }
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

  app.post<{ Params: { workId: string }; Body: { lensId: string; question: string } }>("/api/v1/works/:workId/reflections", async (request, reply) => {
    try {
      const ticket = String(request.headers["x-forge-ticket"] ?? ""); const session = await runtime.useCases.appSession(ticket);
      if (session.workId !== request.params.workId) return reply.code(403).send({ error: "WorkNotOwned" });
      return reply.code(201).send(await runtime.useCases.openReflection(ticket, request.body.lensId, request.body.question));
    } catch (error) { return reply.code(400).send({ error: error instanceof Error ? error.message : "ReflectionFailed" }); }
  });

  app.patch<{ Params: { proposalId: string }; Body: { path: string; content: string } }>("/api/v1/proposals/:proposalId/files", async (request, reply) => {
    try { return reply.send(await runtime.useCases.writeProposal(String(request.headers["x-forge-ticket"] ?? ""), request.params.proposalId, request.body.path, request.body.content)); }
    catch (error) { return reply.code(400).send({ error: error instanceof Error ? error.message : "ProposalWriteFailed" }); }
  });

  app.post<{ Params: { proposalId: string }; Body: { title: string } }>("/api/v1/proposals/:proposalId/adopt", async (request, reply) => {
    try { return reply.send(await runtime.useCases.adoptProposal(String(request.headers["x-forge-ticket"] ?? ""), request.params.proposalId, request.body.title)); }
    catch (error) { return reply.code(409).send({ error: error instanceof Error ? error.message : "ProposalAdoptionFailed" }); }
  });

  app.get("/acp", { websocket: true }, (connection: AcpConnection) => {
    let ticket = "";
    connection.socket.on("close", () => { if (ticket) void runtime.useCases.disconnectAcp(ticket); });
    connection.socket.on("message", async (raw: unknown) => {
      let request: RpcRequest;
      try { request = JSON.parse(String(raw)) as RpcRequest; } catch { connection.socket.send(JSON.stringify({ error: { code: -32700, message: "Parse error" } })); return; }
      try {
        if (request.method === "session/new") {
          const requestedTicket = String(request.params?.ticket ?? "");
          const session = await runtime.useCases.connectAcp(requestedTicket);
          ticket = requestedTicket;
          connection.socket.send(JSON.stringify({ jsonrpc: "2.0", id: request.id, result: { sessionId: session.sessionId, workId: session.workId } })); return;
        }
        if (request.method === "session/prompt") {
          const message = String(request.params?.message ?? ""); if (!ticket || !message) throw new Error("InvalidPrompt");
          connection.socket.send(JSON.stringify({ jsonrpc: "2.0", method: "session/update", params: { phase: "running" } }));
          const result = await runtime.useCases.startTurn(ticket, message);
          connection.socket.send(JSON.stringify({ jsonrpc: "2.0", method: "session/update", params: { phase: "completed", text: result.reply, turn: result.turn } }));
          connection.socket.send(JSON.stringify({ jsonrpc: "2.0", id: request.id, result })); return;
        }
        connection.socket.send(JSON.stringify({ jsonrpc: "2.0", id: request.id, error: { code: -32601, message: "Method not found" } }));
      } catch (error) { connection.socket.send(JSON.stringify({ jsonrpc: "2.0", id: request.id, error: { code: -32000, message: error instanceof Error ? error.message : "Runtime failure" } })); }
    });
  });
  return app;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const config = loadConfig();
  const app = buildServer(new ForgeRuntime(config));
  await app.listen({ port: config.port, host: "0.0.0.0" });
}
