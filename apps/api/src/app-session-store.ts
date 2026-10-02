import type { AppSessionPort, SessionGrant } from "@airic-forge/domain";
/** Process-local by design: the bearer token is never persisted. */
export class InMemoryAppSessionStore implements AppSessionPort {
  readonly #sessions = new Map<string, SessionGrant>();
  readonly #claimed = new Set<string>();
  put(session: SessionGrant): void { this.#sessions.set(session.ticket, session); }
  get(ticket: string): SessionGrant | undefined { return this.#sessions.get(ticket); }
  claim(ticket: string): SessionGrant | undefined {
    if (this.#claimed.has(ticket)) return undefined;
    const session = this.#sessions.get(ticket);
    if (session) {
      this.#claimed.add(ticket);
      session.expiresAt = new Date(Date.now() + 8 * 60 * 60_000).toISOString();
    }
    return session;
  }
  remove(ticket: string): void { this.#claimed.delete(ticket); this.#sessions.delete(ticket); }
}
