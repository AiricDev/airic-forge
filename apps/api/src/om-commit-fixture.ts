import type { OmEdit } from "@airic-forge/domain";
import type { ForgeRuntime } from "./runtime.js";
import { systemPort } from "./system-port.js";
export async function createTestOmCommit(runtime: ForgeRuntime, ownerUserId: string, edits: OmEdit[], summary: string) {
  const baseRevision = runtime.om.head(`users/${ownerUserId}`);
  const draft = await runtime.omChanges.save(ownerUserId, "manual", { baseRevision, edits, summary });
  return runtime.omChanges.commit(ownerUserId, "manual", draft.digest, systemPort.id("test"));
}
