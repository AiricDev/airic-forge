import { randomBytes } from "node:crypto";

const SESSION_MS = 30 * 60_000;
export class InMemoryWebSessionStore {
  readonly #sessions = new Map<string, { userId: string; originalUserId: string; expiresAt: number }>();
  issue(userId: string): string {
    const token = randomBytes(32).toString("base64url");
    this.#sessions.set(token, { userId, originalUserId: userId, expiresAt: Date.now() + SESSION_MS });
    return token;
  }
  #session(token: string | undefined) {
    if (!token) return undefined;
    const session = this.#sessions.get(token);
    if (!session) return undefined;
    if (session.expiresAt <= Date.now()) { this.#sessions.delete(token); return undefined; }
    return session;
  }
  userId(token: string | undefined): string | undefined { return this.#session(token)?.userId; }
  originalUserId(token: string | undefined): string | undefined { return this.#session(token)?.originalUserId; }
  switchUser(token: string | undefined, userId: string): boolean {
    const session = this.#session(token);
    if (!session) return false;
    session.userId = userId;
    return true;
  }
  revoke(token: string | undefined): void { if (token) this.#sessions.delete(token); }
}

export function cookieToken(header: string | undefined): string | undefined {
  const pair = header?.split(";").map((part) => part.trim()).find((part) => part.startsWith("forge_session="));
  return pair?.slice("forge_session=".length);
}

export function sessionCookie(token: string, secure: boolean): string {
  return `forge_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=1800${secure ? "; Secure" : ""}`;
}
