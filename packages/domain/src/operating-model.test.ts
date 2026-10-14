import assert from "node:assert/strict";
import test from "node:test";
import { isAllowedProposalPath, validateWorkDefinition, type WorkDefinition } from "./operating-model.js";

const definition: WorkDefinition = {
  schemaVersion: 1,
  id: "report-authoring",
  title: "Report authoring",
  description: "Test",
  capabilities: { allowed: ["report.context"] },
  documents: [{ id: "policy", path: "policy.md", title: "Policy", role: "policy", load: "required" }],
  knowledge: { bootstrap: ["sk:report-model"], available: [] },
  completion: { mode: "user", requiredCapabilities: [] },
};

test("work definition accepts an allowed capability and known knowledge", () => {
  assert.deepEqual(validateWorkDefinition(definition, new Set(["report.context"]), new Set(["sk:report-model"])), []);
});

test("work definition rejects a capability outside the accepted catalog", () => {
  const issues = validateWorkDefinition(definition, new Set(), new Set(["sk:report-model"]));
  assert.match(issues[0]?.message ?? "", /accepted capability catalog/);
});

test("governed nested knowledge and precedents never allow traversal or arbitrary source files", () => {
  for (const path of ["subject-knowledge/standards/semi-s2/0724/clauses/12-2-3/interpretation.md", "precedents/semi-s2/0724/circuit.md", "subject-knowledge/standards/README.md"]) assert.equal(isAllowedProposalPath(path), true);
  for (const path of ["design/source-inventory.json", "subject-knowledge/../secret.md", "/subject-knowledge/test.md", "precedents/x/.git/config", "precedents//test.md", "work-definitions/x/nested/policy.md"]) assert.equal(isAllowedProposalPath(path), false);
});
