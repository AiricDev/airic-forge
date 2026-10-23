/** Explicit deployment resources. Pi resolves packages; Forge pins their execution provenance. */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync, realpathSync, mkdirSync, cpSync, symlinkSync, mkdtempSync, renameSync, rmSync } from "node:fs";
import { dirname, isAbsolute, join, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { DefaultPackageManager, DefaultResourceLoader, SettingsManager, type ResolvedPaths } from "@earendil-works/pi-coding-agent";
import type { ForgeConfig } from "./config.js";
import { assertServiceStopped } from "./service-lock.js";

type Settings = ReturnType<SettingsManager["getSettings"]>;

export const defaultAgentConfigDir = fileURLToPath(new URL("../agent", import.meta.url));
export const pdfSkillDir = fileURLToPath(new URL("../skills/pdf-reading", import.meta.url));
export type AgentKind = "work" | "reflection";
export interface AgentResources {
  digest: string;
  settings: Partial<Settings>;
  extensions: string[];
  skills: string[];
  prompts: string[];
  files: number;
}

function fingerprint(roots: string[]): { digest: string; files: number } {
  const hash = createHash("sha256"); let files = 0;
  const seen = new Set<string>();
  const scan = (path: string, label: string) => {
    const real = realpathSync(path);
    if (seen.has(real)) return;
    seen.add(real);
    if (statSync(real).isDirectory()) {
      for (const name of readdirSync(real).sort()) {
        if (name === ".git" || name.startsWith(".env") || name === "node_modules") continue;
        scan(join(real, name), `${label}/${name}`);
      }
    } else { hash.update(label); hash.update(readFileSync(real)); files++; }
  };
  roots.forEach((path, i) => scan(path, String(i)));
  return { digest: hash.digest("hex"), files };
}

export async function resolveAgentResources(config: ForgeConfig, kind: AgentKind, prepare = false): Promise<AgentResources> {
  if (prepare) assertServiceStopped(config.dataDir);
  const configRoot = resolve(config.agentConfigDir ?? defaultAgentConfigDir);
  const file = join(configRoot, kind, "settings.json");
  if (!existsSync(file)) throw new Error(`AgentConfigurationMissing: ${file}`);
  const original = JSON.parse(readFileSync(file, "utf8")) as Partial<Settings>;
  if (!original || typeof original !== "object" || Array.isArray(original)) throw new Error("InvalidAgentSettings");
  for (const key of ["packages", "extensions", "skills", "prompts", "themes"] as const) {
    if (original[key] !== undefined && !Array.isArray(original[key])) throw Error(`InvalidAgentSettings: ${key} must be an array`);
  }
  const base = dirname(file);
  const pathFromConfig = (path: string) => {
    if (typeof path !== "string" || !path) throw new Error("InvalidAgentResourcePath");
    const resolved = isAbsolute(path) ? path : resolve(base, path);
    if (!existsSync(resolved)) throw new Error(`AgentResourceMissing: ${resolved}`);
    return resolved;
  };
  const packages = (original.packages ?? []).map(pkg => {
    const source = typeof pkg === "string" ? pkg : pkg?.source;
    if (typeof source !== "string") throw new Error("InvalidAgentPackage");
    if (source.startsWith("npm:")) {
      if (!/@[0-9]+\.[0-9]+\.[0-9]+(?:[-+][0-9A-Za-z.-]+)?$/.test(source.slice(4))) throw new Error("AgentPackageVersionRequired");
    } else if (source.startsWith("git:") || /^https?:/.test(source)) {
      if (!/@[a-f0-9]{40}$/i.test(source)) throw new Error("AgentPackageRevisionRequired");
    } else {
      const local = pathFromConfig(source);
      return typeof pkg === "string" ? local : { ...pkg, source: local };
    }
    return pkg;
  });
  const cache = resolve(config.agentCacheDir ?? join(config.dataDir, "agent-packages"));
  if (prepare) mkdirSync(cache, { recursive: true, mode: 0o700 });
  const settings: Partial<Settings> = { ...original, packages,
    extensions: (original.extensions ?? []).map(pathFromConfig),
    skills: (original.skills ?? []).map(pathFromConfig),
    prompts: (original.prompts ?? []).map(pathFromConfig),
    themes: (original.themes ?? []).map(pathFromConfig),
  };
  const manager = new DefaultPackageManager({ cwd: cache, agentDir: cache, settingsManager: SettingsManager.inMemory(settings) });
  if (prepare) for (const pkg of manager.listConfiguredPackages()) await manager.install(pkg.source);
  const resolved = await manager.resolve(async () => "error");
  const paths = (key: keyof ResolvedPaths) => resolved[key].filter(r => r.enabled && r.metadata.source !== "auto").map(r => r.path);
  const extensions = paths("extensions"), skills = [...(kind === "work" ? [pdfSkillDir] : []), ...paths("skills")];
  const roots = [file, ...extensions.map(dirname), ...skills.map(p => statSync(p).isDirectory() ? p : dirname(p)), ...paths("prompts")];
  for (const pkg of manager.listConfiguredPackages()) {
    if (!pkg.installedPath || !existsSync(pkg.installedPath)) throw new Error(`AgentPackageMissing: ${pkg.source}`);
    roots.push(pkg.installedPath);
    for (const name of ["package-lock.json", "pnpm-lock.yaml", "node_modules/.package-lock.json"]) {
      const lock = join(pkg.installedPath, name); if (existsSync(lock)) roots.push(lock);
    }
  }
  // Explicit extension files can import the App's prepared dependencies too.
  for (const extension of extensions) {
    let directory = dirname(extension);
    while (!existsSync(join(directory, "node_modules")) && dirname(directory) !== directory) directory = dirname(directory);
    for (const name of ["package-lock.json", "pnpm-lock.yaml", "node_modules/.package-lock.json"]) {
      const lock = join(directory, name); if (existsSync(lock)) roots.push(lock);
    }
  }
  // Pi's resolved installation lock records transitive dependencies; it never enters prompts.
  for (const path of [join(cache, "npm", "package-lock.json"), join(cache, "npm", "pnpm-lock.yaml")]) if (existsSync(path)) roots.push(path);
  for (const program of config.requiredPrograms ?? ["git"]) {
    const result = spawnSync("which", [program], { encoding: "utf8" });
    if (result.status !== 0) throw new Error(`AgentProgramMissing: ${program}`);
  }
  const identity = fingerprint(roots);
  const resourcePaths = [...extensions, ...skills, ...paths("prompts")];
  let sourceRoots = [...new Set(roots.filter(p => statSync(p).isDirectory()))];
  for (const path of resourcePaths) if (!sourceRoots.some(root => path === root || path.startsWith(root + "/"))) sourceRoots.push(dirname(path));
  sourceRoots = sourceRoots.filter(root => !sourceRoots.some(other => root !== other && root.startsWith(other + "/")));
  for (const root of sourceRoots) if (cache === root || cache.startsWith(root + "/") || resolve(config.dataDir).startsWith(root + "/")) throw Error("AgentSourceContainsRuntime");
  const snapshots = join(cache, "resources"); mkdirSync(snapshots, { recursive: true, mode: 0o700 });
  const snapshot = join(snapshots, identity.digest);
  if (!existsSync(snapshot)) {
    const stage = mkdtempSync(join(snapshots, ".prepare-"));
    try {
      sourceRoots.forEach((root, i) => {
        const target = join(stage, String(i));
        cpSync(root, target, { recursive: true, filter: p => !relative(root, p).split("/").some(n => n === ".git" || n === "node_modules" || n.startsWith(".env")) });
        let dependencyRoot = root;
        while (!existsSync(join(dependencyRoot, "node_modules")) && dirname(dependencyRoot) !== dependencyRoot) dependencyRoot = dirname(dependencyRoot);
        if ((existsSync(join(root, "package.json")) || extensions.some(path => path.startsWith(root + "/"))) && existsSync(join(dependencyRoot, "node_modules"))) symlinkSync(join(dependencyRoot, "node_modules"), join(target, "node_modules"));
      });
      if (fingerprint(roots).digest !== identity.digest) throw Error("AgentResourceChangedDuringLoad");
      try { renameSync(stage, snapshot); } catch (error) { if (!existsSync(snapshot)) throw error; }
    } finally { rmSync(stage, { recursive: true, force: true }); }
  }
  const pinnedPath = (path: string) => {
    const i = sourceRoots.findIndex(root => path === root || path.startsWith(root + "/"));
    return join(snapshot, String(i), path.slice(sourceRoots[i].length));
  };
  return { ...identity, settings, extensions: extensions.map(pinnedPath), skills: skills.map(pinnedPath), prompts: paths("prompts").map(pinnedPath) };
}

export async function checkAgentResources(config: ForgeConfig, prepare = false) {
  const result: Record<string, { digest: string; files: number; extensions: number; skills: number }> = {};
  for (const kind of ["work", "reflection"] as const) {
    const resources = await resolveAgentResources(config, kind, prepare);
    const loader = new DefaultResourceLoader({ cwd: config.dataDir, agentDir: config.dataDir,
      settingsManager: SettingsManager.inMemory({}), noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
      additionalExtensionPaths: resources.extensions, additionalSkillPaths: resources.skills, additionalPromptTemplatePaths: resources.prompts });
    await loader.reload();
    const errors = [...loader.getExtensions().errors, ...loader.getSkills().diagnostics];
    if (errors.length) throw new Error(`AgentResourceLoadFailed: ${kind}: ${errors.map(e => "path" in e ? e.path : "resource").join(", ")}`);
    result[kind] = { digest: resources.digest, files: resources.files, extensions: resources.extensions.length, skills: resources.skills.length };
  }
  return result;
}
