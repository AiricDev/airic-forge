/** Domain values use stable IDs, never filesystem paths or provider objects. */
export type UserRole = "user" | "admin";

export interface ForgeUser {
  id: string;
  email: string;
  role: UserRole;
  status: import("./user-administration.js").UserStatus;
  version: number;
  passwordConfigured: boolean;
  activeBranch: string;
  createdAt: string;
}

export interface AppIdentity {
  appId: string;
  appUserId: string;
  email: string;
  displayName: string;
  organizationId?: string;
}

export interface AppToolSnapshot {
  source?: "mcp";
  id: string;
  appId: string;
  domainRelease: string;
  digest: string;
  discoveredAt: string;
  tools: AppToolDefinition[];
}

export interface AppToolDefinition {
  id: string;
  title: string;
  description: string;
  kind: "query" | "command";
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  receiptScope?: string;
  safetyHints?: { readOnly?: boolean; destructive?: boolean; idempotent?: boolean; openWorld?: boolean };
}

export interface DocumentProvenance {
  id: string;
  path: string;
  revision: string;
  reason: "work-definition" | "bootstrap" | "on-demand";
}
