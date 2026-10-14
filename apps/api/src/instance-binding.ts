import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

const canonical = (path: string): string => {
  let parent = resolve(path);
  const suffix: string[] = [];
  while (!existsSync(parent)) { suffix.unshift(basename(parent)); parent = dirname(parent); }
  return join(realpathSync(parent), ...suffix);
};

/** Validate both roots before creating either one or opening a database. */
export function bindCertLabRoots(projectDir: string, dataDir: string, organizationId: string): void {
  if (!organizationId.trim() || organizationId.length > 200) throw new Error("OrganizationIdRequired");
  for (const root of [projectDir, dataDir]) if (existsSync(root) && lstatSync(root).isSymbolicLink()) throw new Error("InstanceRootSymlinkDenied");
  const project = canonical(projectDir), data = canonical(dataDir);
  if (project === data || project.startsWith(data + "/") || data.startsWith(project + "/")) throw new Error("InstanceRootsMustBeSeparate");
  const marker = join(data, "instance-binding.json");
  const expected = { appId: "certlab", organizationId, projectDir: project, dataDir: data };
  if (existsSync(marker)) {
    const value = JSON.parse(readFileSync(marker, "utf8"));
    if (JSON.stringify(value) !== JSON.stringify(expected)) throw new Error("InstanceBindingMismatch");
    return;
  }
  for (const root of [project, data]) {
    if (existsSync(root) && readdirSync(root).length) throw new Error("ExistingUnboundRootDenied");
  }
  mkdirSync(data, { recursive: true });
  writeFileSync(marker, JSON.stringify(expected), { flag: "wx", mode: 0o600 });
}
