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
    if (documentIds.has(document.id)) issues.push({ path: `documents.${document.id}`, message: "document id must be unique" });
    documentIds.add(document.id);
    if (document.path.startsWith("/") || document.path.includes("..")) issues.push({ path: `documents.${document.id}.path`, message: "must stay inside the work definition package" });
  }
  for (const capability of definition.capabilities.allowed) {
    if (!knownCapabilities.has(capability)) issues.push({ path: `capabilities.allowed.${capability}`, message: "is not in the accepted capability catalog" });
  }
  for (const knowledge of [...definition.knowledge.bootstrap, ...definition.knowledge.available]) {
    if (!knownKnowledge.has(knowledge)) issues.push({ path: `knowledge.${knowledge}`, message: "does not resolve to Subject Knowledge" });
  }
  return issues;
}
