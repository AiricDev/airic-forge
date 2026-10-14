import assert from "node:assert/strict";
import test from "node:test";
import { ReflectionTextStream } from "./reflection-text-stream.js";

test("analysis is decoded at every possible boundary without exposing other fields", () => {
  const analysis = '中文 🚀\n```ts\nconst x = "quoted";\n```\n\\slash\t';
  const raw = "```json\n" + JSON.stringify({ outcome: "analysis", nested: { analysis: "private" }, analysis, attribution: "private attribution", edits: [{ content: "private" }] }) + "\n```";
  for (let boundary = 0; boundary <= raw.length; boundary++) {
    const parser = new ReflectionTextStream();
    assert.equal(parser.feed(raw.slice(0, boundary)) + parser.feed(raw.slice(boundary)), analysis);
  }
  const parser = new ReflectionTextStream();
  assert.equal([...raw].map((character) => parser.feed(character)).join(""), analysis);
});

test("escaped unicode and escape characters can span chunks", () => {
  const parser = new ReflectionTextStream();
  assert.equal(parser.feed('{"analysis":"\\u4e2'), "");
  assert.equal(parser.feed('d\\ud83d'), "中");
  assert.equal(parser.feed('\\ude80\\nhello\\\\'), "🚀\nhello\\");
  assert.equal(parser.feed('\\""}'), '"');
});

test("analysis streams before the JSON finishes and malformed fields never leak", () => {
  const parser = new ReflectionTextStream();
  assert.equal(parser.feed('{"edits":[{"analysis":"not public"}],"analysis":"Hello'), "Hello");
  assert.equal(parser.feed(' world","attribution":"not public"}'), " world");
  assert.equal(parser.feed('{"analysis":"extra object"}'), "");
  assert.equal(new ReflectionTextStream().feed('{"analysis":{"secret":"not public"}}'), "");
  assert.equal(new ReflectionTextStream().feed('{"analysis":"safe\\xsecret"}'), "safe");
});
