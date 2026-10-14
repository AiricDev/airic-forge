import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { ForgeRuntime } from "./runtime.js";
import { buildServer } from "./server.js";

test("ACP upgrades to WebSocket and handles session/new as a socket message", async () => {
  const root = mkdtempSync(join(tmpdir(), "forge-acp-socket-"));
  const runtime = new ForgeRuntime({ port: 0, projectDir: join(root, "project"), dataDir: join(root, "data"), seedProjectDir: resolve(process.cwd(), "../../seed/certlab"), webDistDir: join(root, "web"), certLabUrl: "http://127.0.0.1:1", organizationId: "synthetic-org", allowedOrigin: "http://localhost:5173", initialAdminEmails: new Set() });
  const app = buildServer(runtime);
  try {
    const address = await app.listen({ port: 0, host: "127.0.0.1" });
    const socket = new WebSocket(address.replace(/^http/, "ws") + "/acp");
    const response = await new Promise<Record<string, unknown>>((resolveMessage, reject) => {
      socket.onopen = () => socket.send(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "session/new", params: { ticket: "missing" } }));
      socket.onmessage = (event) => resolveMessage(JSON.parse(String(event.data)) as Record<string, unknown>);
      socket.onerror = () => reject(new Error("WebSocket upgrade failed"));
      setTimeout(() => reject(new Error("ACP did not answer")), 3000);
    });
    assert.equal((response.error as Record<string, unknown>).message, "AppSessionExpired");
    socket.close();
  } finally { await app.close(); runtime.db.close(); rmSync(root, { recursive: true, force: true }); }
});
