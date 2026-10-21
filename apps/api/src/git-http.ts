import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ForgeRuntime } from "./runtime.js";
import { git } from "./personal-git-om.js";

const packet = (text: string) => Buffer.from(`${(Buffer.byteLength(text) + 4).toString(16).padStart(4, "0")}${text}`);
const credential = (request: FastifyRequest) => {
  const value = request.headers.authorization ?? "";
  if (value.startsWith("Bearer ")) return value.slice(7);
  if (!value.startsWith("Basic ")) return "";
  const decoded = Buffer.from(value.slice(6), "base64").toString("utf8");
  return decoded.slice(decoded.indexOf(":") + 1);
};
function command(cwd: string, args: string[], input?: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const process = spawn("git", ["-c", "core.hooksPath=/dev/null", ...args], { cwd, stdio: ["pipe", "pipe", "pipe"] });
    const chunks: Buffer[] = [];
    let size = 0;
    const timer = setTimeout(() => { process.kill("SIGKILL"); reject(new Error("GitTransferTimeout")); }, 30_000);
    process.stdout.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > 64 * 1024 * 1024) { process.kill("SIGKILL"); reject(new Error("GitTransferTooLarge")); }
      else chunks.push(chunk);
    });
    process.stderr.resume();
    process.on("error", reject);
    process.on("close", (code) => { clearTimeout(timer); code === 0 ? resolve(Buffer.concat(chunks)) : reject(new Error("GitTransferFailed")); });
    process.stdin.on("error", () => {});
    process.stdin.end(input);
  });
}

/** Never run upload-pack against the shared object database, even with hidden refs. */
export function registerGitHttp(app: FastifyInstance, runtime: ForgeRuntime) {
  const transfers = new Set<symbol>();
  app.addContentTypeParser(/^application\/x-git-(?:receive|upload)-pack-request$/, { parseAs: "buffer" }, (_request, body, done) => done(null, body));
  const handle = async (request: FastifyRequest<{ Params: { owner: string; action: string }; Querystring: { service?: string } }>, reply: import("fastify").FastifyReply) => {
    let directory: string | undefined;
    let transfer: symbol | undefined;
    try {
      const publicUrl = new URL(runtime.config.publicUrl ?? "http://127.0.0.1");
      const local = ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(request.raw.socket.remoteAddress ?? "");
      if (request.protocol !== "https" && !(local && ["localhost", "127.0.0.1", "[::1]"].includes(publicUrl.hostname))) throw new Error("GitHttpsRequired");
      const owner = request.params.owner;
      if (!/^[a-zA-Z0-9_-]+$/.test(owner)) throw new Error("Forbidden");
      const secret = credential(request);
      await runtime.gitAccess.authenticate(secret, owner);
      if (transfers.size >= 4) throw new Error("GitTransferBusy");
      transfer = Symbol(); transfers.add(transfer);
      const advertisement = request.method === "GET" && request.params.action === "info/refs";
      const service = advertisement ? request.query.service : request.params.action;
      if (service !== "git-upload-pack" && service !== "git-receive-pack") return reply.code(404).send();
      if (!advertisement && request.method !== "POST") return reply.code(405).send();
      runtime.om.ensureUserBranch(owner);
      const base = runtime.om.head(`users/${owner}`);
      // The historical trees are part of a clone too. Fail closed on an unsafe legacy history.
      for (const commit of git(runtime.om.projectDir, ["rev-list", base]).split("\n")) runtime.om.checkExportTree(commit);
      const parent = join(runtime.config.dataDir, "git-transfer");
      mkdirSync(parent, { recursive: true });
      directory = mkdtempSync(join(parent, "request-"));
      git(directory, ["init", "--bare", "--initial-branch=main"]);
      const objects = await command(runtime.om.projectDir, ["pack-objects", "--stdout", "--revs"], Buffer.from(`${base}\n`));
      await command(directory, ["index-pack", "--stdin"], objects);
      git(directory, ["update-ref", "refs/heads/main", base]);
      git(directory, ["config", "uploadpack.allowAnySHA1InWant", "false"]);
      git(directory, ["config", "uploadpack.allowReachableSHA1InWant", "false"]);
      git(directory, ["config", "receive.denyNonFastForwards", "true"]);
      git(directory, ["config", "receive.denyDeletes", "true"]);
      git(directory, ["config", "receive.maxInputSize", "16777216"]);
      reply.header("Cache-Control", "no-store");
      if (advertisement) {
        const result = await command(directory, [service.slice(4), "--stateless-rpc", "--advertise-refs", "."]);
        return reply.type(`application/x-${service}-advertisement`).send(Buffer.concat([packet(`# service=${service}\n`), Buffer.from("0000"), result]));
      }
      if (!Buffer.isBuffer(request.body)) throw new Error("GitInvalidRequest");
      const output = await command(directory, [service.slice(4), "--stateless-rpc", "."], request.body);
      if (service === "git-receive-pack") {
        const refs = git(directory, ["for-each-ref", "--format=%(refname)"]).split("\n").filter(Boolean);
        if (refs.length !== 1 || refs[0] !== "refs/heads/main") throw new Error("GitRefNotAllowed");
        const revision = git(directory, ["rev-parse", "refs/heads/main"]);
        if (revision !== base) {
          const incoming = await command(directory, ["pack-objects", "--stdout", "--revs"], Buffer.from(`${revision}\n^${base}\n`));
          await command(runtime.om.projectDir, ["index-pack", "--stdin"], incoming);
          await runtime.gitAccess.authenticate(secret, owner);
          await runtime.omChanges.publish(owner, base, revision);
        }
      }
      return reply.type(`application/x-${service}-result`).send(output);
    } catch (error) {
      const code = error instanceof Error ? error.message : "";
      if (code === "Unauthorized") return reply.header("WWW-Authenticate", 'Basic realm="Forge personal OM"').code(401).send("Authentication required");
      if (code === "Forbidden") return reply.code(403).send("Personal OM access denied");
      const safe = /^(ActiveRevisionChanged|OmWriteInProgress|OmNonFastForward|OmPathNotAllowed|OmFileTooLarge|GitRefNotAllowed|UserWorktreeDirty|GitHttpsRequired)$/.test(code) ? code : code.startsWith("InvalidOperatingModel:") ? "InvalidOperatingModel" : "GitRequestRejected";
      return reply.code(409).send(safe);
    } finally { if (directory) rmSync(directory, { recursive: true, force: true }); if (transfer) transfers.delete(transfer); }
  };
  app.get<{ Params: { owner: string; action: string }; Querystring: { service?: string } }>("/git/personal/:owner.git/info/refs", (request, reply) => { request.params.action = "info/refs"; return handle(request, reply); });
  app.post("/git/personal/:owner.git/:action", { bodyLimit: 16 * 1024 * 1024 }, handle);
}
