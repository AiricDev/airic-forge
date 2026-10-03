import type { AppIdentity, CapabilityCatalog } from "@airic-forge/domain";
import { digest, normalizeEmail } from "./ids.js";

type Json = Record<string, unknown>;

export class CertReporterClient {
  constructor(private readonly baseUrl: string) {}

  async identity(token: string): Promise<AppIdentity> {
    const payload = await this.#request("/api/v1/users/me/", token) as Json;
    const email = String(payload.email ?? "");
    if (!email) throw new Error("CertReporter identity did not contain an email");
    return { appId: "certreporter", appUserId: String(payload.id), email: normalizeEmail(email), displayName: String(payload.name ?? payload.username ?? email) };
  }

  async reportContext(token: string, reportId: string, selection?: Record<string, unknown>): Promise<Json> {
    return this.#request("/airic/v1/queries/report.context", token, { expectedDomainRelease: "certreporter/v1", input: { reportId, selection } }) as Promise<Json>;
  }

  async reportTypeContext(token: string, reportTypeId: string, selection?: Record<string, unknown>): Promise<Json> {
    return this.#request("/airic/v1/queries/report-type.context", token, { expectedDomainRelease: "certreporter/v1", input: { reportTypeId, selection } }) as Promise<Json>;
  }

  async catalog(token: string): Promise<CapabilityCatalog> {
    const manifest = await this.#request("/airic/v1/manifest", token) as Json;
    const capabilities = Array.isArray(manifest.capabilities) ? manifest.capabilities : [];
    const domain = manifest.domain as Json | undefined;
    const domainRelease = String(domain?.release ?? "certreporter/v1");
    const catalogDigest = digest({ domainRelease, capabilities });
    return { id: `catalog_${catalogDigest}`, appId: "certreporter", domainRelease, digest: catalogDigest, acceptedAt: new Date().toISOString(), capabilities: capabilities as CapabilityCatalog["capabilities"] };
  }

  async openApi(token: string): Promise<Json> {
    return this.#request("/airic/v1/openapi", token) as Promise<Json>;
  }

  async query(token: string, capabilityId: string, input: Json): Promise<Json> {
    return this.#request(`/airic/v1/queries/${encodeURIComponent(capabilityId)}`, token, { expectedDomainRelease: "certreporter/v1", input }) as Promise<Json>;
  }

  async submitCommand(token: string, capabilityId: string, body: Json): Promise<{ status: "committed" | "rejected" | "unknown"; receipt?: Json; reason?: string }> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/airic/v1/commands/${encodeURIComponent(capabilityId)}`, {
        method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
    } catch { return { status: "unknown", reason: "CommandResponseLost" }; }
    if (response.status >= 500) return { status: "unknown", reason: `CertReporter ${response.status}` };
    if (!response.ok) return { status: "rejected", reason: `CertReporter ${response.status}` };
    try {
      const receipt = await response.json() as Json;
      return receipt.status === "committed" || receipt.status === "rejected" ? { status: receipt.status, receipt } : { status: "unknown", reason: "InvalidCommandReceipt" };
    } catch { return { status: "unknown", reason: "InvalidCommandReceipt" }; }
  }

  async command(token: string, capabilityId: string, body: Json): Promise<Json> { return this.#request(`/airic/v1/commands/${encodeURIComponent(capabilityId)}`, token, body) as Promise<Json>; }

  async receipt(token: string, commandId: string): Promise<Json | undefined> {
    const response = await fetch(`${this.baseUrl}/airic/v1/commands/receipts/${encodeURIComponent(commandId)}`, { headers: { Authorization: `Bearer ${token}` } });
    if (response.status === 404) return undefined;
    if (!response.ok) throw new Error(`CertReporter receipt failed: ${response.status}`);
    return response.json() as Promise<Json>;
  }

  async #request(path: string, token: string, body?: Json): Promise<unknown> {
    const response = await fetch(`${this.baseUrl}${path}`, { method: body ? "POST" : "GET", headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
    if (!response.ok) throw new Error(`CertReporter ${path} failed: ${response.status}`);
    return response.json();
  }
}
