import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "./config.js";
import { openNativeSession } from "./pi-native-session.js";

// A deterministic model tests transport/resumption, not the quality of visual reasoning.
for (const [domain, fact] of [["museum", "Exhibit closes at 18:00"], ["maintenance", "Inspection interval is 30 days"]]) {
  test(`generic reading artifacts resume in ${domain} without document procedures in OM`, async () => {
    const root = mkdtempSync(join(tmpdir(), "forge-generic-reading-"));
    let phase = 0, step = 0, reads = 0, saved = 0;
    const server = createServer(async (req, res) => {
      let raw = ""; for await (const chunk of req) raw += chunk;
      const input = JSON.parse(raw);
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      const send = (delta: unknown, finish: string | null = null) => res.write("data: " + JSON.stringify({ id: "generic", object: "chat.completion.chunk", created: 1, model: "deepseek-flash", choices: [{ index: 0, delta, finish_reason: finish }] }) + "\n\n");
      const actions = phase === 0 ? [
        { name: "tool_search", args: { query: "read source page", limit: 1 } },
        { name: "mcp__work__source_page", args: { page: 2 } },
        { name: "write", args: { path: "reading-notes.md", content: `Source ${domain}/revision-1 page 2: ${fact}. Diagram detail uncertain. Next save the result.` } },
      ] : [
        { name: "read", args: { path: "reading-notes.md" } },
        { name: "tool_search", args: { query: "save result", limit: 1 } },
        { name: "mcp__work__result_save", args: { source: `${domain}/revision-1`, page: 2, fact, limitation: "Diagram detail uncertain" } },
      ];
      if (phase === 0 && step === 2) assert.ok(JSON.stringify(input.messages).includes(fact));
      if (phase === 1 && step > 0) assert.ok(JSON.stringify(input.messages).includes(fact));
      const action = actions[step++];
      if (action) { send({ role: "assistant", tool_calls: [{ index: 0, id: `call-${phase}-${step}`, type: "function", function: { name: action.name, arguments: JSON.stringify(action.args) } }] }); send({}, "tool_calls"); }
      else { send({ role: "assistant", content: phase ? "Result saved" : "Reading noted" }); send({}, "stop"); }
      res.end("data: [DONE]\n\n");
    });
    server.listen(0, "127.0.0.1"); await once(server, "listening"); const address = server.address();
    assert.ok(address && typeof address !== "string");
    const config = { ...loadConfig({}), dataDir: join(root, "data"), modelProvider: "deepseek", modelId: "deepseek-flash", modelApiKey: "synthetic", modelBaseUrl: `http://127.0.0.1:${address.port}/v1` };
    const input = { scope: { organizationId: domain, ownerUserId: "owner", workId: "work", turnId: "turn-1", omRevision: "business-policy", catalogDigest: "sources" }, kind: "work" as const, id: "work", instructions: `Prepare a ${domain} finding supported by source locations.`, documents: [], tools: [
      { name: "source.page", description: "Read source page text and image", inputSchema: { type: "object", properties: { page: { type: "integer" } } }, invoke: async () => { reads++; return { content: [{ type: "text" as const, text: JSON.stringify({ revision: `${domain}/revision-1`, page: 2, text: fact }) }, { type: "image" as const, mimeType: "image/png", data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jH4sAAAAASUVORK5CYII=" }] }; } },
      { name: "result.save", description: "Save result with source and limitation", inputSchema: { type: "object", properties: { source: { type: "string" }, page: { type: "integer" }, fact: { type: "string" }, limitation: { type: "string" } } }, invoke: async (args: Record<string, unknown>) => { assert.equal(args.fact, fact); assert.equal(args.source, `${domain}/revision-1`); assert.equal(args.page, 2); assert.equal(args.limitation, "Diagram detail uncertain"); saved++; return { content: [{ type: "text" as const, text: "committed: original-result-1" }] }; } },
    ] };
    try {
      const first = await openNativeSession(config, input);
      await first.session.prompt("Read the source and record the relevant finding"); const id = first.session.sessionId; await first.close();
      phase = 1; step = 0;
      const next = await openNativeSession(config, { ...input, scope: { ...input.scope, turnId: "turn-2" } });
      assert.equal(next.session.sessionId, id); await next.session.prompt("Continue the result"); await next.close();
      assert.equal(reads, 1); assert.equal(saved, 1);
    } finally { await new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections(); }); rmSync(root, { recursive: true, force: true }); }
  });
}
