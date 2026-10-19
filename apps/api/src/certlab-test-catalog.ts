import type { CapabilityCatalog, ForgeUseCases } from "@airic-forge/domain";

export async function acknowledgeCheckpoint(useCases: ForgeUseCases, ticket: string) {
  const progress = (await useCases.sessionHistory(ticket)).progress;
  if (progress.waiting && progress.checkpoint) await useCases.checkpointFeedback(ticket, {
    checkpointId: progress.checkpoint.id, kind: "approve", note: "Synthetic engineer checked the step",
  }, `ack-${progress.checkpoint.id}`);
}

export const initialCapabilityIds = [
  "report.context", "assessment.context", "assessment.history", "command.receipt",
  "assessment.start", "assessment.save-draft", "assessment.reverify",
  "command.context", "test-task.list", "finding.list", "work-item.context",
  "output.context", "report.output-readiness", "test-task.create", "test-task.edit",
  "finding.create", "finding.edit", "work-item.block", "work-item.respond", "work-item.complete",
  "report.output-configure", "test-plan.generate", "finding-export.generate", "report.generate", "job.retry",
  "asset.list", "asset.locations", "asset.revisions", "asset.read", "asset.search", "asset.read-location", "asset.impact-preview",
];
export function testCatalog(digest = "accepted"): CapabilityCatalog {
  const scopes: Record<string, string> = {
    "assessment.start": "assessment.start",
    "assessment.save-draft": "assessment.save_draft",
    "assessment.reverify": "assessment.start_reassessment",
    "test-task.create": "test_task.create:{assessment_id}",
    "test-task.edit": "test_task.revise:{item_id}",
    "finding.create": "finding.create:{assessment_id}",
    "finding.edit": "finding.revise:{item_id}",
    "work-item.block": "assessment.add_blocker",
    "work-item.respond": "{item_scope}:{item_id}",
    "work-item.complete": "{item_scope}:{item_id}",
    "report.output-configure": "report_output.configure:{report_id}",
    "test-plan.generate": "test_plan.create",
    "finding-export.generate": "finding_export.create",
    "report.generate": "report_output.create:{report_id}",
    "job.retry": "{retry_scope}:{object_id}",
  };
  return {
    id: "catalog", appId: "certlab", domainRelease: "certlab/v1", digest,
    acceptedAt: "",
    capabilities: initialCapabilityIds.map((id) => ({
      id, kind: scopes[id] ? "command" : "query", title: id, description: "",
      inputSchema: { type: "object" }, outputSchema: { type: "object" },
      ...(scopes[id] ? { receiptScope: scopes[id] } : {}),
    })),
  };
}
