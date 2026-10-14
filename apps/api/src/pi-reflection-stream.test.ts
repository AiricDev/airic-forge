import assert from "node:assert/strict";
import test from "node:test";
import type { AgentSession, AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import type { ReflectionProgress } from "@airic-forge/domain";
import { connectReflectionStream } from "./pi-reflection-stream.js";

test("Pi text/tool events are filtered, coalesced and reset between model messages", async () => {
  let listener!: (event: AgentSessionEvent) => void;
  let unsubscribed = false;
  const session: Pick<AgentSession, "subscribe" | "abort"> = {
    subscribe: (next) => { listener = next; return () => { unsubscribed = true; }; },
    abort: async () => {},
  };
  const events: ReflectionProgress[] = [];
  const bridge = connectReflectionStream(session, { onProgress: (event) => events.push(event) });
  const emit = (event: unknown) => listener(event as AgentSessionEvent);
  emit({ type: "message_start", message: { role: "assistant" } });
  emit({ type: "message_update", assistantMessageEvent: { type: "thinking_delta", delta: "private reasoning" } });
  emit({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: '{"analysis":"中文' } });
  emit({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: '回答","edits":[{"content":"private file"}]}' } });
  assert.equal(events.length, 1);
  bridge.flush();
  assert.deepEqual(events[1], { type: "text.delta", text: "中文回答" });
  emit({ type: "tool_execution_start", toolName: "read_candidate_file", toolCallId: "tool", args: { private: "secret" } });
  emit({ type: "tool_execution_end", toolName: "read_candidate_file", toolCallId: "tool", isError: true, result: { private: "secret" } });
  emit({ type: "tool_execution_start", toolName: "unregistered_tool", toolCallId: "other" });
  assert.deepEqual(events.slice(2), [
    { type: "tool.status", tool: { id: "tool", name: "read_candidate_file", status: "running" } },
    { type: "tool.status", tool: { id: "tool", name: "read_candidate_file", status: "failed" } },
  ]);
  emit({ type: "message_start", message: { role: "assistant" } });
  emit({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: '{"analysis":"New answer"}' } });
  bridge.flush();
  assert.deepEqual(events.slice(-2), [{ type: "text.replace", text: "" }, { type: "text.delta", text: "New answer" }]);
  await bridge.close();
  assert.equal(unsubscribed, true);
  assert.ok(!JSON.stringify(events).includes("private"));
  assert.ok(!JSON.stringify(events).includes("secret"));
});

test("Pi cancellation waits for abort to settle and stops emitting pending text", async () => {
  let listener!: (event: AgentSessionEvent) => void;
  let finish!: () => void;
  let aborts = 0;
  const aborted = new Promise<void>((resolve) => { finish = resolve; });
  const signal = new AbortController();
  const events: ReflectionProgress[] = [];
  const bridge = connectReflectionStream({
    subscribe: (next) => { listener = next; return () => {}; },
    abort: () => { aborts++; return aborted; },
  }, { signal: signal.signal, onProgress: (event) => events.push(event) });
  listener({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: '{"analysis":"Must not flush"}' } } as AgentSessionEvent);
  signal.abort();
  bridge.flush();
  let closed = false;
  const closing = bridge.close().then(() => { closed = true; });
  await Promise.resolve();
  assert.equal(aborts, 1);
  assert.equal(closed, false);
  assert.deepEqual(events, []);
  finish();
  await closing;
  assert.equal(closed, true);
});
