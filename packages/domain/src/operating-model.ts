export type DocumentLoad = "required" | "on-demand";

export interface WorkDocument {
  id: string;
  path: string;
  title: string;
  role: "policy" | "procedure" | "reference" | "precedent";
  load: DocumentLoad;
}

export interface WorkDefinition {
  schemaVersion: 1;
  id: string;
  title: string;
  description: string;
  documents: WorkDocument[];
  knowledge: { bootstrap: string[]; available: string[] };
  completion: { mode?: "user" };
}

export interface SubjectKnowledgeMetadata {
  id: string;
  title: string;
  summary: string;
  topics: string[];
}

export interface ValidationIssue {
  path: string;
  message: string;
}

export function isAllowedProposalPath(path: string): boolean {
  return /^work-definitions\/[a-z0-9-]+\/(?:work\.yml|[a-z0-9-]+\.md)$/.test(path)
    || /^(?:subject-knowledge|precedents)\/(?:[a-z0-9-]+\/)*(?:[a-z0-9-]+|README)\.md$/.test(path);
}

/** Both scopes use the explicitly governed OM directories, never arbitrary files. */
export function isAllowedOmDocumentPath(path: string): boolean {
  return isAllowedProposalPath(path);
}

export function validateWorkDefinition(
  definition: WorkDefinition,
  knownKnowledge: ReadonlySet<string>,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (definition.schemaVersion !== 1) issues.push({ path: "schemaVersion", message: "must be 1" });
  if (!/^[a-z][a-z0-9-]*$/.test(definition.id)) issues.push({ path: "id", message: "must be a kebab-case identifier" });
  if (typeof definition.title !== "string" || !definition.title.trim()) issues.push({ path: "title", message: "must be a non-empty string" });
  if (typeof definition.description !== "string") issues.push({ path: "description", message: "must be a string" });
  const documentIds = new Set<string>();
  for (const document of definition.documents) {
    if (!document || typeof document.id !== "string" || typeof document.path !== "string") {
      issues.push({ path: "documents", message: "each document needs an id and path" });
      continue;
    }
    if (documentIds.has(document.id)) issues.push({ path: `documents.${document.id}`, message: "document id must be unique" });
    documentIds.add(document.id);
    if (!/^[a-z][a-z0-9-]*$/.test(document.id)) issues.push({ path: `documents.${document.id}.id`, message: "must be a stable kebab-case identifier" });
    if (typeof document.title !== "string" || !document.title.trim()) issues.push({ path: `documents.${document.id}.title`, message: "must be a non-empty string" });
    if (!/^[a-z0-9-]+\.md$/.test(document.path)) issues.push({ path: `documents.${document.id}.path`, message: "must name a markdown file in the work definition package" });
    if (!["policy", "procedure", "reference", "precedent"].includes(document.role)) issues.push({ path: `documents.${document.id}.role`, message: "must be a supported document role" });
    if (!["required", "on-demand"].includes(document.load)) issues.push({ path: `documents.${document.id}.load`, message: "must be required or on-demand" });
  }
  for (const knowledge of [...definition.knowledge.bootstrap, ...definition.knowledge.available]) {
    if (typeof knowledge !== "string") { issues.push({ path: "knowledge", message: "must contain Subject Knowledge IDs" }); continue; }
    if (!knownKnowledge.has(knowledge)) issues.push({ path: `knowledge.${knowledge}`, message: "does not resolve to Subject Knowledge" });
  }
  if (definition.completion.mode !== "user") issues.push({ path: "completion.mode", message: "must be user" });
  return issues;
}
