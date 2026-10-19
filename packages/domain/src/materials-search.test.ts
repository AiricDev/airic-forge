import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { materialObservation } from "./materials.js";
describe("material search observations", () => {
  it("persists fixed source identity and coverage without snippets or OCR", () => {
    const result = materialObservation({items: [{revision_id: "fixed", location_id: "location", sha256: "hash", locator: {kind: "page", page: 4}, snippet: "PRIVATE OCR", text: "PRIVATE FULL TEXT", image: "PRIVATE PIXELS"}], coverage: {unsupported: 2}, warnings: ["original_required"]});
    assert.ok(!JSON.stringify(result).includes("PRIVATE"));
    assert.deepEqual(result.items, [{revision_id: "fixed", location_id: "location", sha256: "hash", locator: {kind: "page", page: 4}}]);
  });
});


it("retains image and pagination identity without persisting visual summaries", () => {
  const result = materialObservation({status: "image_required", text: "", visual_summary: "PRIVATE SUMMARY", images: [{visual_summary: "PRIVATE IMAGE SUMMARY"}], source: {revision_id: "fixed", image_index: 2, image_sha256: "hash"}, warnings: []});
  assert.ok(!JSON.stringify(result).includes("PRIVATE"));
  assert.deepEqual(result.source, {revision_id: "fixed", image_index: 2, image_sha256: "hash"});
  const search = materialObservation({items: [], total: 20, next_offset: 5, truncated: true});
  assert.equal(search.next_offset, 5);
  assert.equal(search.truncated, true);
});
