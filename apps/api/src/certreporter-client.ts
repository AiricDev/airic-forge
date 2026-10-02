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

  async catalog(token: string): Promise<CapabilityCatalog> {
    const manifest = await this.#request("/airic/v1/manifest", token) as Json;
    const capabilities = Array.isArray(manifest.capabilities) ? manifest.capabilities : [];
    const domain = manifest.domain as Json | undefined;
    return { id: `catalog_${String(domain?.digest ?? digest(capabilities))}`, appId: "certreporter", domainRelease: String(domain?.release ?? "certreporter/v1"), digest: String(domain?.digest ?? digest(capabilities)), acceptedAt: new Date().toISOString(), capabilities: capabilities as CapabilityCatalog["capabilities"] };
  }

  async openApi(token: string): Promise<Json> {
    return this.#request("/airic/v1/openapi", token) as Promise<Json>;
  }

  async command(token: string, capabilityId: string, body: Json): Promise<Json> { return this.#request(`/airic/v1/commands/${encodeURIComponent(capabilityId)}`, token, body) as Promise<Json>; }

  async receipt(token: string, commandId: string): Promise<Json> {
    return this.#request(`/airic/v1/commands/receipts/${encodeURIComponent(commandId)}`, token) as Promise<Json>;
  }

  async #request(path: string, token: string, body?: Json): Promise<unknown> {
    const response = await fetch(`${this.baseUrl}${path}`, { method: body ? "POST" : "GET", headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
    if (!response.ok) throw new Error(`CertReporter ${path} failed: ${response.status}`);
    return response.json();
  }
}
