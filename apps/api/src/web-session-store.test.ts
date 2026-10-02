import assert from "node:assert/strict";
import test from "node:test";
import { cookieToken, InMemoryWebSessionStore, sessionCookie } from "./web-session-store.js";

test("Web session cookie is HttpOnly and revocation removes access", () => {
  const store = new InMemoryWebSessionStore();
  const token = store.issue("user-1");
  const cookie = sessionCookie(token, true);
  assert.match(cookie, /HttpOnly; SameSite=Strict/);
  assert.match(cookie, /; Secure$/);
  assert.equal(store.userId(cookieToken(cookie)), "user-1");
  store.revoke(token);
  assert.equal(store.userId(token), undefined);
});
