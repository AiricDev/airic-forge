import assert from "node:assert/strict";
import test from "node:test";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { once } from "node:events";
import type { AppCommandLocator } from "@airic-forge/domain";
import { CertLabClient } from "./certlab-client.js";
import { testCatalog } from "./certlab-test-catalog.js";

const locator: AppCommandLocator = { commandId: "command-one", capabilityId: "assessment.start", reportId: "report-one", assessmentId: "assessment-one", resourceKind: "project", resourceId: "project-one", scope: "assessment.start" };
const receipt = { commandId: locator.commandId, status: "committed", receipt: { key: locator.commandId, resource_kind: "project", resource_id: "project-one", scope: locator.scope, response: { id: locator.assessmentId, record_no: 1 } } };
const manifest = () => ({ appId: "certlab", organizationId: "synthetic-org", domain: { release: "certlab/v1" }, capabilities: testCatalog().capabilities });
const json = (response: ServerResponse, body: unknown) => { response.setHeader("Content-Type", "application/json"); response.end(JSON.stringify(body)); };
async function fixture(handler: (request: IncomingMessage, response: ServerResponse) => void | Promise<void>) {
  const server = createServer((req, res) => { Promise.resolve(handler(req, res)).catch(() => { res.statusCode = 500; res.end(); }); });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return { client: new CertLabClient(`http://127.0.0.1:${address.port}/`, "synthetic-org"), close: () => new Promise<void>((resolve) => { server.close(() => resolve()); server.closeAllConnections(); }) };
}
async function body(request: IncomingMessage) {
  let value = "";
  for await (const chunk of request) value += chunk;
  return JSON.parse(value) as Record<string, unknown>;
}

test("CertLab identity and catalog bind trusted server Email, organization and allowed capabilities", async () => {
  const app = await fixture((req, res) => {
    assert.equal(req.headers.authorization, "Bearer synthetic-test");
    json(res, req.url === "/api/v1/auth/me" ? { actor_id: "actor", email: " AUTHOR@example.invalid ", display_name: "Author" } : manifest());
  });
  try {
    assert.deepEqual(await app.client.identity("synthetic-test"), { appId: "certlab", appUserId: "actor", email: "author@example.invalid", displayName: "Author", organizationId: "synthetic-org" });
    const catalog = await app.client.catalog("synthetic-test");
    assert.equal(catalog.capabilities.length, 32);
    assert.equal(catalog.digest, (await app.client.catalog("synthetic-test")).digest);
  } finally { await app.close(); }
});

test("material transport binds the exact requested page/revision and rejects invented or active image payloads", async () => {
  const input = { report_id: "report", revision_id: "revision", page: 2, include_image: true };
  const valid = { status: "ready", text: "Untrusted reference text", warnings: [],
    source: { revision_id: "revision", page: 2, sha256: "a".repeat(64), asset_id: "asset", project_id: "project" },
    image: { mimeType: "image/png", data: Buffer.from([137,80,78,71,13,10,26,10]).toString("base64") } };
  let value: Record<string, unknown> = valid;
  const app = await fixture((req, res) => {
    assert.equal(req.headers.authorization, "Bearer synthetic-test");
    json(res, value);
  });
  try {
    assert.deepEqual(await app.client.query("synthetic-test", "asset.read", input), valid);
    for (const bad of [
      { ...valid, source: { ...valid.source, revision_id: "different" } },
      { ...valid, source: { ...valid.source, page: 1 } },
      { ...valid, image: { mimeType: "image/svg+xml", data: valid.image.data } },
      { ...valid, image: { mimeType: "image/png", data: Buffer.from("<script>not pixels</script>").toString("base64") } },
      { ...valid, status: "unavailable" },
    ]) {
      value = bad;
      await assert.rejects(() => app.client.query("synthetic-test", "asset.read", input), /InvalidMaterial/);
    }
  } finally { await app.close(); }
});

test("CertLab rejects invalid origins, absent Email, foreign organization and unsafe catalogs", async () => {
  for (const origin of ["https://user:pass@example.invalid", "https://example.invalid/path", "https://example.invalid?token=x"]) assert.throws(() => new CertLabClient(origin, "org"), /InvalidCertLabOrigin/);
  let value: Record<string, unknown> = manifest();
  let email = "";
  const app = await fixture((req, res) => json(res, req.url === "/api/v1/auth/me" ? { actor_id: "actor", email } : value));
  try {
    await assert.rejects(() => app.client.identity("synthetic-test"), /AppIdentityEmailRequired/);
    email = "author@example.invalid";
    value = { ...manifest(), organizationId: "foreign-org" };
    await assert.rejects(() => app.client.identity("synthetic-test"), /AppOrganizationBindingMismatch/);
    value = { ...manifest(), capabilities: [...testCatalog().capabilities, { ...testCatalog().capabilities[4], id: "assessment.submit" }] };
    await assert.rejects(() => app.client.catalog("synthetic-test"), /InvalidCapabilityManifest/);
    value = { ...manifest(), capabilities: [testCatalog().capabilities[0], testCatalog().capabilities[0]] };
    await assert.rejects(() => app.client.catalog("synthetic-test"), /InvalidCapabilityManifest/);
  } finally { await app.close(); }
});

test("CertLab command sends original key and recovers lost response by resource-scoped receipt without replay", async () => {
  let writes = 0;
  const app = await fixture(async (req, res) => {
    const envelope = await body(req);
    assert.equal(envelope.expectedDomainRelease, "certlab/v1");
    if (req.url?.includes("/commands/")) {
      writes++;
      assert.equal(req.headers["idempotency-key"], locator.commandId);
      req.socket.destroy();
    } else {
      assert.deepEqual(envelope.input, { report_id: locator.reportId, target_kind: "assessment", target_id: locator.assessmentId, capability_id: locator.capabilityId, command_id: locator.commandId, resource_kind: locator.resourceKind, resource_id: locator.resourceId, scope: locator.scope });
      json(res, receipt);
    }
  });
  try {
    const result = await app.client.submitCommand("synthetic-test", locator.capabilityId, { commandId: locator.commandId, expectedDomainRelease: "certlab/v1", input: { assessment_id: locator.assessmentId } });
    assert.equal(result.status, "unknown");
    assert.deepEqual(await app.client.receipt("synthetic-test", locator), receipt);
    assert.equal(writes, 1);
  } finally { await app.close(); }
});

test("CertLab distinguishes rejected commands from uncertain server and malformed responses", async () => {
  let status = 409;
  let value: unknown = receipt;
  const app = await fixture((_req, res) => { res.statusCode = status; json(res, value); });
  const envelope = { commandId: locator.commandId, input: { assessment_id: locator.assessmentId } };
  try {
    assert.equal((await app.client.submitCommand("synthetic-test", locator.capabilityId, envelope)).status, "rejected");
    status = 503;
    assert.equal((await app.client.submitCommand("synthetic-test", locator.capabilityId, envelope)).status, "unknown");
    status = 200; value = { ...receipt, commandId: "wrong-key" };
    assert.equal((await app.client.submitCommand("synthetic-test", locator.capabilityId, envelope)).status, "unknown");
    value = receipt;
    assert.equal((await app.client.submitCommand("synthetic-test", locator.capabilityId, envelope)).status, "committed");
    value = { ...receipt, receipt: { ...receipt.receipt, resource_id: "another-project" } };
    await assert.rejects(() => app.client.receipt("synthetic-test", locator), /InvalidCommandReceipt/);
    status = 404;
    assert.equal(await app.client.receipt("synthetic-test", locator), undefined);
    status = 403;
    await assert.rejects(() => app.client.receipt("synthetic-test", locator), /CertLab receipt 403/);
  } finally { await app.close(); }
});

test("CertLab never forwards bearer tokens to redirected endpoints", async () => {
  let redirected = 0;
  const app = await fixture((req, res) => {
    if (req.url === "/redirected") { redirected++; json(res, receipt); return; }
    res.statusCode = 307; res.setHeader("Location", "/redirected"); res.end();
  });
  try {
    assert.equal((await app.client.submitCommand("synthetic-test", "assessment.start", {})).status, "unknown");
    await assert.rejects(() => app.client.identity("synthetic-test"), /CertLab 307/);
    assert.equal(redirected, 0);
  } finally { await app.close(); }
});

test("native material location reads bind the exact location and search coverage is validated", async () => {
  const input = {report_id: "report", revision_id: "revision", location_id: "b".repeat(64)};
  let value: Record<string, unknown> = {status: "ready", text: "transient OCR", warnings: [], source: {revision_id: "revision", location_id: input.location_id, locator: {kind: "page", page: 49}, sha256: "a".repeat(64), asset_id: "asset", project_id: "project"}};
  const app = await fixture((_req, res) => json(res, value));
  try {
    await app.client.query("synthetic-test", "asset.read-location", input);
    value = {...value, source: {...value.source as Record<string, unknown>, location_id: "c".repeat(64)}};
    await assert.rejects(() => app.client.query("synthetic-test", "asset.read-location", input), /InvalidMaterial/);
    value = {items: [], coverage: {unsupported: 4}, warnings: ["unprocessed_materials_may_contain_evidence"]};
    await app.client.query("synthetic-test", "asset.search", {report_id: "report", q: "model"});
    value = {...value, coverage: {failed: -1}};
    await assert.rejects(() => app.client.query("synthetic-test", "asset.search", {report_id: "report", q: "model"}), /InvalidMaterialSearch/);
  } finally {await app.close();}
});

test("native ranges validate Unicode positions and remain bounded even when old metadata is absent", async () => {
  const input = {report_id:"report",revision_id:"revision",location_id:"b".repeat(64),text_offset:200000,text_limit:8000};
  const range={offset:200000,end:200045,total:200045,next_offset:null,has_more:false,unit:"unicode_code_point"};
  const source={revision_id:"revision",asset_id:"asset",project_id:"project",sha256:"a".repeat(64),location_id:input.location_id,locator:{kind:"page",page:1},text_range:range};
  const valid={status:"ready",text:"😀".repeat(45),text_range:range,source,warnings:[]};
  let value:Record<string,unknown>=valid;
  const app=await fixture((_req,res)=>json(res,value));
  try {
    assert.deepEqual(await app.client.query("synthetic-test","asset.read-location",input),valid);
    value={...valid,text_range:{...range,offset:0}};
    await assert.rejects(()=>app.client.query("synthetic-test","asset.read-location",input),/InvalidMaterialRange/);
    value={...valid,text:"x".repeat(8001)};
    await assert.rejects(()=>app.client.query("synthetic-test","asset.read-location",input),/InvalidMaterialRead/);
    value={...valid,image:{mimeType:"image/png",data:"pixels"}};
    await assert.rejects(()=>app.client.query("synthetic-test","asset.read-location",input),/UnrequestedMaterialImage/);
  } finally {await app.close();}
});

test("startup context requests five summaries and preserves the full selected assessment",async()=>{
  const selected={id:'selected',adopted_clause:{schema:{fields:[{key:'conformity',required:true}]}}};
  const result={assessment_page:{total:79,limit:5,next_offset:5},selection:selected};
  const app=await fixture(async(req,res)=>{
    assert.equal(req.url,'/airic/v1/queries/report.context');
    assert.deepEqual((await body(req)).input,{report_id:'report',assessment_limit:5,selection:{assessment_id:'selected'}});
    json(res,result);
  });
  try{assert.deepEqual(await app.client.reportContext('synthetic-test','report',{assessment_id:'selected'}),result);}finally{await app.close();}
});


test("image-only sources preserve image identity and summaries remain discovery data", async () => {
  const input = {report_id: "report", revision_id: "revision", location_id: "b".repeat(64), image_index: 0};
  let value: Record<string, unknown> = {status: "image_required", text: "", visual_summary: "铭牌型号", images: [{image_index: 0, view_sha256: "c".repeat(64), visual_summary: "铭牌型号"}], warnings: [], source: {revision_id: "revision", location_id: input.location_id, locator: {kind: "image", page: 1}, sha256: "a".repeat(64), asset_id: "asset", project_id: "project", image_index: 0}};
  const app = await fixture((_req, res) => json(res, value));
  try {
    assert.deepEqual(await app.client.query("synthetic-test", "asset.read-location", input), value);
    value = {...value, source: {...value.source as Record<string, unknown>, image_index: 1}};
    await assert.rejects(() => app.client.query("synthetic-test", "asset.read-location", input), /InvalidMaterialImageSource/);
  } finally { await app.close(); }
});


test("material snippets use Unicode code point budgets", async () => {
  let value = {items: [{asset_id: "asset", revision_id: "revision", filename: "manual.txt", path: "manual.txt", status: "ready", sha256: "a".repeat(64), location_id: "b".repeat(64), snippet: "😀".repeat(380)}], coverage: {ready: 1}, warnings: []};
  const app = await fixture((_req, res) => json(res, value));
  try {
    await app.client.query("synthetic-test", "asset.search", {report_id: "report", q: "manual"});
    value = {...value, items: [{...value.items[0]!, snippet: "😀".repeat(401)}]};
    await assert.rejects(() => app.client.query("synthetic-test", "asset.search", {report_id: "report", q: "manual"}), /InvalidMaterialSearch/);
  } finally {await app.close();}
});

test("Office whole-file reads retain logical page one and reject a mismatched page", async () => {
  const value = { status: "ready", text: "Whole document", warnings: [], source: {
    revision_id: "revision", asset_id: "asset", project_id: "project", sha256: "a".repeat(64),
    format: "docx", location_kind: "document", page: 1,
  } };
  const app = await fixture((_req, res) => json(res, value));
  try {
    assert.deepEqual(await app.client.query("test", "asset.read", { revision_id: "revision", page: 1 }), value);
    await assert.rejects(() => app.client.query("test", "asset.read", { revision_id: "revision", page: 2 }), /InvalidMaterialRead/);
  } finally { await app.close(); }
});
