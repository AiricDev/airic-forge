import type { PasswordAdministrationPort, PasswordCodecPort } from "./ports.js";

/** The caller is a trusted local operator with direct access to the instance data. */
export class PasswordAdministration {
  constructor(private readonly accounts: PasswordAdministrationPort, private readonly codec: PasswordCodecPort) {}

  async setPassword(email: string, password: string): Promise<void> {
    const user = await this.accounts.userByEmail(email.trim().toLowerCase());
    if (!user) throw new Error("UserNotFound");
    const hash = this.codec.hash(password);
    if (!await this.accounts.replacePassword(user.id, hash)) throw new Error("UserNotFound");
  }
}
