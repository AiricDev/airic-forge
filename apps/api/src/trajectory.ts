import { appendFileSync, existsSync, mkdirSync, readFileSync, truncateSync } from "node:fs";
import { join } from "node:path";
import type { TrajectoryEvent } from "@airic-forge/domain";

export class JsonlTrajectoryStore {
  constructor(private readonly dataDir: string) {}
  append(event: TrajectoryEvent): void {
    const directory = join(this.dataDir, "trajectories", event.workId); mkdirSync(directory, { recursive: true });
    const path = join(directory, "segment-0001.jsonl");
    if (existsSync(path)) {
      const text = readFileSync(path, "utf8");
      if (text && !text.endsWith("\n")) {
        const lastNewline = text.lastIndexOf("\n");
        const tail = text.slice(lastNewline + 1);
        try { JSON.parse(tail); appendFileSync(path, "\n", "utf8"); }
        catch { appendFileSync(join(directory, "truncated-tail.txt"), tail + "\n", "utf8"); truncateSync(path, lastNewline + 1); }
      }
    }
    appendFileSync(path, `${JSON.stringify(event)}\n`, "utf8");
  }
  read(workId: string): TrajectoryEvent[] {
    const path = join(this.dataDir, "trajectories", workId, "segment-0001.jsonl");
    if (!existsSync(path)) return [];
    const content = readFileSync(path, "utf8");
    const complete = content.endsWith("\n") ? content : content.slice(0, content.lastIndexOf("\n") + 1);
    const seen = new Set<string>();
    return complete.split("\n").filter(Boolean).map((line) => JSON.parse(line) as TrajectoryEvent).filter((event) => {
      if (seen.has(event.id)) return false;
      seen.add(event.id);
      return true;
    });
  }
}
