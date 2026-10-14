/** Independent real-HTTP search/read probe; no professional writes or model calls. */
import assert from "node:assert/strict";
import {mkdtempSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {ForgeUseCases, type AgentRunnerPort} from "@airic-forge/domain";
import {ForgeRuntime} from "./runtime.js";
import {hashPassword, verifyPassword} from "./auth.js";
import {systemPort} from "./system-port.js";
let input = "";
for await (const chunk of process.stdin) input += chunk;
const scene = JSON.parse(input) as {origin: string; token: string; organizationId: string; reportId: string; omSource: string};
const root = mkdtempSync(join(tmpdir(), "forge-material-search-"));
const runtime = new ForgeRuntime({port: 0, projectDir: join(root, "project"), dataDir: join(root, "data"), seedProjectDir: scene.omSource, reportWorkDefinitionId: "report-authoring", webDistDir: join(root, "web"), certLabUrl: scene.origin, organizationId: scene.organizationId, allowedOrigin: "http://localhost", initialAdminEmails: new Set(["material-acceptance@example.invalid"])});
let originalText = "";
let pixels = "";
const agents: AgentRunnerPort = {runWork: async ({tools}) => {
  const invoke = (id: string, data: Record<string, unknown>) => tools.find(t => t.capability.id === id)!.invoke(data);
  const empty = await invoke("asset.search", {q: "UNKNOWN-NO-MATCH-MATERIAL-TOKEN"});
  assert.equal((empty.items as unknown[]).length, 0);
  assert.ok(empty.coverage && empty.warnings);
  const result = await invoke("asset.search", {q: "CE200306006851"});
  const hit = (result.items as Array<Record<string, unknown>>)[0];
  assert.ok(hit.location_id && hit.revision_id);
  const read = await invoke("asset.read-location", {revision_id: hit.revision_id, location_id: hit.location_id, include_image: true});
  assert.equal((read.source as Record<string, unknown>).sha256, hit.sha256);
  originalText = String(read.text); pixels = String((read.image as Record<string, unknown>).data);
  assert.ok(originalText.includes("CE200306006851") && pixels);
  assert.ok(!tools.some(t => ["asset.upload", "asset.adopt", "asset.accept-revision"].includes(t.capability.id)));
  return {text: "已读取固定来源；扫描文字仅用于查找，需核对原件。"};
}};
try {
  const useCases = new ForgeUseCases({accounts: runtime.db, works: runtime.db, om: runtime.om, reportWorkDefinitionId: runtime.config.reportWorkDefinitionId, app: runtime.app, organizationId: scene.organizationId, catalogs: runtime.db, agents, sessions: runtime.sessions, passwordSetups: runtime.passwordSetups, passwordCodec: {hash: hashPassword, verify: verifyPassword}, trajectories: runtime.trajectories, system: systemPort, initialAdminEmails: runtime.config.initialAdminEmails});
  const session = await useCases.bootstrap({token: scene.token, reportId: scene.reportId, goal: "Search source material and open its fixed native location; leave all assessments unchanged"});
  const catalog = await useCases.importCatalog(session.ticket);
  await useCases.acceptCatalog(session.ticket, catalog.digest);
  const head = runtime.om.head(session.user.activeBranch);
  await useCases.startTurn(session.ticket, "Find source by keywords and verify native position");
  const history = await useCases.sessionHistory(session.ticket);
  const serialized = JSON.stringify(history);
  assert.ok(originalText && !serialized.includes(originalText));
  assert.ok(pixels && !serialized.includes(pixels));
  assert.ok(!serialized.includes('"snippet"') && !serialized.includes(scene.token));
  assert.equal(runtime.om.head(session.user.activeBranch), head);
  assert.equal(history.events.filter(e => e.type === "observation" && ["asset.search", "asset.read-location"].includes(String(e.payload.capabilityId))).length, 3);
  process.stdout.write(JSON.stringify({searchThenAlternateQueryThenRead: true, exactSourceValidated: true, coverageReported: true, textSnippetsAndPixelsAbsentFromHistory: true, activeOmUnchanged: true, noUploadOrAdoptionTool: true}));
} finally {runtime.db.close(); rmSync(root, {recursive: true, force: true});}
