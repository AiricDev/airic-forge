/** Raw material contents are transient tool input, never the Work's evidence ledger. */
const sourceKeys = ["project_id", "asset_id", "asset_name", "asset_version", "revision_id", "revision_no", "sha256", "filename", "format", "page", "page_count", "location_kind", "location_id", "locator", "extractor", "text_range", "is_current", "current_revision_id", "path", "status", "reason"];
const sourceProjection = (value: unknown): Record<string, unknown> => {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  return Object.fromEntries(sourceKeys.filter(key => key in source).map(key => [key, source[key]]));
};
export function materialObservation(result: Record<string, unknown>): Record<string, unknown> {
  if (Array.isArray(result.items)) return {
    coverage: result.coverage, warnings: result.warnings, total: result.total,
    items: result.items.map(sourceProjection),
  };
  return {
    status: result.status, reason: result.reason, source: sourceProjection(result.source),
    warnings: result.warnings,
    textCharacters: typeof result.text === "string" ? Array.from(result.text).length : 0,
    imageAvailable: !!result.image,
  };
}
