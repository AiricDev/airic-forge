import { randomBytes } from "node:crypto";
import type { PasswordSetupPort } from "@airic-forge/domain";

export class InMemoryPasswordSetupStore implements PasswordSetupPort {
  readonly #tickets = new Map<string, { userId: string; expiresAt: string }>();
  issue(userId: string, expiresAt: string): string {
    const ticket = randomBytes(32).toString("base64url");
    this.#tickets.set(ticket, { userId, expiresAt });
    return ticket;
  }
  revokeUser(userId: string): void { for (const [ticket, grant] of this.#tickets) if (grant.userId === userId) this.#tickets.delete(ticket); }
  consume(ticket: string, now: string): string | undefined {
    const grant = this.#tickets.get(ticket);
    this.#tickets.delete(ticket);
    return grant && Date.parse(grant.expiresAt) > Date.parse(now) ? grant.userId : undefined;
  }
}
