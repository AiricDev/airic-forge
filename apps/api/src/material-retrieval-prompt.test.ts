import assert from "node:assert/strict";
import test from "node:test";
import {materialRetrievalPrompt} from "./material-retrieval-prompt.js";
test("legacy material work definitions get a bounded missing-capability explanation, never silent full inventory",()=>{
  const text=materialRetrievalPrompt(["asset.list","asset.read"]);
  assert.ok(text.includes("no authorized"));assert.ok(text.includes("Do not substitute a full"));
  assert.ok(text.includes("Work Definition correction"));
  assert.equal(materialRetrievalPrompt(["assessment.context"]),"");
});
test("search-enabled works receive progressive retrieval and scope guidance",()=>{
  const text=materialRetrievalPrompt(["asset.list","asset.search","asset.read-location"]);
  assert.ok(text.includes('scope="current"'));assert.ok(text.includes("assessment_limit=100"));
});
