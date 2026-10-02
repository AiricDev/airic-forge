import type { AppSessionPort, SessionGrant } from "@airic-forge/domain";
/** Process-local by design: the bearer token is never persisted. */
export class InMemoryAppSessionStore implements AppSessionPort {
  readonly #sessions = new Map<string, SessionGrant>();
  put(session: SessionGrant): void { this.#sessions.set(session.ticket, session); }
  get(ticket: string): SessionGrant | undefined { return this.#sessions.get(ticket); }
  remove(ticket: string): void { this.#sessions.delete(ticket); }
}
