import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type { ReflectionProgress, ReflectionToolName } from "@airic-forge/domain";
import { ReflectionTextStream } from "./reflection-text-stream.js";

/** Only this adapter knows Pi events; nothing from tool inputs/results crosses it. */
export function connectReflectionStream(
  session: Pick<AgentSession, "subscribe" | "abort">,
  input: { signal?: AbortSignal; onProgress?: (event: ReflectionProgress) => void },
) {
  let parser = new ReflectionTextStream();
  let pending = "";
  let timer: ReturnType<typeof setTimeout> | undefined;
  let aborting: Promise<void> | undefined;
  const flush = () => {
    if (timer) clearTimeout(timer);
    timer = undefined;
    if (pending && !input.signal?.aborted) input.onProgress?.({ type: "text.delta", text: pending });
    pending = "";
  };
  const unsubscribe = session.subscribe((event) => {
    if (input.signal?.aborted) return;
    if (event.type === "message_start" && event.message.role === "assistant") {
      flush();
      parser = new ReflectionTextStream();
      input.onProgress?.({ type: "text.replace", text: "" });
    }
    if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
      pending += parser.feed(event.assistantMessageEvent.delta);
      if (pending && !timer) timer = setTimeout(flush, 50);
    }
    if (event.type === "message_end") flush();
    if ((event.type === "tool_execution_start" || event.type === "tool_execution_end") && ["read_work_trajectory", "read_candidate_file", "write_candidate_file"].includes(event.toolName.replace(/^mcp__work__/, ""))) {
      flush();
      input.onProgress?.({ type: "tool.status", tool: { id: event.toolCallId, name: event.toolName.replace(/^mcp__work__/, "") as ReflectionToolName, status: event.type === "tool_execution_start" ? "running" : event.isError ? "failed" : "completed" } });
    }
  });
  const abort = () => { aborting = session.abort().catch(() => {}); };
  input.signal?.addEventListener("abort", abort, { once: true });
  return {
    flush,
    async close() {
      if (timer) clearTimeout(timer);
      input.signal?.removeEventListener("abort", abort);
      await aborting;
      unsubscribe();
    },
  };
}
