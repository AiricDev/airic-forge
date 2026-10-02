import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface TrajectoryEvent {
  id: string;
  workId: string;
  turnId?: string;
  type: "turn.started" | "turn.completed" | "context.assembled" | "message" | "action" | "error";
  at: string;
  payload: Record<string, unknown>;
}

export class JsonlTrajectoryStore {
  constructor(private readonly dataDir: string) {}
  append(event: TrajectoryEvent): void {
    const directory = join(this.dataDir, "trajectories", event.workId); mkdirSync(directory, { recursive: true });
    appendFileSync(join(directory, "segment-0001.jsonl"), `${JSON.stringify(event)}\n`, "utf8");
  }
  read(workId: string): TrajectoryEvent[] {
    try { return readFileSync(join(this.dataDir, "trajectories", workId, "segment-0001.jsonl"), "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as TrajectoryEvent); }
    catch { return []; }
  }
}
