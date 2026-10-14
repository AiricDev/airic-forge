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
