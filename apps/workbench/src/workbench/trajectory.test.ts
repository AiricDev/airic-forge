import { expect, it } from "vitest";
import { presentationEvents } from "./trajectory";
import type { TrajectoryEvent } from "./types";

const event = (
  id: string,
  type: string,
  payload: Record<string, unknown>,
): TrajectoryEvent => ({
  id,
  turnId: "turn-1",
  type,
  payload,
  at: "2026-10-19T00:00:00Z",
});
it("shows completed answers once while keeping a cited fragment addressable", () => {
  const events = [
    event("part-1", "message", { agentTextDelta: "Hello " }),
    event("part-2", "message", { agentTextDelta: "world" }),
    event("final", "turn.completed", { text: "Hello world" }),
  ];
  const original = JSON.stringify(events);
  expect(presentationEvents(events).map((e) => e.id)).toEqual(["final"]);
  expect(presentationEvents(events, "part-1").map((e) => e.id)).toEqual([
    "part-1",
    "final",
  ]);
  expect(JSON.stringify(events)).toBe(original);
});
it("coalesces unfinished historical fragments without combining unrelated turns", () => {
  const events = [
    event("part-1", "message", { agentTextDelta: "部分" }),
    {
      ...event("other", "message", {
        partial: true,
        agentTextDelta: "Other turn",
      }),
      turnId: "turn-2",
    },
    event("part-2", "message", { agentTextDelta: "回复" }),
  ];
  expect(presentationEvents(events)).toEqual([
    events[1],
    {
      ...events[2],
      payload: {
        agentTextDelta: "部分回复",
        partial: true,
        historicalFragmentCount: 2,
      },
    },
  ]);
});
