import assert from "node:assert/strict";
import test from "node:test";
import {conversationMessages,pinnedWorkFacts} from "./work-context.js";
import type {TrajectoryEvent} from "./ports.js";
const event=(id:string,type:TrajectoryEvent["type"],payload:Record<string,unknown>):TrajectoryEvent=>({id,workId:"w",turnId:"t",type,at:"now",payload});
test("deterministic corrections and unknown receipts survive; huge messages remain addressable",()=>{
  const events=[event("feedback","work.feedback",{kind:"correct",note:"必须保留的纠正",checkpointId:"cp"}),event("pending","action",{commandId:"cmd",status:"unknown",locator:{resourceId:"r"}}),event("old","action",{commandId:"ok",status:"pending"}),event("receipt","action",{commandId:"ok",status:"committed",locator:{resourceId:"r"}})];
  const facts=pinnedWorkFacts(events); assert.equal(facts.corrections[0].note,"必须保留的纠正");assert.equal(facts.unresolved.length,1);assert.equal(facts.receipts[0].commandId,"ok");
  const text="中文😀".repeat(5000),chunks=conversationMessages([event("huge","turn.completed",{text})]);
  assert.equal(chunks.map(c=>c.text).join(""),text);assert.ok(chunks.every(c=>c.eventId==="huge" && c.textRange));
});
