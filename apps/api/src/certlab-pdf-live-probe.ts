/** Real CertLab MCP -> Forge validation -> actual Pi tool image blocks, synthetic/read-only. */
import assert from "node:assert/strict";
import { CertLabClient } from "./certlab-client.js";
import { toMcpTool } from "./work-mcp-bridge.js";
import { materialObservation } from "@airic-forge/domain";

let input = "";
for await (const chunk of process.stdin) input += chunk;
const scene = JSON.parse(input) as {origin: string; token: string; organizationId: string;
  reportId: string; assets: {pdf: {revisionId: string}}};
const app = new CertLabClient(scene.origin, scene.organizationId);
const snapshot = await app.discoverTools(scene.token);
const base = {report_id: scene.reportId, revision_id: scene.assets.pdf.revisionId};
const definition = snapshot.tools.find(tool => tool.id === "asset.read")!;
assert(definition);
const pi = toMcpTool({capability: definition, invoke: args => app.query(scene.token, definition.id, args)}, true);
const region = {left: 0, top: 0, right: 0.5, bottom: 0.5};
const result = await pi.invoke({...base,page:1});
assert.equal(result.content[1].type, "image");
assert.equal(result.content[0].type, "text");
if (result.content[0].type !== "text") throw Error("Missing original text");
const metadata = JSON.parse(result.content[0].text);
assert.match(metadata.text, /Synthetic page 1/);
assert.equal(metadata.imageInputStatus, "provided");
assert(!result.content[0].text.includes('"data":'));
const detail = await app.query(scene.token, "asset.read", {...base, page: 1, region});
assert.deepEqual((detail.source as {region: unknown}).region, region);
assert.equal(detail.text, metadata.text);
const positions = await app.query(scene.token, "asset.locations", base);
const first = (positions.items as Array<{location_id: string}>)[0]!;
const fixed = await app.query(scene.token, "asset.read-location", {...base, location_id: first.location_id, region});
assert.deepEqual(fixed.image, detail.image);
const text = await app.query(scene.token, "asset.read", {...base, page: 1, include_image: false});
assert.equal(text.image, undefined);
const observation = materialObservation(detail);
assert.deepEqual((observation.source as {region: unknown}).region, region);
assert(!JSON.stringify(observation).includes("Synthetic page 1"));
assert(!JSON.stringify(observation).includes('"data":'));
process.stdout.write(JSON.stringify({status: "passed", default_pixels_reached_pi: true,
  region_bound_to_source: true, indexed_region_matches_direct: true,
  full_page_text_scope_preserved: true, text_only_respected: true,
  pixels_and_source_text_absent_from_observation: true, external_model_calls: 0}));
