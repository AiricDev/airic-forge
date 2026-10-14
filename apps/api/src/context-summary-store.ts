/** Rebuildable private memory cache, never the Work/OM/business ledger. */
import { mkdir, readFile, rename, lstat, writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { ContextSummary, ContextSummaryStore } from "@airic-forge/domain";

export class FileContextSummaryStore implements ContextSummaryStore {
  private readonly directory: string;
  constructor(dataDir: string) { this.directory = join(dataDir, "context-summaries"); }
  private path(key: string) {
    if (!/^[a-f0-9]{64}$/.test(key)) throw new Error("InvalidContextCacheKey");
    return join(this.directory, key + ".json");
  }
  async read(key: string): Promise<ContextSummary | undefined> {
    try {
      if ((await lstat(this.directory)).isSymbolicLink()) throw new Error("ContextCacheSymlinkDenied");
      const path = this.path(key), stat = await lstat(path);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 32_000) return undefined;
      const value = JSON.parse(await readFile(path, "utf8"));
      if (!value || typeof value !== "object" || typeof value.text !== "string" || !value.scope) return undefined;
      return value as ContextSummary;
    } catch (error) {
      if (error instanceof Error && error.message === "ContextCacheSymlinkDenied") throw error;
      return undefined;
    }
  }
  async write(key: string, summary: ContextSummary): Promise<void> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    if ((await lstat(this.directory)).isSymbolicLink()) throw new Error("ContextCacheSymlinkDenied");
    const path = this.path(key), temporary = path + "." + randomUUID();
    const bytes = JSON.stringify(summary);
    if (Buffer.byteLength(bytes) > 32_000) throw new Error("ContextCacheExceedsBudget");
    try { await writeFile(temporary, bytes, { flag: "wx", mode: 0o600 }); await rename(temporary, path); }
    finally { await unlink(temporary).catch(() => {}); }
  }
}
