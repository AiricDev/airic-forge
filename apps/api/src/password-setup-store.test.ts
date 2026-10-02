import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryPasswordSetupStore } from "./password-setup-store.js";

test("password setup ticket is single use and expires", () => {
  const store = new InMemoryPasswordSetupStore();
  const valid = store.issue("user-1", "2026-10-03T00:00:00.000Z");
  assert.equal(store.consume(valid, "2026-10-02T00:00:00.000Z"), "user-1");
  assert.equal(store.consume(valid, "2026-10-02T00:00:00.000Z"), undefined);
  const expired = store.issue("user-1", "2026-10-01T00:00:00.000Z");
  assert.equal(store.consume(expired, "2026-10-02T00:00:00.000Z"), undefined);
});
