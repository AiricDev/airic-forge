import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../../apps/api/dist/config.js";
import { PiWorkAgentRunner } from "../../apps/api/dist/pi-work-agent.js";
import { PiReflectionAgentRunner } from "../../apps/api/dist/pi-reflection-agent.js";

// Exercise the installed SDK against a local OpenAI-compatible SSE fixture.
// No provider credentials, business server, or durable business data are used.
const dataDir = await mkdtemp(join(tmpdir(), "forge-pi-sdk-"));
const requests = [];
const reply = JSON.stringify({ outcome: "analysis", analysis: "SDK reflection OK", attribution: "Source event", citedEventIds: ["event-1"], edits: [] });
const server = createServer(async (req, res) => {
  let body = "";
  for await (const chunk of req) body += chunk;
  const request = JSON.parse(body);
  const step = requests.length;
  requests.push(request);
  res.writeHead(200, { "Content-Type": "text/event-stream" });
  const send = (delta, finish_reason = null) => res.write(`data: ${JSON.stringify({ id: `response-${step}`, object: "chat.completion.chunk", created: 1, model: request.model, choices: [{ index: 0, delta, finish_reason }] })}\n\n`);
  send({ role: "assistant" });
  if (step === 0 || step === 2) {
    const name = step === 0 ? "load_work_document" : "read_work_trajectory";
    const args = step === 0 ? { id: "doc-1" } : { offset: 0, limit: 1 };
    send({ tool_calls: [{ index: 0, id: `call-${step}`, type: "function", function: { name, arguments: JSON.stringify(args) } }] });
    send({}, "tool_calls");
  } else {
    send({ content: step === 1 ? "SDK work OK" : reply });
    send({}, "stop");
  }
  res.end("data: [DONE]\n\n");
});

try {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const config = {
    ...loadConfig({ FORGE_DATA_DIR: dataDir }),
    modelProvider: "deepseek", modelId: "deepseek-v4-pro", modelApiKey: "local-fixture-key",
    modelBaseUrl: `http://127.0.0.1:${server.address().port}/v1`,
  };
  let streamed = "";
  let loaded = false;
  const evidenceText = "TRANSIENT_EVIDENCE_PI_SDK_SMOKE";
  const work = await new PiWorkAgentRunner(config).runWork({
    sessionId: "work-session", userMessage: "Read doc-1", context: {}, documents: [],
    availableDocumentIds: ["doc-1"], tools: [],
    evidence: [{ filename: "example.txt", digest: "fixture", text: evidenceText }],
    loadDocument: async (id) => { assert.equal(id, "doc-1"); loaded = true; return "Authorized document"; },
    onText: (delta) => { streamed += delta; },
  });
  assert.equal(work.text, "SDK work OK");
  assert.equal(streamed, work.text);
  assert.equal(loaded, true);
  assert.deepEqual(requests[0].tools.map((tool) => tool.function.name), ["load_work_document"]);
  assert(requests[1].messages.some((message) => message.role === "tool" && message.content.includes("Authorized document")));
  const workDir = join(dataDir, "agent-sessions", "work-session");
  const workFiles = await readdir(workDir);
  assert(!workFiles.some((name) => name.endsWith(".jsonl")));
  for (const name of workFiles) assert(!(await readFile(join(workDir, name), "utf8")).includes(evidenceText));

  let readTrajectory = false;
  const reflectionInput = {
    reflectionId: "reflection-1", lens: { id: "conversation", version: 1, enabled: true, prompt: "Discuss" },
    question: "FIRST_REFLECTION_QUESTION", messages: [], evidence: [], documents: [], omRevision: "fixture-revision",
    readTrajectory: async (offset, limit) => {
      assert.equal(offset, 0); assert.equal(limit, 1); readTrajectory = true;
      return [{ id: "event-1", workId: "work-1", type: "message", at: "2026-10-14T00:00:00Z", payload: { text: "Source event" } }];
    },
  };
  assert.equal((await new PiReflectionAgentRunner(config).analyze(reflectionInput)).analysis, "SDK reflection OK");
  assert.equal(readTrajectory, true);
  assert.deepEqual(requests[2].tools.map((tool) => tool.function.name), ["read_work_trajectory"]);
  await new PiReflectionAgentRunner(config).analyze({ ...reflectionInput, question: "Continue discussion" });
  assert(JSON.stringify(requests[4].messages).includes("FIRST_REFLECTION_QUESTION"));
  const reflectionDir = join(dataDir, "reflection-sessions", "reflection-1");
  const sessionFiles = (await readdir(reflectionDir)).filter((name) => name.endsWith(".jsonl"));
  assert.equal(sessionFiles.length, 1);
  assert(!(await readFile(join(reflectionDir, sessionFiles[0]), "utf8")).includes(evidenceText));
  console.log("Pi SDK smoke passed: scoped tools, streamed Work, transient evidence, Reflection trajectory and session resume (5 local model requests).");
} finally {
  await new Promise((resolve) => server.close(resolve));
  await rm(dataDir, { recursive: true, force: true });
}
