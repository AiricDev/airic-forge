import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import {
  mergeRun,
  readReflectionStream,
  useReflectionRun,
} from "./reflection-stream";
import type { ReflectionRun } from "./types";

const run = (overrides: Partial<ReflectionRun> = {}): ReflectionRun => ({
  id: "run-1",
  reflectionId: "reflection-1",
  requestId: "request-1",
  message: "检查证据",
  userMessage: {
    id: "user-1",
    role: "user",
    content: "检查证据",
    at: "2026-10-19T00:00:00Z",
  },
  status: "running",
  sequence: 1,
  text: "",
  tools: [],
  createdAt: "2026-10-19T00:00:00Z",
  updatedAt: "2026-10-19T00:00:00Z",
  ...overrides,
});
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status });
afterEach(() => vi.unstubAllGlobals());

it("replaces repeated stream snapshots without replaying text or regressing a sequence", async () => {
  const encoder = new TextEncoder();
  const snapshots = [
    run({ text: "证据", sequence: 1 }),
    run({ text: "证据", sequence: 1 }),
    run({ text: "证据定位", sequence: 2 }),
    run({ text: "证据", sequence: 1 }),
    run({ text: "证据定位", sequence: 3, status: "completed" }),
  ];
  const bytes = encoder.encode(
    ": heartbeat\r\n\r\n" +
      snapshots
        .map(
          (value) =>
            `event: reflection\r\ndata: ${JSON.stringify({ version: 1, type: "text.delta", run: value })}\r\n\r\n`,
        )
        .join(""),
  );
  const response = new Response(
    new ReadableStream({
      start(controller) {
        for (let index = 0; index < bytes.length; index += 7)
          controller.enqueue(bytes.slice(index, index + 7));
        controller.close();
      },
    }),
  );
  let current: ReflectionRun | null = null;
  await readReflectionStream(response, (next) => {
    current = mergeRun(current, next);
  });
  expect(current).toMatchObject({
    text: "证据定位",
    sequence: 3,
    status: "completed",
  });
});

it("keeps the original request ID after a lost response and blocks a different question", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(json({ run: null }))
    .mockRejectedValueOnce(new TypeError("Network disconnected"));
  vi.stubGlobal("fetch", fetch);
  const { result } = renderHook(() =>
    useReflectionRun("reflection-1", () => {}),
  );
  await waitFor(() => expect(result.current.loading).toBe(false));
  await act(async () => {
    await result.current.send("检查证据");
  });
  const acceptedRequest = JSON.parse(fetch.mock.calls[1][1].body);
  expect(result.current.pending).toEqual(acceptedRequest);
  await act(async () => {
    expect(await result.current.send("另一个问题")).toBe(false);
  });
  expect(fetch).toHaveBeenCalledTimes(2);
  fetch.mockResolvedValueOnce(
    json({
      run: run({ ...acceptedRequest, status: "completed", sequence: 4 }),
    }),
  );
  await act(async () => {
    expect(await result.current.send("检查证据")).toBe(true);
  });
  expect(JSON.parse(fetch.mock.calls[2][1].body)).toEqual(acceptedRequest);
  expect(result.current.pending).toBeNull();
});

it("reconciles an accepted unknown request without another POST", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(json({ run: null }))
    .mockRejectedValueOnce(new TypeError("Lost response"));
  vi.stubGlobal("fetch", fetch);
  const { result } = renderHook(() =>
    useReflectionRun("reflection-1", () => {}),
  );
  await waitFor(() => expect(result.current.loading).toBe(false));
  await act(async () => {
    await result.current.send("检查证据");
  });
  const request = JSON.parse(fetch.mock.calls[1][1].body);
  fetch.mockResolvedValueOnce(
    json({ run: run({ ...request, status: "completed", sequence: 5 }) }),
  );
  await act(async () => {
    await result.current.reconcile();
  });
  expect(result.current.pending).toBeNull();
  expect(
    fetch.mock.calls.filter(([, init]) => init?.method === "POST"),
  ).toHaveLength(1);
});

it("does not endlessly reconnect after read access is revoked", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(json({ run: run() }))
    .mockResolvedValueOnce(json({ error: "Forbidden" }, 403));
  vi.stubGlobal("fetch", fetch);
  const { result, unmount } = renderHook(() =>
    useReflectionRun("reflection-1", () => {}),
  );
  await waitFor(() => expect(result.current.connection).toBe("连接已停止"));
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(result.current.error).toContain("权限");
  unmount();
});
