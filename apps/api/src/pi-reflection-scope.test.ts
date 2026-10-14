import assert from "node:assert/strict";
import test from "node:test";
import { reflectionSystemPrompt } from "./pi-reflection-agent.js";

test("the actual Pi Reflection prompt describes governed nested identities, not a conflicting flat-only route", () => {
  assert.match(reflectionSystemPrompt, /subject-knowledge\/ or precedents\//);
  assert.match(reflectionSystemPrompt, /nested IDs are not filename stems/);
  assert.match(reflectionSystemPrompt, /Navigation README is not a knowledge ID/);
  assert.match(reflectionSystemPrompt, /candidate tool and author review enforce scope/);
  assert(!reflectionSystemPrompt.includes("edits may only be subject-knowledge/*.md"));
});
