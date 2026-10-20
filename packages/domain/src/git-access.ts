import type { AccountPort, SystemPort } from "./ports.js";

export interface GitToken { id: string; ownerUserId: string; name: string; expiresAt: string; revokedAt?: string; }
export interface GitTokenPort {
  gitTokens(ownerUserId: string): GitToken[];
  saveGitToken(token: GitToken, secretDigest: string): void;
  gitTokenByDigest(secretDigest: string): GitToken | undefined;
  revokeGitToken(ownerUserId: string, id: string, at: string): void;
}
/** A Git credential grants only its owner's personal OM, never administrative authority. */
export class GitAccess {
  constructor(private readonly ports: { accounts: AccountPort; tokens: GitTokenPort; system: SystemPort }) {}
  async list(actor: string) {
    if (!await this.ports.accounts.userById(actor)) throw new Error("Unauthorized");
    return this.ports.tokens.gitTokens(actor);
  }
  async issue(actor: string, name: string, days = 90) {
    await this.list(actor);
    if (typeof name !== "string" || !name.trim() || name.length > 100 || !Number.isInteger(days) || days < 1 || days > 365) throw new Error("InvalidGitToken");
    const token = { id: this.ports.system.id("gtk"), ownerUserId: actor, name: name.trim(), expiresAt: new Date(Date.parse(this.ports.system.now()) + days * 86_400_000).toISOString() };
    const secret = `${this.ports.system.id("forge_git")}_${this.ports.system.id("secret")}`;
    this.ports.tokens.saveGitToken(token, this.ports.system.digest(secret));
    return { token, secret };
  }
  async revoke(actor: string, id: string) {
    await this.list(actor);
    this.ports.tokens.revokeGitToken(actor, id, this.ports.system.now());
  }
  async authenticate(secret: string, requestedOwner: string) {
    if (!secret || secret.length > 500) throw new Error("Unauthorized");
    const token = this.ports.tokens.gitTokenByDigest(this.ports.system.digest(secret));
    if (!token || token.revokedAt || Date.parse(token.expiresAt) <= Date.parse(this.ports.system.now())) throw new Error("Unauthorized");
    if (token.ownerUserId !== requestedOwner || !await this.ports.accounts.userById(token.ownerUserId)) throw new Error("Forbidden");
    return token.ownerUserId;
  }
}
