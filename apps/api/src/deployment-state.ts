/** Offline, verified deployment snapshots. Business effects are never replayed by restore. */
import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, writeFileSync, realpathSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { git } from "./personal-git-om.js";
import { assertServiceStopped } from "./service-lock.js";
import type { ForgeConfig } from "./config.js";

const sha = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
function inventory(root: string): Record<string, string> {
  const files: Record<string, string> = {};
  const walk = (path: string) => {
    if (lstatSync(path).isSymbolicLink()) throw Error("SnapshotSymlinkDenied");
    if (lstatSync(path).isDirectory()) for (const item of readdirSync(path).sort()) walk(join(path, item));
    else files[relative(root, path)] = sha(readFileSync(path));
  };
  for (const name of ["project", "data", "app"]) walk(join(root, name));
  return files;
}
function schema(dataDir: string) {
  const db = new DatabaseSync(join(dataDir, "forge.sqlite"), { readOnly: true });
  try {
    if (db.prepare("PRAGMA integrity_check").get()?.integrity_check !== "ok") throw Error("SnapshotDatabaseInvalid");
    return sha(JSON.stringify(db.prepare("SELECT type,name,sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY type,name").all()));
  } finally { db.close(); }
}
interface Manifest { version: 2; appId: string; organizationId: string; projectDir: string; dataDir: string; deploymentId: string; sourceAliases: { project: string; data: string }; schema: string; files: Record<string, string>; }
export function backupDeployment(config: ForgeConfig, target: string, appBackup: string) {
  assertServiceStopped(config.dataDir);
  target = resolve(target);
  for (const root of [config.projectDir, config.dataDir, appBackup]) {
    if (target === resolve(root) || target.startsWith(resolve(root) + "/") || resolve(root).startsWith(target + "/")) throw Error("SnapshotRootsOverlap");
  }
  if (existsSync(target)) throw Error("SnapshotTargetExists");
  const binding = JSON.parse(readFileSync(join(config.dataDir, "instance-binding.json"), "utf8"));
  if (binding.appId !== config.appId || binding.organizationId !== config.organizationId) throw Error("InstanceBindingMismatch");
  const appManifest = JSON.parse(readFileSync(join(appBackup, "manifest.json"), "utf8"));
  if (appManifest.status !== "complete") throw Error("CompleteAppBackupRequired");
  const databaseSchema = schema(config.dataDir);
  mkdirSync(target, { recursive: true, mode: 0o700 });
  cpSync(config.projectDir, join(target, "project"), { recursive: true, dereference: false });
  cpSync(config.dataDir, join(target, "data"), { recursive: true, dereference: false, filter: p => {
    const local = relative(config.dataDir, p).split("/");
    const cache = resolve(config.agentCacheDir ?? join(config.dataDir, "agent-packages"));
    return resolve(p) !== cache && !resolve(p).startsWith(cache + "/") && local[0] !== "service-lock.json";
  } });
  cpSync(appBackup, join(target, "app"), { recursive: true, dereference: false });
  const manifest: Manifest = { version: 2, appId:config.appId ?? "", organizationId: config.organizationId, projectDir: realpathSync(config.projectDir), dataDir: realpathSync(config.dataDir), deploymentId: config.deploymentId ?? "source", sourceAliases: { project: resolve(config.projectDir), data: resolve(config.dataDir) }, schema: databaseSchema, files: inventory(target) };
  writeFileSync(join(target, "manifest.json"), JSON.stringify(manifest), { flag: "wx", mode: 0o600 });
  verifyDeployment(target);
  return { target, files: Object.keys(manifest.files).length, schema: databaseSchema };
}
export function verifyDeployment(source: string): Manifest {
  const manifest = JSON.parse(readFileSync(join(source, "manifest.json"), "utf8")) as Manifest;
  if (manifest.version !== 2) throw Error("UnsupportedSnapshotVersion");
  const actual = inventory(source);
  if (JSON.stringify(actual) !== JSON.stringify(manifest.files)) throw Error("SnapshotChecksumMismatch");
  if (schema(join(source, "data")) !== manifest.schema) throw Error("SnapshotSchemaMismatch");
  return manifest;
}
export function restoreDeployment(config: ForgeConfig, source: string) {
  const manifest = verifyDeployment(source);
  if (manifest.appId !== config.appId || manifest.organizationId !== config.organizationId) throw Error("InstanceBindingMismatch");
  if (config.deploymentId !== manifest.deploymentId) throw Error("RestoreDeploymentVersionMismatch");
  if (resolve(config.projectDir).startsWith(resolve(config.dataDir) + "/") || resolve(config.dataDir).startsWith(resolve(config.projectDir) + "/") || resolve(config.dataDir) === resolve(config.projectDir)) throw Error("SnapshotRootsOverlap");
  for (const path of [config.projectDir, config.dataDir]) if (existsSync(path)) throw Error("RestoreTargetMustNotExist");
  cpSync(join(source, "project"), config.projectDir, { recursive: true });
  cpSync(join(source, "data"), config.dataDir, { recursive: true });
  const project = resolve(config.projectDir), data = resolve(config.dataDir);
  const relocated = (path: string) => {
    for (const [old, next] of [[manifest.projectDir, project], [manifest.dataDir, data], [manifest.sourceAliases.project, project], [manifest.sourceAliases.data, data]]) {
      if (path === old || path.startsWith(old + "/")) return next + path.slice(old.length);
    }
    throw Error("SnapshotExternalPathRequiresReview");
  };
  const worktrees = join(project, ".git", "worktrees");
  if (existsSync(worktrees)) for (const name of readdirSync(worktrees)) {
    const gitdir = join(worktrees, name, "gitdir");
    const file = relocated(readFileSync(gitdir, "utf8").trim());
    writeFileSync(gitdir, file + "\n");
    writeFileSync(file, `gitdir: ${join(worktrees, name)}\n`);
  }
  const repairs: string[] = [];
  const sessions = join(data, "agent-workspaces");
  const walk = (path: string) => {
    if (lstatSync(path).isDirectory()) { for (const item of readdirSync(path)) walk(join(path, item)); return; }
    if (path.endsWith("/binding.json")) {
      const binding = JSON.parse(readFileSync(path, "utf8")); binding.file = relocated(binding.file);
      writeFileSync(path, JSON.stringify(binding), { mode: 0o600 }); repairs.push(relative(data, path));
    } else if (path.endsWith(".jsonl")) {
      const content = readFileSync(path, "utf8"); const index = content.indexOf("\n");
      const header = JSON.parse(index < 0 ? content : content.slice(0, index));
      if (header.type === "session") {
        header.cwd = relocated(header.cwd);
        if (header.parentSession) header.parentSession = relocated(header.parentSession);
        writeFileSync(path, JSON.stringify(header) + (index < 0 ? "" : content.slice(index)), { mode: 0o600 }); repairs.push(relative(data, path));
      }
    }
  };
  if (existsSync(sessions)) walk(sessions);
  writeFileSync(join(data, "instance-binding.json"), JSON.stringify({ appId: config.appId ?? "", organizationId: config.organizationId, projectDir: realpathSync(project), dataDir: realpathSync(data) }), { mode: 0o600 });
  git(project, ["fsck", "--no-dangling"]);
  if (schema(data) !== manifest.schema) throw Error("SnapshotSchemaMismatch");
  writeFileSync(join(data, "restore.json"), JSON.stringify({ from: sha(readFileSync(join(source, "manifest.json"))), repairs, deploymentId: manifest.deploymentId }), { mode: 0o600 });
  return { appBackup: join(resolve(source), "app"), deploymentId: manifest.deploymentId, repairs: repairs.length };
}
