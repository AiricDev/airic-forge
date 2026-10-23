import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { promisify } from "node:util";
import type { EvidenceExtractorPort, EvidenceSessionPort, ExtractedEvidence } from "@airic-forge/domain";

const execute = promisify(execFile);
const maxFileBytes = 8 * 1024 * 1024;
const maxTextChars = 100_000;
const mediaTypes: Record<string, string[]> = {
  ".pdf": ["application/pdf", "application/octet-stream"],
  ".txt": ["text/plain", "application/octet-stream"],
};

/** Extraction is an adapter: only bounded readable text crosses into a Work Turn. */
export class LocalEvidenceExtractor implements EvidenceExtractorPort {
  async extract(name: string, mediaType: string, content: Uint8Array): Promise<ExtractedEvidence> {
    const filename = basename(name).slice(0, 120);
    const extension = filename.slice(filename.lastIndexOf(".")).toLowerCase();
    if (!mediaTypes[extension]?.includes(mediaType.toLowerCase())) throw new Error("UnsupportedEvidenceType");
    if (!content.length || content.length > maxFileBytes) throw new Error("EvidenceSizeOutOfRange");
    const digest = createHash("sha256").update(content).digest("hex");
    let value: string;
    if (extension === ".txt") value = new TextDecoder("utf-8", { fatal: true }).decode(content);
    else {
      const directory = await mkdtemp(join(tmpdir(), "airicforge-evidence-"));
      const path = join(directory, `input${extension}`);
      try {
        await writeFile(path, content);
        value = (await execute("pdftotext", [path, "-"], { timeout: 20_000, maxBuffer: 2 * 1024 * 1024 })).stdout;
      } catch { throw new Error("EvidenceExtractionFailed"); }
      finally { await rm(directory, { recursive: true, force: true }); }
    }
    if (!value.trim()) throw new Error("EvidenceHasNoReadableText");
    const warnings = value.length > maxTextChars ? ["Extracted text was truncated to 100000 characters"] : [];
    return { filename, digest, text: value.slice(0, maxTextChars), warnings };
  }
}

/** Temporary, ticket-scoped, single-use evidence. Raw files and text never enter SQLite or JSONL. */
export class InMemoryEvidenceSessionStore implements EvidenceSessionPort {
  readonly #pending = new Map<string, Map<string, ExtractedEvidence>>();
  put(ticket: string, evidence: ExtractedEvidence): void {
    const items = this.#pending.get(ticket) ?? new Map<string, ExtractedEvidence>();
    if (!items.has(evidence.digest) && items.size >= 3) throw new Error("TooManyEvidenceFiles");
    items.set(evidence.digest, evidence);
    this.#pending.set(ticket, items);
  }
  take(ticket: string, digests: string[]): ExtractedEvidence[] {
    const items = this.#pending.get(ticket);
    if (!items || digests.some((digest) => !items.has(digest))) throw new Error("EvidenceNotAvailable");
    const selected = digests.map((digest) => items.get(digest)!);
    for (const digest of digests) items.delete(digest);
    if (!items.size) this.#pending.delete(ticket);
    return selected;
  }
  clear(ticket: string): void { this.#pending.delete(ticket); }
}
