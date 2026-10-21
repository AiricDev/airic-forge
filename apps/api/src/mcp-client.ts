import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js";

export const executionMeta = "ai.airic/execution";

/** Credentials and SDK sessions live only for one operation, never across users. */
export class AppMcpClient {
  constructor(private readonly endpoint: URL) {}

  private async session<T>(token: string, run: (client: Client) => Promise<T>): Promise<T> {
    const client = new Client({ name: "airic-forge", version: "1.0.0" });
    const transport = new StreamableHTTPClientTransport(this.endpoint, {
      requestInit: { headers: { Authorization: `Bearer ${token}` }, redirect: "manual" },
      reconnectionOptions: { maxRetries: 0, initialReconnectionDelay: 1000, maxReconnectionDelay: 1000, reconnectionDelayGrowFactor: 1 },
      fetch: async (url, init) => {
        if (new URL(String(url)).href !== this.endpoint.href) throw new Error("McpEndpointMismatch");
        const response = await fetch(url, { ...init, redirect: "manual", signal: AbortSignal.any([AbortSignal.timeout(30_000), ...(init?.signal ? [init.signal] : [])]) });
        if (response.status >= 300 && response.status < 400) throw new Error("McpRedirectRejected");
        // This integration uses bounded JSON responses, not an unbounded SSE stream.
        if (response.headers.get("content-type")?.includes("text/event-stream")) {
          await response.body?.cancel(); throw new Error("UnexpectedMcpStream");
        }
        if (!response.body) return response;
        const reader = response.body.getReader();
        const chunks: Uint8Array[] = [];
        let size = 0;
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.length;
            if (size > 16 * 1024 * 1024) throw new Error("McpResponseTooLarge");
            chunks.push(value);
          }
        } finally { await reader.cancel(); }
        return new Response(Buffer.concat(chunks), { status: response.status, headers: response.headers });
      },
    });
    try {
      await client.connect(transport, { timeout: 30_000 });
      return await run(client);
    } finally { await client.close(); }
  }

  async tools(token: string): Promise<Tool[]> {
    return this.session(token, async (client) => {
      const tools: Tool[] = [];
      const cursors = new Set<string>();
      let cursor: string | undefined;
      do {
        const page = await client.listTools(cursor ? { cursor } : {}, { timeout: 30_000 });
        tools.push(...page.tools);
        if (tools.length > 500) throw new Error("McpCatalogTooLarge");
        cursor = page.nextCursor;
        if (cursor && cursors.has(cursor)) throw new Error("McpCatalogCursorLoop");
        if (cursor) cursors.add(cursor);
      } while (cursor);
      return tools;
    });
  }

  async call(token: string, name: string, args: Record<string, unknown>, execution?: Record<string, unknown>): Promise<CallToolResult> {
    return this.session(token, async (client) => {
      return await client.callTool({ name, arguments: args, ...(execution ? { _meta: { [executionMeta]: execution } } : {}) }, undefined, { timeout: 30_000 }) as CallToolResult;
    });
  }
}

export class AppToolError extends Error {
  constructor(readonly result: Record<string, unknown>) {
    const error = result.error as Record<string, unknown> | undefined;
    super(typeof error?.code === "string" && /^[\w.-]+$/.test(error.code) ? error.code : "InvalidMcpToolResult");
  }
}

/** Convert supported content only. Never follow resource links returned by a server. */
export function appToolResult(result: CallToolResult): Record<string, unknown> {
  const value = result.structuredContent;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("InvalidMcpToolResult");
  if (result.isError) throw new AppToolError(value);
  const images = result.content.filter(block => block.type === "image");
  if (images.length > 1 || result.content.some(block => !["text", "image"].includes(block.type))) throw new Error("UnsupportedMcpContent");
  return { ...value, ...(images.length ? { image: { mimeType: images[0]!.mimeType, data: images[0]!.data } } : {}) };
}

export function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]));
  return value;
}
