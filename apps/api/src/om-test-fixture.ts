import { testUser } from "./test-users.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { ForgeUseCases, type ReflectionAgentPort } from "@airic-forge/domain";
import { ForgeRuntime } from "./runtime.js";
import { systemPort } from "./system-port.js";
import { hashPassword, verifyPassword } from "./auth.js";

export function omFixture(agent?: ReflectionAgentPort) {
  const root = mkdtempSync(join(tmpdir(), "forge-personal-om-"));
  const config = { port: 0, projectDir: join(root, "project"), dataDir: join(root, "data"), seedProjectDir: resolve("../../seed/certlab"), certLabUrl: "http://127.0.0.1:1", organizationId: "synthetic-org", allowedOrigin: "http://localhost:5173", webDistDir: join(root, "web") };
  const runtime = new ForgeRuntime(config);
  const owner = testUser(runtime.db, "om-owner@example.invalid", false);
  const other = testUser(runtime.db, "om-other@example.invalid", false);
  const admin = testUser(runtime.db, "om-admin@example.invalid", true);
  for (const user of [owner, other, admin]) runtime.om.ensureUserBranch(user.id);
  if (agent) Object.assign(runtime, { useCases: new ForgeUseCases({ accounts: runtime.db, works: runtime.db, om: runtime.om, omChanges: runtime.omChanges, omDrafts: runtime.drafts, organization: runtime.organization, measurements: runtime.db, instanceSettings: runtime.instanceSettings, app: runtime.app, toolSnapshots: runtime.db, agents: { runWork: async () => ({ text: "Done" }) }, reflectionAgent: agent, reflectionRunStore: runtime.db, sessions: runtime.sessions, passwordSetups: runtime.passwordSetups, passwordCodec: { hash: hashPassword, verify: verifyPassword }, trajectories: runtime.trajectories, system: systemPort, }) });
  const save = async (ownerUserId: string, scope: string, path: string, content: string, summary = "Improve work method") => {
    const baseRevision = runtime.om.head(`users/${ownerUserId}`);
    return runtime.omChanges.save(ownerUserId, scope, { baseRevision, edits: [{ path, content }], summary });
  };
  return { root, config, runtime, owner, other, admin, save, close: async () => { await runtime.useCases.reflectionRuns?.close(); runtime.db.close(); rmSync(root, { recursive: true, force: true }); } };
}
