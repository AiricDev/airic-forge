import { PassThrough } from "node:stream";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { isReflectionRunActive } from "@airic-forge/domain";
import type { ForgeRuntime } from "./runtime.js";
import { cookieToken } from "./web-session-store.js";

const statusFor = (code: string) => {
  if (["Forbidden", "ReflectionNotOwned"].includes(code)) return 403;
  if (["ReflectionRunNotFound", "ReflectionNotFound"].includes(code)) return 404;
  if (["ReflectionAlreadyRunning", "ReflectionRequestConflict", "ReflectionClosed"].includes(code)) return 409;
  return 400;
};
const errorReply = (reply: FastifyReply, error: unknown) => {
  const code = error instanceof Error ? error.message : "";
  const safe = [
    "Forbidden", "ReflectionNotOwned", "ReflectionRunNotFound", "ReflectionNotFound",
    "ReflectionAlreadyRunning", "ReflectionRequestConflict", "ReflectionClosed",
    "ReflectionRequestIdRequired", "ReflectionMessageRequired", "UnknownReflectionLens", "ReflectionLensDisabled",
  ].includes(code) ? code : "ReflectionRequestFailed";
  return reply.code(statusFor(safe)).send({ error: safe });
};

function sameOrigin(request: FastifyRequest, runtime: ForgeRuntime) {
  if (request.headers["sec-fetch-site"] === "cross-site") return false;
  const origin = request.headers.origin;
  if (!origin) return true; // Non-browser API clients do not send Origin.
  const allowed = new Set([runtime.config.allowedOrigin, runtime.config.publicUrl, `${request.protocol}://${request.headers.host}`]);
  return allowed.has(origin);
}

/** SSE is a read-only subscriber. Its lifetime never controls the run. */
export function registerReflectionHttp(app: FastifyInstance, runtime: ForgeRuntime) {
  const connections = new Set<() => void>();
  const actor = (request: FastifyRequest) => runtime.webSessions.userId(cookieToken(request.headers.cookie));
  app.addHook("preClose", async () => { for (const close of connections) close(); });
  app.addHook("onClose", async () => { await runtime.useCases.reflectionRuns?.close(); });

  app.post<{ Params: { id: string }; Body: { message: string; requestId: string } }>("/api/v1/reflections/:id/runs", async (request, reply) => {
    const userId = actor(request);
    if (!userId) return reply.code(401).send({ error: "Unauthorized" });
    if (!sameOrigin(request, runtime)) return reply.code(403).send({ error: "Forbidden" });
    try {
      const result = await runtime.useCases.startReflectionRun(userId, request.params.id, request.body?.message, request.body?.requestId);
      return reply.code(result.created ? 202 : 200).send({ run: result.run });
    } catch (error) { return errorReply(reply, error); }
  });

  app.get<{ Params: { id: string } }>("/api/v1/reflections/:id/runs/current", async (request, reply) => {
    const userId = actor(request);
    if (!userId) return reply.code(401).send({ error: "Unauthorized" });
    try { return reply.send({ run: await runtime.useCases.currentReflectionRun(userId, request.params.id) }); }
    catch (error) { return errorReply(reply, error); }
  });

  app.post<{ Params: { id: string; runId: string } }>("/api/v1/reflections/:id/runs/:runId/cancel", async (request, reply) => {
    const userId = actor(request);
    if (!userId) return reply.code(401).send({ error: "Unauthorized" });
    if (!sameOrigin(request, runtime)) return reply.code(403).send({ error: "Forbidden" });
    try { return reply.send({ run: await runtime.useCases.cancelReflectionRun(userId, request.params.id, request.params.runId) }); }
    catch (error) { return errorReply(reply, error); }
  });

  app.get<{ Params: { id: string; runId: string } }>("/api/v1/reflections/:id/runs/:runId/events", async (request, reply) => {
    const userId = actor(request);
    if (!userId) return reply.code(401).send({ error: "Unauthorized" });
    try { await runtime.useCases.readableReflectionRun(userId, request.params.id, request.params.runId); }
    catch (error) { return errorReply(reply, error); }
    const stream = new PassThrough();
    let off: (() => void) | undefined;
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      if (heartbeat) clearInterval(heartbeat);
      off?.();
      connections.delete(close);
      stream.end();
    };
    connections.add(close);
    stream.on("close", close);
    stream.on("error", close);
    reply.raw.on("close", close);
    reply.header("Content-Type", "text/event-stream; charset=utf-8")
      .header("Cache-Control", "no-cache, no-transform")
      .header("X-Accel-Buffering", "no")
      .send(stream);
    off = runtime.useCases.reflectionRuns!.subscribe(request.params.id, request.params.runId, (event) => {
      if (closed) return;
      if (actor(request) !== userId) { close(); return; }
      stream.write(`id: ${event.sequence}\nevent: reflection\ndata: ${JSON.stringify(event)}\n\n`);
      if (stream.readableLength + stream.writableLength > 1024 * 1024) {
        // A slow observer can reconnect to the latest snapshot. Never block the Agent.
        close();
        stream.destroy();
      } else if (!isReflectionRunActive(event.run)) close();
    });
    if (closed) off();
    else heartbeat = setInterval(() => {
      if (actor(request) !== userId) { close(); return; }
      stream.write(": heartbeat\n\n");
      if (stream.readableLength + stream.writableLength > 1024 * 1024) { close(); stream.destroy(); }
    }, 15_000);
    return reply;
  });
}
