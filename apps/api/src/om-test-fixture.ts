import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { ForgeUseCases, type ReflectionAgentPort } from "@airic-forge/domain";
import { ForgeRuntime } from "./runtime.js";
import { testCatalog } from "./certlab-test-catalog.js";
import { systemPort } from "./system-port.js";
import { hashPassword, verifyPassword } from "./auth.js";

export function omFixture(agent?: ReflectionAgentPort) {
  const root = mkdtempSync(join(tmpdir(), "forge-personal-om-"));
  const config = { port: 0, projectDir: join(root, "project"), dataDir: join(root, "data"), seedProjectDir: resolve("../../seed/certlab"), certLabUrl: "http://127.0.0.1:1", organizationId: "synthetic-org", allowedOrigin: "http://localhost:5173", initialAdminEmails: new Set<string>(), webDistDir: join(root, "web") };
  const runtime = new ForgeRuntime(config);
  const owner = runtime.db.ensureUser("om-owner@example.invalid", false);
  const other = runtime.db.ensureUser("om-other@example.invalid", false);
  const admin = runtime.db.ensureUser("om-admin@example.invalid", true);
  for (const user of [owner, other, admin]) runtime.om.ensureUserBranch(user.id);
  const catalog = testCatalog();
  runtime.db.saveCandidate(catalog, {}); runtime.db.accept("certlab", catalog.digest, admin.id);
  if (agent) Object.assign(runtime, { useCases: new ForgeUseCases({ accounts: runtime.db, works: runtime.db, om: runtime.om, omChanges: runtime.omChanges, omDrafts: runtime.drafts, organization: runtime.organization, measurements: runtime.db, instanceSettings: runtime.instanceSettings, app: runtime.app, catalogs: runtime.db, agents: { runWork: async () => ({ text: "Done" }) }, reflectionAgent: agent, reflectionRunStore: runtime.db, sessions: runtime.sessions, passwordSetups: runtime.passwordSetups, passwordCodec: { hash: hashPassword, verify: verifyPassword }, trajectories: runtime.trajectories, system: systemPort, initialAdminEmails: new Set() }) });
  const save = async (ownerUserId: string, scope: string, path: string, content: string, summary = "Improve work method") => {
    const baseRevision = runtime.om.head(`users/${ownerUserId}`);
    return runtime.omChanges.save(ownerUserId, scope, { baseRevision, edits: [{ path, content }], summary });
  };
  return { root, config, runtime, owner, other, admin, save, close: async () => { await runtime.useCases.reflectionRuns?.close(); runtime.db.close(); rmSync(root, { recursive: true, force: true }); } };
}
