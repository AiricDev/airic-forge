import { afterEach, expect, it, vi } from "vitest";
import { api, command, ApiError } from "./api";
afterEach(() => vi.unstubAllGlobals());
it("sends credentials and JSON without replacing caller headers", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValue(
      new Response(JSON.stringify({ saved: true }), { status: 200 }),
    );
  vi.stubGlobal("fetch", fetch);
  await api("/command", {
    method: "POST",
    headers: { "X-Request": "id" },
    body: '{"value":1}',
  });
  const options = fetch.mock.calls[0][1] as RequestInit;
  expect(options.credentials).toBe("include");
  expect((options.headers as Headers).get("Content-Type")).toBe(
    "application/json",
  );
  expect((options.headers as Headers).get("X-Request")).toBe("id");
});
it("preserves the server status and message and handles empty success", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValueOnce(
        new Response('{"error":"ProposalBaseChanged"}', { status: 409 }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 })),
  );
  await expect(command("/adopt")).rejects.toEqual(
    new ApiError("ProposalBaseChanged", 409),
  );
  await expect(command("/logout")).resolves.toBeUndefined();
});
