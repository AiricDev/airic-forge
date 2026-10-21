import assert from "node:assert/strict";
import test from "node:test";
import { PasswordAdministration } from "./password-administration.js";
import type { ForgeUser } from "./model.js";

const user: ForgeUser = { id: "synthetic-user", email: "user@example.invalid", role: "user", status: "active", version: 0, activeBranch: "users/synthetic-user", createdAt: "2026-10-21T00:00:00Z", passwordConfigured: true };

test("local password administration finds the existing normalized account and stores only its encoded password", async () => {
  const writes: unknown[] = [];
  const administration = new PasswordAdministration({
    userByEmail: email => { assert.equal(email, user.email); return user; },
    replacePassword: (id, hash) => { writes.push({ id, hash }); return true; },
  }, { hash: value => { assert.equal(value, "synthetic password"); return "encoded-value"; }, verify: () => false });
  await administration.setPassword(" USER@example.invalid ", "synthetic password");
  assert.deepEqual(writes, [{ id: user.id, hash: "encoded-value" }]);
});

test("missing users and invalid passwords never reach password persistence", async () => {
  let writes = 0;
  let hashes = 0;
  let found = false;
  const administration = new PasswordAdministration({
    userByEmail: () => found ? user : undefined,
    replacePassword: () => { writes++; return true; },
  }, { hash: () => { hashes++; throw new Error("InvalidPassword"); }, verify: () => false });
  await assert.rejects(() => administration.setPassword(user.email, "bad"), /UserNotFound/);
  assert.equal(hashes, 0);
  found = true;
  await assert.rejects(() => administration.setPassword(user.email, "bad"), /InvalidPassword/);
  assert.equal(writes, 0);
});

test("a user removed before the password update is reported as missing", async () => {
  const administration = new PasswordAdministration({ userByEmail: () => user, replacePassword: () => false }, { hash: () => "encoded-value", verify: () => false });
  await assert.rejects(() => administration.setPassword(user.email, "synthetic password"), /UserNotFound/);
});
