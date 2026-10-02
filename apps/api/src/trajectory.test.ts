import assert from "node:assert/strict";
import { appendFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { JsonlTrajectoryStore } from "./trajectory.js";

test("JSONL recovery keeps complete events, drops duplicate IDs and isolates a truncated tail", () => {
  const directory = mkdtempSync(join(tmpdir(), "forge-trajectory-"));
  try {
    const store = new JsonlTrajectoryStore(directory);
    const event = { id: "evt-1", workId: "work", type: "message" as const, at: "now", payload: {} };
    store.append(event);
    store.append(event);
    const path = join(directory, "trajectories", "work", "segment-0001.jsonl");
    appendFileSync(path, '{"id":"incomplete"');
    assert.deepEqual(store.read("work"), [event]);
    store.append({ ...event, id: "evt-2" });
    assert.deepEqual(store.read("work").map((item) => item.id), ["evt-1", "evt-2"]);
    assert.match(readFileSync(join(directory, "trajectories", "work", "truncated-tail.txt"), "utf8"), /incomplete/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
