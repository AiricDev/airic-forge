import { existsSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
export function assertServiceStopped(dataDir: string) {
  const path = join(dataDir, "service-lock.json");
  if (!existsSync(path)) return;
  const { pid } = JSON.parse(readFileSync(path, "utf8")) as { pid: number };
  if (!Number.isSafeInteger(pid) || pid <= 0) throw Error("InvalidServiceLock");
  try { process.kill(pid, 0); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ESRCH") return; throw error; }
  throw Error("ForgeServiceRunning");
}
export function acquireServiceLock(dataDir: string) {
  assertServiceStopped(dataDir);
  const path = join(dataDir, "service-lock.json");
  if (existsSync(path)) unlinkSync(path);
  const value = JSON.stringify({ pid: process.pid, id: randomUUID() });
  writeFileSync(path, value, { flag: "wx", mode: 0o600 });
  return () => { if (existsSync(path) && readFileSync(path, "utf8") === value) unlinkSync(path); };
}
