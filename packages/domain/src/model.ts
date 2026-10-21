/** Domain values use stable IDs, never filesystem paths or provider objects. */
export type UserRole = "user" | "admin";

export interface ForgeUser {
  id: string;
  email: string;
  role: UserRole;
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

export interface CapabilityCatalog {
  source?: "mcp";
  id: string;
  appId: string;
  domainRelease: string;
  digest: string;
  acceptedAt: string;
  capabilities: CapabilityDefinition[];
}

export interface CapabilityDefinition {
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
