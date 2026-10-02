import type { SystemPort } from "@airic-forge/domain";
import { digest, id } from "./ids.js";
export const systemPort: SystemPort = { id, digest, now: () => new Date().toISOString() };
