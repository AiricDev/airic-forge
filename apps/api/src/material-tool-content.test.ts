import assert from "node:assert/strict";
import test from "node:test";
import { materialToolContent } from "./material-tool-content.js";
import { materialObservation } from "@airic-forge/domain";
import { toPiTool } from "./pi-work-agent.js";

test("material pixels enter the actual Pi tool as image content, never base64 text or trajectory", async () => {
  const result = { status: "ready", source: { revision_id: "v1", page: 2, sha256: "original" },
    text: "Actual page text", warnings: ["reference_data_not_instructions"],
    image: { mimeType: "image/png", data: "validated-pixels" } };
  const tool = toPiTool({ capability: { id: "asset.read", title: "Read material", kind: "query",
    description: "", inputSchema: { type: "object" }, outputSchema: {} }, invoke: async () => result }, true);
  const response = await tool.execute("call", {}, new AbortController().signal, undefined, {} as Parameters<typeof tool.execute>[4]);
  assert.equal(response.content[1].type, "image");
  assert.deepEqual(response.content[1], { type: "image", mimeType: "image/png", data: "validated-pixels" });
  assert(!JSON.stringify(response.content[0]).includes("validated-pixels"));
  const observation = materialObservation(result);
  assert.equal(observation.imageAvailable, true);
  assert.equal(observation.textCharacters, 16);
  assert(!JSON.stringify(observation).includes("Actual page text"));
  assert(!JSON.stringify(observation).includes("validated-pixels"));
});

test("a text-only model receives an explicit visual handoff, not pretend image inspection", () => {
  const content = materialToolContent({ source: { revision_id: "v1", page: 1 },
    image: { mimeType: "image/png", data: "pixels" } }, false);
  assert.equal(content.length, 1);
  assert.equal(content[0].type, "text");
  assert.match(JSON.stringify(content), /unsupported_by_model/);
  assert(!JSON.stringify(content).includes("pixels"));
});

test("text fragments do not imply image inspection and retain the exact source range", () => {
  const range={offset:4000,end:4010,total:9000,next_offset:4010,has_more:true,unit:"unicode_code_point"};
  const result={source:{revision_id:"fixed",sha256:"hash",text_range:range},text:"😀".repeat(10)};
  const content=materialToolContent(result,true);
  assert.equal(content.length,1);assert.match(JSON.stringify(content),/not_requested_or_unavailable/);
  const observation=materialObservation(result);
  assert.equal(observation.textCharacters,10);
  assert.deepEqual((observation.source as Record<string,unknown>).text_range,range);
  assert.ok(!JSON.stringify(observation).includes(result.text));
});
