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
  capabilities: { allowed: string[] };
  documents: WorkDocument[];
  knowledge: { bootstrap: string[]; available: string[] };
  completion: { mode?: "user"; requiredCapabilities: string[] };
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
  return /^(work-definitions\/[a-z0-9-]+\/(?:work\.yml|[a-z0-9-]+\.md)|subject-knowledge\/[a-z0-9-]+\.md)$/.test(path);
}

export function validateWorkDefinition(
  definition: WorkDefinition,
  knownCapabilities: ReadonlySet<string>,
  knownKnowledge: ReadonlySet<string>,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (definition.schemaVersion !== 1) issues.push({ path: "schemaVersion", message: "must be 1" });
  if (!/^[a-z][a-z0-9-]*$/.test(definition.id)) issues.push({ path: "id", message: "must be a kebab-case identifier" });
  const documentIds = new Set<string>();
  for (const document of definition.documents) {
    if (!document || typeof document.id !== "string" || typeof document.path !== "string") {
      issues.push({ path: "documents", message: "each document needs an id and path" });
      continue;
    }
    if (documentIds.has(document.id)) issues.push({ path: `documents.${document.id}`, message: "document id must be unique" });
    documentIds.add(document.id);
    if (!/^[a-z][a-z0-9-]*$/.test(document.id)) issues.push({ path: `documents.${document.id}.id`, message: "must be a stable kebab-case identifier" });
    if (!/^[a-z0-9-]+\.md$/.test(document.path)) issues.push({ path: `documents.${document.id}.path`, message: "must name a markdown file in the work definition package" });
    if (!["policy", "procedure", "reference", "precedent"].includes(document.role)) issues.push({ path: `documents.${document.id}.role`, message: "must be a supported document role" });
    if (!["required", "on-demand"].includes(document.load)) issues.push({ path: `documents.${document.id}.load`, message: "must be required or on-demand" });
  }
  for (const capability of definition.capabilities.allowed) {
    if (!knownCapabilities.has(capability)) issues.push({ path: `capabilities.allowed.${capability}`, message: "is not in the accepted capability catalog" });
  }
  for (const knowledge of [...definition.knowledge.bootstrap, ...definition.knowledge.available]) {
    if (!knownKnowledge.has(knowledge)) issues.push({ path: `knowledge.${knowledge}`, message: "does not resolve to Subject Knowledge" });
  }
  for (const capability of definition.completion.requiredCapabilities) {
    if (!definition.capabilities.allowed.includes(capability)) issues.push({ path: `completion.requiredCapabilities.${capability}`, message: "must be allowed by this Work" });
  }
  return issues;
}
