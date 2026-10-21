import assert from "node:assert/strict";
import test from "node:test";
import { createServer, type ServerResponse } from "node:http";
import { once } from "node:events";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import type { AppCommandLocator } from "@airic-forge/domain";
import { CertLabClient } from "./certlab-client.js";
import { executionMeta } from "./mcp-client.js";
import { initialCapabilityIds, testCatalog } from "./certlab-test-catalog.js";

const locator: AppCommandLocator = { commandId: "command-one", capabilityId: "assessment.start", reportId: "report-one", assessmentId: "assessment-one", resourceKind: "project", resourceId: "project-one", scope: "assessment.start" };
const receipt = { commandId: locator.commandId, status: "committed", receipt: { key: locator.commandId, resource_kind: "project", resource_id: "project-one", scope: locator.scope, response: { id: locator.assessmentId, record_no: 1 } } };
const manifest = () => ({ appId: "certlab", organizationId: "synthetic-org", domain: { release: "certlab/v1" }, capabilities: testCatalog().tools });
type FixtureRequest = { url: string; headers: Record<string, unknown>; value: Record<string, unknown>; socket: { destroy(): void } };
type FixtureResponse = { statusCode: number; setHeader(name: string, value: string): unknown; end(data?: string): unknown };
const json = (response: FixtureResponse, body: unknown) => { response.setHeader("Content-Type", "application/json"); response.end(JSON.stringify(body)); };
async function fixture(handler: (request: FixtureRequest, response: FixtureResponse) => void | Promise<void>) {
  const server = createServer(async (req, res) => {
    if (req.url === "/api/v1/auth/me") {
      await handler({ url: req.url, headers: req.headers, value: {}, socket: req.socket }, res);
      return;
    }
    if (req.method !== "POST") { res.writeHead(405).end(); return; }
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const parsed = JSON.parse(raw);
    const sdk = new Server({ name: "fixture", version: "1" }, { capabilities: { tools: {} } });
    const invoke = async (name: string, args: Record<string, unknown>, execution: Record<string, unknown>) => {
      let value: Record<string, unknown> = {};
      let statusCode = 200;
      const response = {
        get statusCode() { return statusCode; }, set statusCode(status: number) { statusCode = status; },
        setHeader() { return response; },
        end(data?: string) { value = data ? JSON.parse(data) : {}; return response; },
      };
      await handler({ url: name, headers: req.headers, value: { ...execution, input: args }, socket: req.socket }, response);
      return { value, statusCode };
    };
    sdk.setRequestHandler(ListToolsRequestSchema, async (request) => {
      const { value } = await invoke("tools/list", request.params ?? {}, {});
      const capabilities = value.capabilities as ReturnType<typeof testCatalog>["tools"];
      return { ...(value.nextCursor ? { nextCursor: String(value.nextCursor) } : {}), tools: [...(value.noInfo ? [] : [{ name: "integration.info", inputSchema: { type: "object" } }]), ...capabilities.map(c => ({
        name: c.id, title: c.title, description: c.description, inputSchema: c.inputSchema, outputSchema: c.outputSchema,
        _meta: { [executionMeta]: { kind: c.kind, ...(c.receiptScope ? { receiptScope: c.receiptScope } : {}) } },
      }))] };
    });
    sdk.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { value, statusCode } = await invoke(request.params.name, request.params.arguments ?? {}, request.params._meta?.[executionMeta] as Record<string, unknown> ?? {});
      if (statusCode >= 400) return { isError: true, structuredContent: {
        error: { code: statusCode === 404 ? "not_found" : statusCode === 403 ? "permission_denied" : "version_conflict" },
        httpStatus: statusCode, ...(statusCode < 500 ? { outcome: "rejected" } : {}),
      }, content: [] };
      const structuredContent = { ...value };
      const image = structuredContent.image as { mimeType: string; data: string } | undefined;
      delete structuredContent.image;
      return { structuredContent, content: image ? [{ type: "image", ...image }] : [] };
    });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on("close", () => { void transport.close(); void sdk.close(); });
    await sdk.connect(transport);
    await transport.handleRequest(req, res, parsed);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return { client: new CertLabClient(`http://127.0.0.1:${address.port}/`, "synthetic-org"), close: () => new Promise<void>((resolve) => { server.close(() => resolve()); server.closeAllConnections(); }) };
}
async function body(request: FixtureRequest) { return request.value; }
test("CertLab identity and catalog bind trusted server Email, organization and allowed capabilities", async () => {
  const app = await fixture((req, res) => {
    assert.equal(req.headers.authorization, "Bearer synthetic-test");
    json(res, req.url === "/api/v1/auth/me" ? { actor_id: "actor", email: " AUTHOR@example.invalid ", display_name: "Author" } : manifest());
  });
  try {
    assert.deepEqual(await app.client.identity("synthetic-test"), { appId: "certlab", appUserId: "actor", email: "author@example.invalid", displayName: "Author", organizationId: "synthetic-org" });
    const catalog = await app.client.discoverTools("synthetic-test");
    assert.equal(catalog.tools.length, 38);
    assert.equal(catalog.digest, (await app.client.discoverTools("synthetic-test")).digest);
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
    value = { ...manifest(), capabilities: [...testCatalog().tools, { ...testCatalog().tools[4], id: "assessment.submit" }] };
    assert((await app.client.discoverTools("synthetic-test")).tools.some(tool=>tool.id==="assessment.submit"));
    value = { ...manifest(), capabilities: [testCatalog().tools[0], testCatalog().tools[0]] };
    await assert.rejects(() => app.client.discoverTools("synthetic-test"), /InvalidAppToolSnapshot/);
  } finally { await app.close(); }
});

test("CertLab command sends original key and recovers lost response by resource-scoped receipt without replay", async () => {
  let writes = 0;
  const app = await fixture(async (req, res) => {
    const envelope = await body(req);
    assert.equal(envelope.expectedDomainRelease, "certlab/v1");
    if (req.url === "assessment.start") {
      writes++;
      assert.equal(envelope.commandId, locator.commandId);
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
    await assert.rejects(() => app.client.receipt("synthetic-test", locator), /permission_denied/);
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
  const boundary = {revision: 4, status: 'confirmed', content: {scope_of_evaluation: '<p>Synthetic robot and cabinet. No excluded features.</p>', equipment_description: '<p>Robot</p><table><tbody><tr><td>Power</td><td>380 Vac</td></tr></tbody></table>'}, confirmed_by: 'engineer', confirmed_at: '2026-10-20T00:00:00Z'};
  const result={report: {evaluation_boundary: boundary, evaluation_boundary_gaps: []}, assessment_page:{total:79,limit:5,next_offset:5},selection:selected};
  const app=await fixture(async(req,res)=>{
    assert.equal(req.url,'report.context');
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


test("basis queries and fact drafts preserve report-bound command receipt identity", async () => {
  const target: AppCommandLocator = { commandId: "fact-command", capabilityId: "fact.save-draft", reportId: "report-one",
    targetKind: "report", targetId: "report-one", resourceKind: "project", resourceId: "project-one", scope: "fact.save_draft:report-one" };
  const committed = { commandId: target.commandId, status: "committed", receipt: { key: target.commandId,
    resource_kind: "project", resource_id: "project-one", scope: target.scope, target_kind: "report", target_id: "report-one",
    response: { id: "fact-one", report_id: "report-one", version: 1, status: "draft" } } };
  let foreign = false;
  const app = await fixture((req, res) => {
    if (req.url?.includes("basis.context")) json(res, { facts: [{ id: "fact-one", current_revision: 0 }], assessments: [] });
    else json(res, foreign ? { ...committed, receipt: { ...committed.receipt, response: { id: "fact-one", report_id: "foreign" } } } : committed);
  });
  try {
    assert.equal((await app.client.query("synthetic-test", "basis.context", { report_id: "report-one" })).facts instanceof Array, true);
    assert.deepEqual(await app.client.receipt("synthetic-test", target), committed);
    foreign = true;
    await assert.rejects(() => app.client.receipt("synthetic-test", target), /InvalidCommandReceipt/);
  } finally { await app.close(); }
});

test("verification drafts retain report-owned receipts and context preserves checkpoint pagination", async () => {
  const app = await fixture(async (req, res) => {
    const envelope = await body(req);
    if (req.url === "verification.context") {
      assert.deepEqual((envelope.input as Record<string, unknown>), { report_id: "report-one", result_id: "inspection-one", offset: 20, limit: 5 });
      return json(res, { id: "inspection-one", status: "recorded", current_revision: 2, recorded: { checks: [{ id: "label" }], checks_page: { offset: 20, total: 30, next_offset: 25 } } });
    }
    assert.equal(req.url, "command.context");
    assert.equal((envelope.input as Record<string, unknown>).capability_id, "verification.save-draft");
    return json(res, { resource_kind: "project", resource_id: "project-one", scope: "verification.save:report-one", target_kind: "report", target_id: "report-one" });
  });
  try {
    assert.deepEqual(await app.client.prepareCommand("synthetic-test", "verification.save-draft", { report_id: "report-one", expected_version: 0 }), { resourceKind: "project", resourceId: "project-one", scope: "verification.save:report-one", targetKind: "report", targetId: "report-one" });
    const context = await app.client.query("synthetic-test", "verification.context", { report_id: "report-one", result_id: "inspection-one", offset: 20, limit: 5 });
    assert.equal(((context.recorded as Record<string, unknown>).checks_page as Record<string, unknown>).next_offset, 25);
    assert(!initialCapabilityIds.includes("verification.record"));
    assert(!initialCapabilityIds.includes("verification.withdraw"));
  } finally { await app.close(); }
});

test("new ordinary tools need no Forge method, and tool ordering does not change the snapshot", async () => {
  const extra = { id: "report.extra-query", title: "Extra", description: "Read an extra fact", kind: "query" as const,
    inputSchema: { type: "object", properties: { report_id: { type: "string" } }, required: ["report_id"] }, outputSchema: { type: "object" } };
  let capabilities = [...testCatalog().tools, extra];
  const app = await fixture((req, res) => json(res, req.url === extra.id ? { fact: "discovered dynamically" } : { ...manifest(), capabilities }));
  try {
    const first = await app.client.discoverTools("one-user");
    capabilities.reverse();
    assert.equal((await app.client.discoverTools("one-user")).digest, first.digest);
    assert.deepEqual(await app.client.query("one-user", extra.id, { report_id: "report" }), { fact: "discovered dynamically" });
    extra.description = "Changed meaning is discovered next Turn";
    assert.notEqual((await app.client.discoverTools("one-user")).digest, first.digest);
    capabilities.push({ ...extra, id: "report.extra.query" });
    await assert.rejects(() => app.client.discoverTools("one-user"), /InvalidAppToolSnapshot/);
  } finally { await app.close(); }
});

test("MCP discovery follows bounded pagination and rejects cyclic cursors", async () => {
  const capabilities = testCatalog().tools;
  let loop = false;
  const app = await fixture((req, res) => {
    if (req.url === "tools/list") {
      const cursor = (req.value.input as Record<string, unknown>).cursor;
      json(res, { capabilities: cursor ? capabilities.slice(10) : capabilities.slice(0, 10),
        noInfo: Boolean(cursor), ...(!cursor || loop ? { nextCursor: "page-two" } : {}) });
    } else json(res, manifest());
  });
  try {
    assert.equal((await app.client.discoverTools("test")).tools.length, capabilities.length);
    loop = true;
    await assert.rejects(() => app.client.discoverTools("test"), /McpCatalogCursorLoop/);
  } finally { await app.close(); }
});

test("concurrent MCP operations never share bearer credentials between users", async () => {
  const seen = new Set<string>();
  const app = await fixture(async (req, res) => {
    const authorization = String(req.headers.authorization);
    seen.add(authorization);
    await new Promise(resolve => setTimeout(resolve, 5));
    json(res, { actor: authorization });
  });
  try {
    const results = await Promise.all(["user-one", "user-two"].map(token => app.client.query(token, "report.context", {})));
    assert.deepEqual(results, [{ actor: "Bearer user-one" }, { actor: "Bearer user-two" }]);
    assert.deepEqual(seen, new Set(["Bearer user-one", "Bearer user-two"]));
  } finally { await app.close(); }
});