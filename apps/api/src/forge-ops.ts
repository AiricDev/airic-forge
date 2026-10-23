import { unavailableApp } from "./unavailable-app.js";
import { backupDeployment, restoreDeployment, verifyDeployment } from "./deployment-state.js";
import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync, rmSync, rmdirSync, mkdtempSync } from "node:fs";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { loadConfig, type ForgeConfig } from "./config.js";
import { checkAgentResources } from "./agent-resources.js";
import { ForgeRuntime } from "./runtime.js";
import { assertServiceStopped } from "./service-lock.js";
import { bindInstanceRoots } from "./instance-binding.js";
import { git } from "./personal-git-om.js";

/** Explicit seed import for a new instance. Existing OM is never replaced by a release seed. */
export async function initializeInstance(config: ForgeConfig, seed: string) {
  assertServiceStopped(config.dataDir);
  bindInstanceRoots(config.projectDir, config.dataDir, config.organizationId, config.appId ?? "");
  const marker = join(config.dataDir, "initialization.json");
  if (existsSync(join(config.projectDir, ".git"))) {
    const previous = existsSync(marker) ? JSON.parse(readFileSync(marker, "utf8")) : undefined;
    if (previous?.state === "pending") {
      const message = git(config.projectDir, ["log", "-1", "--format=%B"]);
      if (!message.includes(`AiricForge-Seed: ${previous.seedDigest}`)) throw Error("InitializationRecoveryRequired");
      writeFileSync(marker, JSON.stringify({ ...previous, state: "complete" }), { mode: 0o600 });
    }
    return { initialized: false, revision: git(config.projectDir, ["rev-parse", "HEAD"]) };
  }
  mkdirSync(dirname(config.projectDir), { recursive: true });
  const stage = mkdtempSync(join(dirname(config.projectDir), ".forge-init-"));
  let runtime: ForgeRuntime | undefined;
  try {
    runtime = new ForgeRuntime({ ...config, projectDir: join(stage, "project"), dataDir: join(stage, "data"), seedProjectDir: seed }, unavailableApp());
    await runtime.omChanges.validate(runtime.om.head("main"));
    const tree = git(runtime.om.projectDir, ["rev-parse", "HEAD^{tree}"]);
    const seedDigest = createHash("sha256").update(tree).digest("hex");
    git(runtime.om.projectDir, ["commit", "--allow-empty", "-m", `Initialize organization OM\n\nAiricForge-Seed: ${seedDigest}`]);
    writeFileSync(marker, JSON.stringify({ state: "pending", seedDigest }), { mode: 0o600 });
    if (existsSync(config.projectDir)) rmdirSync(config.projectDir);
    renameSync(runtime.om.projectDir, config.projectDir);
    const initialized = new ForgeRuntime(config, unavailableApp());
    initialized.db.close();
    writeFileSync(marker, JSON.stringify({ state: "complete", seedDigest }), { mode: 0o600 });
    return { initialized: true, revision: git(config.projectDir, ["rev-parse", "HEAD"]), seedDigest };
  } finally { runtime?.db.close(); rmSync(stage, { recursive: true, force: true }); }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    const config = loadConfig();
    const action = process.argv[2];
    if (action === "prepare" || action === "check") console.log(JSON.stringify(await checkAgentResources(config, action === "prepare")));
    else if (action === "init" && process.argv[3]) console.log(JSON.stringify(await initializeInstance(config, process.argv[3])));
    else if (action === "backup" && process.argv[3] && process.argv[4] && process.argv.includes("--offline")) console.log(JSON.stringify(backupDeployment(config, process.argv[3], process.argv[4])));
    else if (action === "verify" && process.argv[3]) { verifyDeployment(process.argv[3]); console.log(JSON.stringify({ verified: true })); }
    else if (action === "restore" && process.argv[3]) console.log(JSON.stringify(restoreDeployment(config, process.argv[3])));
    else throw Error("Usage: forge-ops prepare | check | init /absolute/seed | backup /target /app-backup --offline | verify /snapshot | restore /snapshot");
  } catch (error) { console.error(error instanceof Error ? error.message : "ForgeOperationFailed"); process.exitCode = 1; }
}
