import type { AppIdentity, AppCommandLocator, AppCommandTarget, AppPort, CapabilityCatalog, CapabilityDefinition, InstanceSettings } from "@airic-forge/domain";
import { Ajv2020 } from "ajv/dist/2020.js";
import { digest, normalizeEmail } from "./ids.js";
import { AppMcpClient, AppToolError, appToolResult, canonical, executionMeta } from "./mcp-client.js";

type Json = Record<string, unknown>;
const record = (value: unknown): Json => value && typeof value === "object" && !Array.isArray(value) ? value as Json : {};
const release = "certlab/v1";

/** CertLab business DTO validation; MCP mechanics belong to AppMcpClient. */
export class CertLabClient implements AppPort {
  private readonly baseUrl: string;
  private readonly mcp: AppMcpClient;
  constructor(baseUrl: string, private readonly organizationId: string) {
    const url = new URL(baseUrl);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== "/") throw new Error("InvalidCertLabOrigin");
    this.baseUrl = url.origin;
    this.mcp = new AppMcpClient(new URL("/mcp", this.baseUrl));
  }

  describeIntegration(): InstanceSettings["integration"] {
    return { appId: "certlab", organizationId: this.organizationId, baseUrl: this.baseUrl,
      mcpUrl: `${this.baseUrl}/mcp`, transport: "streamable-http" };
  }

  async identity(token: string): Promise<AppIdentity> {
    const response = await fetch(`${this.baseUrl}/api/v1/auth/me`, { redirect: "manual", signal: AbortSignal.timeout(30_000), headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) throw new Error(`CertLab ${response.status}`);
    const identity = record(await response.json());
    await this.integration(token);
    if (typeof identity.actor_id !== "string" || !identity.actor_id) throw new Error("InvalidAppIdentity");
    const email = normalizeEmail(typeof identity.email === "string" ? identity.email : "");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("AppIdentityEmailRequired");
    return { appId: "certlab", appUserId: identity.actor_id, email, displayName: String(identity.display_name ?? email), organizationId: this.organizationId };
  }

  private async integration(token: string): Promise<Json> {
    const info = appToolResult(await this.mcp.call(token, "integration.info", {}));
    if (info.appId !== "certlab" || record(info.domain).release !== release || info.organizationId !== this.organizationId) throw new Error("AppOrganizationBindingMismatch");
    return info;
  }

  async catalog(token: string): Promise<CapabilityCatalog> {
    await this.integration(token);
    const tools = await this.mcp.tools(token);
    const capabilities: CapabilityDefinition[] = [];
    const ids = new Set<string>();
    const modelNames = new Set<string>();
    const schemas = new Ajv2020({ strict: false, allErrors: false });
    for (const tool of tools) {
      if (ids.has(tool.name)) throw new Error("InvalidCapabilityCatalog");
      ids.add(tool.name);
      if (tool.name === "integration.info") continue;
      const execution = record(tool._meta?.[executionMeta]);
      const modelName = tool.name.replaceAll(/[.-]/g, "_");
      if (!/^[a-z][a-z.-]+$/.test(tool.name) || modelNames.has(modelName)
        || !["query", "command"].includes(String(execution.kind)) || tool.inputSchema.type !== "object"
        || ["assessment.submit", "assessment.confirm", "report.issue", "report.send"].includes(tool.name)
        || (execution.kind === "command" && (typeof execution.receiptScope !== "string" || !execution.receiptScope))) throw new Error("InvalidCapabilityCatalog");
      modelNames.add(modelName);
      try { schemas.compile(tool.inputSchema); if (tool.outputSchema) schemas.compile(tool.outputSchema); } catch { throw new Error("InvalidCapabilitySchema"); }
      capabilities.push({ id: tool.name, title: tool.title ?? tool.name, description: tool.description ?? "",
        kind: execution.kind as CapabilityDefinition["kind"], inputSchema: tool.inputSchema,
        outputSchema: tool.outputSchema ?? { type: "object" },
        ...(tool.annotations ? { safetyHints: {
          readOnly: tool.annotations.readOnlyHint, destructive: tool.annotations.destructiveHint,
          idempotent: tool.annotations.idempotentHint, openWorld: tool.annotations.openWorldHint,
        } } : {}),
        ...(execution.kind === "command" ? { receiptScope: String(execution.receiptScope) } : {}) });
    }
    if (!ids.has("integration.info")) throw new Error("InvalidCapabilityCatalog");
    capabilities.sort((a, b) => a.id.localeCompare(b.id));
    const catalogDigest = digest(canonical({ source: "mcp", domainRelease: release, capabilities }));
    return { source: "mcp", id: `catalog_${catalogDigest}`, appId: "certlab", domainRelease: release, digest: catalogDigest, acceptedAt: new Date().toISOString(), capabilities };
  }

  async reportContext(token: string, reportId: string, selection?: Json): Promise<Json> {
    return this.query(token, "report.context", { report_id: reportId, assessment_limit: 5, ...(selection ? { selection } : {}) });
  }
  async query(token: string, capabilityId: string, input: Json): Promise<Json> {
    const value = appToolResult(await this.mcp.call(token, capabilityId, input, { expectedDomainRelease: release }));    if (["asset.read", "asset.read-location"].includes(capabilityId)) {
      const source = record(value.source);
      if (!(capabilityId === "asset.read-location" ? ["ready", "image_required", "no_original_text", "unavailable"] : ["ready", "unavailable"]).includes(String(value.status)) || source.revision_id !== input.revision_id
        || (capabilityId === "asset.read" ? source.page !== input.page : source.location_id !== input.location_id || !/^[a-f0-9]{64}$/.test(String(source.location_id)) || !Object.keys(record(source.locator)).length) || typeof source.asset_id !== "string"
        || typeof source.project_id !== "string" || !/^[0-9a-f]{64}$/.test(String(source.sha256))
        || typeof value.text !== "string" || value.text.length > 200_000
        || !Array.isArray(value.warnings) || value.warnings.some((warning) => typeof warning !== "string")) throw new Error("InvalidMaterialRead");
      const requestedLimit = typeof input.text_limit === "number" ? input.text_limit : 4000;
      if (!Number.isSafeInteger(requestedLimit) || requestedLimit < 1 || requestedLimit > 8000
        || Array.from(value.text).length > requestedLimit) throw new Error("InvalidMaterialRead");
      const range = record(value.text_range);
      if (Object.keys(range).length) {
        const offset = Number(range.offset), end = Number(range.end), total = Number(range.total);
        const limit = typeof input.text_limit === "number" ? input.text_limit : 4000;
        if (![offset, end, total].every(Number.isSafeInteger) || offset < 0 || end < offset || end > total
          || offset !== (input.text_offset ?? 0) || end - offset > limit || Array.from(value.text as string).length !== end - offset
          || range.unit !== "unicode_code_point" || range.has_more !== (end < total)
          || range.next_offset !== (end < total ? end : null)
          || JSON.stringify(source.text_range) !== JSON.stringify(range)) throw new Error("InvalidMaterialRange");
      }
      if (capabilityId === "asset.read-location") {
        if (value.document_summary !== undefined && (typeof value.document_summary !== "string" || Array.from(value.document_summary).length > 600)) throw new Error("InvalidMaterialSummary");
        if (value.visual_summary !== undefined && (typeof value.visual_summary !== "string" || Array.from(value.visual_summary).length > 1200)) throw new Error("InvalidMaterialSummary");
        if (input.image_index !== undefined && source.image_index !== input.image_index) throw new Error("InvalidMaterialImageSource");
        if (value.images !== undefined && (!Array.isArray(value.images) || value.images.length > 8 || value.images.some((entry) => { const image = record(entry); return !Number.isSafeInteger(image.image_index) || Number(image.image_index) < 0 || typeof image.visual_summary !== "string" || Array.from(image.visual_summary).length > 300 || !/^[a-f0-9]{64}$/.test(String(image.view_sha256)); }))) throw new Error("InvalidMaterialImages");
      }
      if (value.image) {
        if (input.include_image !== true) throw new Error("UnrequestedMaterialImage");
        const image = record(value.image);
        if (!["ready", "image_required"].includes(String(value.status)) || image.mimeType !== "image/png" || typeof image.data !== "string"
          || image.data.length > 12 * 1024 * 1024 || !/^[A-Za-z0-9+/]+={0,2}$/.test(image.data)) throw new Error("InvalidMaterialImage");
        const bytes = Buffer.from(image.data, "base64");
        if (bytes.length > 8 * 1024 * 1024 || bytes.toString("base64") !== image.data
          || !bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) throw new Error("InvalidMaterialImage");
      }
    }
    if (capabilityId === "asset.search") {
      if (!Array.isArray(value.items) || value.items.length > 100 || !Array.isArray(value.warnings)
        || typeof value.coverage !== "object" || Object.values(record(value.coverage)).some(n => !Number.isInteger(n) || Number(n) < 0)) throw new Error("InvalidMaterialSearch");
      for (const item of value.items) {
        const hit = record(item);
        if (!["asset_id", "revision_id", "filename", "path", "status"].every(key => typeof hit[key] === "string" && Array.from(String(hit[key])).length <= 2000)
          || !/^[a-f0-9]{64}$/.test(String(hit.sha256))
          || (hit.location_id !== null && !/^[a-f0-9]{64}$/.test(String(hit.location_id)))
          || typeof hit.snippet !== "string" || Array.from(hit.snippet).length > 400) throw new Error("InvalidMaterialSearch");
      }
    }
    return value;
  }

  async prepareCommand(token: string, capabilityId: string, input: Json): Promise<AppCommandTarget> {
    const value = await this.query(token, "command.context", {
      report_id: input.report_id, capability_id: capabilityId, command_input: input,
    });
    if (value.resource_kind !== "project"
      || !["resource_id", "scope", "target_kind", "target_id"].every((key) => typeof value[key] === "string" && value[key])) throw new Error("CommandLocatorUnavailable");
    return { resourceKind: "project", resourceId: String(value.resource_id), scope: String(value.scope),
      targetKind: String(value.target_kind), targetId: String(value.target_id) };
  }

  async submitCommand(token: string, capabilityId: string, body: Json, locator?: AppCommandLocator) {
    try {
      const receipt = appToolResult(await this.mcp.call(token, capabilityId, record(body.input), {
        expectedDomainRelease: release, commandId: body.commandId, correlation: body.correlation,
      }));
      return this.#validReceipt(receipt, locator ?? {
        commandId: String(body.commandId), capabilityId, reportId: String(record(body.input).report_id),
        assessmentId: String(record(body.input).assessment_id), resourceKind: "project",
        resourceId: String(record(receipt.receipt).resource_id), scope: String(record(receipt.receipt).scope),
      })
        ? { status: "committed" as const, receipt }
        : { status: "unknown" as const, reason: "InvalidCommandReceipt" };
    } catch (error) {
      if (error instanceof AppToolError && error.result.outcome === "rejected" && Number(error.result.httpStatus) < 500) {
        return { status: "rejected" as const, reason: error.message };
      }
      return { status: "unknown" as const, reason: "CommandResponseLost" };
    }
  }
  async receipt(token: string, locator: AppCommandLocator): Promise<Json | undefined> {
    const input = {
      report_id: locator.reportId,
      target_kind: locator.targetKind ?? "assessment", target_id: locator.targetId ?? locator.assessmentId,
      capability_id: locator.capabilityId, command_id: locator.commandId,
      resource_kind: locator.resourceKind, resource_id: locator.resourceId, scope: locator.scope,
    };
    let receipt: Json;
    try { receipt = await this.query(token, "command.receipt", input); }
    catch (error) {
      if (error instanceof AppToolError && record(error.result.error).code === "not_found") return undefined;
      throw error;
    }
    const stored = record(receipt.receipt);
    if (!this.#validReceipt(receipt, locator)
        || stored.resource_kind !== locator.resourceKind || stored.resource_id !== locator.resourceId
        || stored.scope !== locator.scope) throw new Error("InvalidCommandReceipt");
    return receipt;
  }
  #validReceipt(value: Json, locator: AppCommandLocator): boolean {
    const receipt = record(value.receipt);
    const response = record(receipt.response);
    if (value.status !== "committed" || value.commandId !== locator.commandId || receipt.key !== locator.commandId
      || receipt.resource_kind !== locator.resourceKind || receipt.resource_id !== locator.resourceId
      || receipt.scope !== locator.scope) return false;
    if (locator.capabilityId.startsWith("assessment.")) return response.id === locator.assessmentId;
    if (!locator.targetId || receipt.target_kind !== locator.targetKind || receipt.target_id !== locator.targetId) return false;
    if (["test-task.create", "finding.create"].includes(locator.capabilityId)) return record(response[locator.capabilityId === "test-task.create" ? "test_task" : "finding"]).source_assessment_id === locator.targetId;
    if (locator.targetKind === "project") return response.project_id === locator.targetId;
    if (locator.targetKind === "report") return response.report_id === locator.targetId;
    return response.id === locator.targetId;
  }
}
