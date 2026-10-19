/** B4 synthetic real-HTTP probe. Original materials and OM are never edited. */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ForgeUseCases, type AgentRunnerPort } from "@airic-forge/domain";
import { ForgeRuntime } from "./runtime.js";
import { toPiTool } from "./pi-work-agent.js";
import { hashPassword, verifyPassword } from "./auth.js";
import { systemPort } from "./system-port.js";

let input = "";
for await (const chunk of process.stdin) input += chunk;
const scene = JSON.parse(input) as { origin: string; token: string; organizationId: string;
  reportId: string; assessmentId: string; omSource: string; assets: Record<string, { id: string; revisionId: string }>; replacementId: string };
const root = mkdtempSync(join(tmpdir(), "forge-certlab-b4-"));
const runtime = new ForgeRuntime({ port: 0, projectDir: join(root, "project"), dataDir: join(root, "data"),
  seedProjectDir: scene.omSource, reportWorkDefinitionId: "certification-assessment",
  webDistDir: join(root, "web"), certLabUrl: scene.origin, organizationId: scene.organizationId,
  allowedOrigin: "http://localhost", initialAdminEmails: new Set(["synthetic-engineer@example.invalid"]) });
const commands: string[] = [];
let turns = 0;
let pixelsDelivered = 0;
const agents: AgentRunnerPort = { runWork: async ({ tools, context, documents, loadDocument }) => {
  assert.equal(context.workDefinitionId, "certification-assessment");
  assert(documents.some((item) => item.id === "knowledge-routing"));
  assert((await loadDocument("semi-s2-0724-clause-12-2-3")).includes("candidate"));
  assert((await loadDocument("precedent-semi-s2-0724-emo-circuit")).includes("candidate"));
  await assert.rejects(() => loadDocument("design/source-inventory.json"), /DocumentNotAvailable/);
  const invoke = (id: string, value: Record<string, unknown>) => tools.find((tool) => tool.capability.id === id)!.invoke(value);
  const list = await invoke("asset.list", {});
  assert.equal((list.items as unknown[]).length, 4);
  const pdfTool = tools.find((tool) => tool.capability.id === "asset.read")!;
  const pdf = await pdfTool.invoke({ revision_id: scene.assets.pdf.revisionId, page: 2, include_image: true });
  assert.equal(pdf.status, "ready");
  assert.match(String(pdf.text), /Synthetic page 2/);
  assert.equal((pdf.source as { is_current: boolean }).is_current, turns === 0);
  const pi = toPiTool({ capability: pdfTool.capability, invoke: async () => pdf }, true);
  const piResult = await pi.execute("synthetic", {}, new AbortController().signal, undefined, {} as Parameters<typeof pi.execute>[4]);
  assert.equal(piResult.content[1].type, "image");
  pixelsDelivered++;
  if (turns++ === 0) {
    for (const kind of ["png", "jpeg", "text"]) {
      const value = await invoke("asset.read", { revision_id: scene.assets[kind].revisionId, page: 1, include_image: true });
      assert.equal(value.status, "ready");
      if (kind === "text") assert.match(String(value.text), /Synthetic reference material/);
      else assert.equal((value.image as { mimeType: string }).mimeType, "image/png");
    }
    const badPage = await invoke("asset.read", { revision_id: scene.assets.pdf.revisionId, page: 3 });
    assert.equal(badPage.status, "unavailable");
    assert.equal(badPage.reason, "page_out_of_range");
    for (const [id, value] of [
      ["assessment.start", { assessment_id: scene.assessmentId, expected_record_no: 0 }],
      ["assessment.save-draft", { assessment_id: scene.assessmentId, expected_record_no: 1,
        result_fields: { note: "Synthetic source read, professional result remains undetermined" },
        rationale: "Synthetic source read only; requires human verification.",
        evidence_refs: [{ asset_revision_id: scene.assets.pdf.revisionId, locator: "page 2" }] }],
    ] as Array<[string, Record<string, unknown>]>) {
      const outcome = await invoke(id, value);
      assert.equal(outcome.status, "committed");
      commands.push(String(outcome.commandId));
    }
  }
  return { text: "Original revision and page read. Professional conclusion remains undetermined." };
} };
try {
  const useCases = new ForgeUseCases({ accounts: runtime.db, works: runtime.db, om: runtime.om,
    reportWorkDefinitionId: runtime.config.reportWorkDefinitionId, app: runtime.app,
    organizationId: scene.organizationId, catalogs: runtime.db, agents, sessions: runtime.sessions,
    passwordSetups: runtime.passwordSetups, passwordCodec: { hash: hashPassword, verify: verifyPassword },
    trajectories: runtime.trajectories, system: systemPort, initialAdminEmails: runtime.config.initialAdminEmails });
  const session = await useCases.bootstrap({ token: scene.token, reportId: scene.reportId });
  const candidate = await useCases.importCatalog(session.ticket);
  assert.equal(candidate.capabilities.length, 31);
  await useCases.acceptCatalog(session.ticket, candidate.digest);
  const head = runtime.om.head(session.user.activeBranch);
  await useCases.startTurn(session.ticket, "Read source v1");
  const first = await useCases.sessionHistory(session.ticket);
  const original = first.events.find((event) => event.type === "observation" && event.payload.capabilityId === "asset.read")!;
  const adopted = await fetch(`${scene.origin}/api/v1/assets/${scene.assets.pdf.id}/accept-revision`, {
    method: "POST", headers: { Authorization: `Bearer ${scene.token}`, "Content-Type": "application/json", "Idempotency-Key": "synthetic-human-adoption" },
    body: JSON.stringify({ revision_id: scene.replacementId, expected_version: 2, expected_current_revision_id: scene.assets.pdf.revisionId }),
  });
  assert.equal(adopted.status, 200);
  await useCases.checkpointFeedback(session.ticket, { checkpointId: first.progress.checkpoint!.id, kind: "correct",
    note: "A human adopted v2; retain original source and re-read current facts." }, "synthetic-b4-correction");
  await useCases.startTurn(session.ticket, "Recheck original v1 after adoption");
  const history = await useCases.sessionHistory(session.ticket);
  const reads = history.events.filter((event) => event.type === "observation" && event.payload.capabilityId === "asset.read");
  assert.deepEqual(history.events.find((event) => event.id === original.id), original);
  assert.equal(runtime.om.head(session.user.activeBranch), head);
  const serialized = JSON.stringify(history);
  assert(!serialized.includes(scene.token));
  assert(!serialized.includes("Synthetic reference material"));
  assert(!serialized.includes("Synthetic page 2"));
  assert(!serialized.includes('"data":'));
  assert(reads.some((event) => (event.payload.result as { source: { is_current: boolean } }).source.is_current === false));
  process.stdout.write(JSON.stringify({ status: "passed", commands, pixelsDelivered,
    initialOmUsed: true, nestedKnowledgeAndPrecedentLoaded: true, designExcluded: true,
    originalSourcePreservedAfterAdoption: true, fullTextAndPixelsAbsentFromHistory: true,
    unsupportedPageVisible: true, manualConfirmationPreserved: true, activeOmUnchanged: true,
    tokenAbsentFromHistory: true }));
} finally { runtime.db.close(); rmSync(root, { recursive: true, force: true }); }
