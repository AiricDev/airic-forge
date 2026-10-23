import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadConfig } from "./config.js";
import { resolveAgentResources, checkAgentResources } from "./agent-resources.js";
import { acquireServiceLock } from "./service-lock.js";
import { openNativeSession } from "./pi-native-session.js";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "forge-agent-config-"));
  const configRoot = join(root, "agent");
  for (const kind of ["work", "reflection"]) { mkdirSync(join(configRoot, kind), { recursive: true }); writeFileSync(join(configRoot, kind, "settings.json"), "{}"); }
  const config = { ...loadConfig({}), dataDir: join(root, "data"), agentConfigDir: configRoot, modelProvider: "deepseek", modelId: "deepseek-flash", modelApiKey: "synthetic" };
  return { root, configRoot, config };
}

test("native packages load explicit extensions, freeze resources and rotate sessions without inheriting Work resources in Reflection", async () => {
  const f = fixture();
  const pkg = join(f.configRoot, "package"); mkdirSync(join(pkg, "reading"), { recursive: true });
  writeFileSync(join(pkg, "package.json"), JSON.stringify({ name: "local-reading", pi: { extensions: ["./extension.ts"], skills: ["./reading"] } }));
  writeFileSync(join(pkg, "extension.ts"), `export default function(pi:any){pi.registerTool({name:'example_source',label:'Example',description:'Read a source',parameters:{type:'object',properties:{}},execute:async()=>({content:[{type:'text',text:'example'}]})});}`);
  const text = "---\nname: example-reading\ndescription: Read example documents.\n---\nRead the original.\n";
  writeFileSync(join(pkg, "reading", "SKILL.md"), text);
  writeFileSync(join(f.configRoot, "work", "settings.json"), JSON.stringify({ packages: ["../package"] }));
  const input = { scope: { organizationId: "org", ownerUserId: "owner", workId: "work", turnId: "turn", omRevision: "om", catalogDigest: "tools" }, kind: "work" as const, id: "work", tools: [], instructions: "Read example documents.", documents: [] };
  try {
    const checked = await checkAgentResources(f.config, true); assert.equal(checked.work.extensions, 1); assert.equal(checked.reflection.extensions, 0);
    const first = await openNativeSession(f.config, input);
    assert(first.session.getAllTools().some(t => t.name === "example_source"));
    assert.match(first.session.systemPrompt, /working-notes/);
    assert.doesNotMatch(first.session.systemPrompt, /<name>pdf-reading<\/name>/);
    first.session.sessionManager.appendMessage({ role: "user", content: "Synthetic request", timestamp: 0 });
    writeFileSync(join(first.cwd, "progress.md"), "Original source page 2; next inspect figure.");
    const oldFile = first.sessionFile;
    const frozen = await resolveAgentResources(f.config, "work");
    await first.close();
    writeFileSync(join(pkg, "reading", "SKILL.md"), text + "Inspect the original image.\n");
    assert.equal(readFileSync(frozen.skills.at(-1)!.endsWith(".md") ? frozen.skills.at(-1)! : join(frozen.skills.at(-1)!, "SKILL.md"), "utf8"), text);
    const changed = await openNativeSession(f.config, input);
    assert.notEqual(changed.sessionFile, oldFile); assert.match(readFileSync(join(changed.cwd, "progress.md"), "utf8"), /page 2/);
    await changed.close();
    const reflection = await openNativeSession(f.config, { ...input, kind: "reflection", id: "reflection" });
    assert(!reflection.session.getAllTools().some(t => t.name === "example_source")); await reflection.close();
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test("configuration errors fail before any package install and autoloaded host files are excluded", async () => {
  const f = fixture();
  try {
    const file = join(f.configRoot, "work", "settings.json");
    writeFileSync(file, JSON.stringify({ packages: ["npm:example@latest"] }));
    await assert.rejects(() => resolveAgentResources(f.config, "work"), /AgentPackageVersionRequired/);
    writeFileSync(file, JSON.stringify({ packages: ["git:github.com/example/package@main"] }));
    await assert.rejects(() => resolveAgentResources(f.config, "work"), /AgentPackageRevisionRequired/);
    writeFileSync(file, JSON.stringify({ extensions: ["missing.ts"] }));
    await assert.rejects(() => resolveAgentResources(f.config, "work"), /AgentResourceMissing/);
    writeFileSync(file, "{}");
    mkdirSync(join(f.config.dataDir, "agent-packages", "extensions"), { recursive: true });
    writeFileSync(join(f.config.dataDir, "agent-packages", "extensions", "host.ts"), "throw Error('MustNotLoadHost');");
    assert.equal((await resolveAgentResources(f.config, "work")).extensions.length, 0);
    const release = acquireServiceLock(f.config.dataDir);
    await assert.rejects(() => checkAgentResources(f.config, true), /ForgeServiceRunning/); release();
    await assert.rejects(() => checkAgentResources({ ...f.config, requiredPrograms: ["missing-forge-program-123"] }), /AgentProgramMissing/);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});
