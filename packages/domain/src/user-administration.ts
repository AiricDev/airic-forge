import type { ForgeUser, UserRole } from "./model.js";
import type { AccountPort, MaybePromise } from "./ports.js";

export type UserStatus = "active" | "draining" | "disabled";
export interface UserChange { expectedVersion: number; requestId: string; reason: string; role?: UserRole; enabled?: boolean; }
export interface UserAdminEvent { id: string; actorUserId: string | null; targetUserId: string; requestId: string; reason: string; before: { role: UserRole; status: UserStatus; version: number }; after: { role: UserRole; status: UserStatus; version: number }; at: string; }
export interface UserDetail { user: ForgeUser; identities: Array<{ appId: string; appUserId: string; email: string }>; history: UserAdminEvent[]; page: number; total: number; }
export interface UserAdministrationPort {
  userDetail(userId: string, page: number): MaybePromise<UserDetail>;
  /** Re-read actor/target/admin count, enforce policy, CAS and audit/replay atomically. */
  changeUser(actorId: string, userId: string, input: UserChange, inFlight: boolean): MaybePromise<ForgeUser>;
  finishUserDrain(userId: string): MaybePromise<boolean>;
}

export function validateUserChange(input: UserChange): void {
  if (!input || Object.keys(input).some(key => !["expectedVersion", "requestId", "reason", "role", "enabled"].includes(key))
    || !Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 0
    || typeof input.requestId !== "string" || !/^[a-zA-Z0-9_-]{8,100}$/.test(input.requestId)
    || typeof input.reason !== "string" || !input.reason.trim() || input.reason.length > 2000
    || (input.role !== undefined && !["admin", "user"].includes(input.role))
    || (input.enabled !== undefined && typeof input.enabled !== "boolean")
    || (input.role === undefined && input.enabled === undefined)) throw new Error("InvalidUserChange");
}

export function changedUser(actor: ForgeUser | undefined, target: ForgeUser | undefined, input: UserChange, activeAdmins: number, inFlight: boolean): ForgeUser {
  if (actor?.role !== "admin" || actor.status !== "active") throw new Error("Forbidden");
  if (!target) throw new Error("UserNotFound");
  if (target.version !== input.expectedVersion) throw new Error("UserVersionConflict");
  if (input.enabled === true && target.status === "draining") throw new Error("UserStillDraining");
  const role = input.role ?? target.role;
  const status = input.enabled === undefined ? target.status : input.enabled ? "active" : inFlight ? "draining" : "disabled";
  if (target.role === "admin" && target.status === "active" && (role !== "admin" || status !== "active") && activeAdmins <= 1) throw new Error("LastActiveAdministrator");
  return { ...target, role, status, version: target.version + 1 };
}

/** Process-local execution admission matches the existing single-process session runtime.
 * Locks cover admission/change only, never the duration of a model run. */
export class UserAdministration {
  private readonly locks = new Map<string, Promise<void>>();
  private readonly executions = new Map<string, Set<{ kind: "work" | "reflection"; resourceId: string }>>();
  private readonly listeners = new Set<(userId: string) => void>();
  constructor(private readonly accounts: AccountPort) {}
  onDisabled(listener: (userId: string) => void) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  private async locked<T>(userId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(userId) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const next = previous.then(() => gate);
    this.locks.set(userId, next);
    await previous;
    try { return await operation(); } finally { release(); if (this.locks.get(userId) === next) this.locks.delete(userId); }
  }
  async requireActive(userId: string) {
    const user = await this.accounts.userById(userId);
    if (!user || user.status !== "active") throw new Error("UserUnavailable");
    return user;
  }
  async withActive<T>(userId: string, operation: () => Promise<T>): Promise<T> {
    return this.locked(userId, async () => { await this.requireActive(userId); return operation(); });
  }
  observing(userId: string, kind: "work" | "reflection", resourceId: string): boolean {
    return [...(this.executions.get(userId) ?? [])].some(run => run.kind === kind && run.resourceId === resourceId);
  }
  async detail(actorId: string, userId: string, page: number) {
    const actor = await this.requireActive(actorId);
    if (actor.role !== "admin") throw new Error("Forbidden");
    if (!Number.isSafeInteger(page) || page < 1 || page > 100000) throw new Error("InvalidUserPage");
    return this.accounts.userDetail(userId, page);
  }
  async change(actorId: string, userId: string, input: UserChange) {
    validateUserChange(input);
    return this.locked(userId, async () => {
      const user = await this.accounts.changeUser(actorId, userId, input, Boolean(this.executions.get(userId)?.size));
      if (user.status === "disabled" && (await this.accounts.userById(userId))?.status === "disabled") this.notifyDisabled(user.id);
      return user;
    });
  }
  private notifyDisabled(userId: string) { for (const listener of this.listeners) listener(userId); }
  async run<T>(userId: string, kind: "work" | "reflection", resourceId: string, operation: () => Promise<T>): Promise<T> {
    const lease = { kind, resourceId };
    await this.locked(userId, async () => {
      await this.requireActive(userId);
      const active = this.executions.get(userId) ?? new Set();
      active.add(lease); this.executions.set(userId, active);
    });
    try { return await operation(); } finally {
      await this.locked(userId, async () => {
        const active = this.executions.get(userId);
        active?.delete(lease);
        if (!active?.size) {
          this.executions.delete(userId);
          if (await this.accounts.finishUserDrain(userId)) this.notifyDisabled(userId);
        }
      });
    }
  }
}
