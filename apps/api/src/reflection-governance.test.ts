import assert from "node:assert/strict";
import test from "node:test";
import type { ReflectionAgentPort } from "@airic-forge/domain";
import { omFixture } from "./om-test-fixture.js";
const path = "work-definitions/document-task/method.md";
test("independent Reflection prepares edits on explicit instruction without a Lens or fabricated Work", async () => {
  const agent: ReflectionAgentPort = { analyze: async (input) => {
    assert.equal(input.readTrajectory, undefined);
    if (input.question === "Discuss") return { outcome: "analysis", analysis: "We can improve the method.", attribution: "User experience", citedEventIds: [] };
    await input.writeDraftFile!(path, input.documents.find((item) => item.path === path)!.content + "\nKeep the sample source.\n", [], "Keep sample sources");
    return { outcome: "changes", analysis: "Prepared the requested change.", attribution: "Owner supplied sample-analysis experience", citedEventIds: [] };
  } };
  const f = omFixture(agent);
  try {
    const opened = await f.runtime.useCases.openPersonalReflection(f.owner.id, "Improve sample analysis");
    assert.equal(opened.reflection.workId, undefined);
    assert.equal(f.runtime.db.worksPage({ ownerUserId: f.owner.id }, 0, 20).total, 0);
    const first = await f.runtime.useCases.continueReflection(f.owner.id, opened.reflection.id, "Discuss");
    assert.equal(first.draft?.edits.length, 0);
    const changed = await f.runtime.useCases.continueReflection(f.owner.id, opened.reflection.id, "Please update the OM");
    assert.equal(changed.draft?.edits.length, 1);
    assert.equal(f.runtime.om.head(`users/${f.owner.id}`), opened.reflection.omRevision);
    const result = await f.runtime.omChanges.commit(f.owner.id, changed.draft!.scope, changed.draft!.digest, "reflection-commit");
    const continued = await f.runtime.useCases.continueReflection(f.owner.id, opened.reflection.id, "Discuss");
    assert.equal(continued.reflection.status, "active");
    assert.equal(continued.reflection.omRevision, result.revision);
    assert.equal((await f.runtime.useCases.personalReflections(f.owner.id)).length, 1);
    assert.equal((await f.runtime.useCases.personalReflections(f.other.id)).length, 0);
    await assert.rejects(() => f.runtime.useCases.continueReflection(f.admin.id, opened.reflection.id, "Edit"), /ReflectionNotOwned/);
  } finally { await f.close(); }
});
test("Work trajectory is bounded, citations must be disclosed, Lens remains optional and API suggestions do not write OM", async () => {
  let badCitation = false;
  const f = omFixture({ analyze: async (input) => {
    const events = await input.readTrajectory!(0, 20);
    assert.equal(events.length, 20);
    assert(!events.some((event) => event.id === "private-other-event"));
    await assert.rejects(() => input.readTrajectory!(0, 21), /InvalidTrajectoryPage/);
    if (badCitation) return { outcome: "analysis", analysis: "Invalid source", attribution: "", citedEventIds: ["private-other-event"] };
    return { outcome: "api-suggestion", analysis: "An App capability is missing.", attribution: "Read source events", citedEventIds: [events[0].id], suggestionMarkdown: "# Suggested capability" };
  } });
  try {
    const work = f.runtime.db.createWork(f.owner.id, "sample-app", "document-task", "report");
    const other = f.runtime.db.createWork(f.other.id, "sample-app", "document-task", "other");
    for (let index = 0; index < 25; index++) f.runtime.trajectories.append({ id: `event-${index}`, workId: work.id, type: "message", at: "now", payload: {} });
    f.runtime.trajectories.append({ id: "private-other-event", workId: other.id, type: "message", at: "now", payload: {} });
    const opened = await f.runtime.useCases.openWorkReflection(f.owner.id, work.id);
    assert.equal((await f.runtime.useCases.openWorkReflection(f.owner.id, work.id)).reflection.id, opened.reflection.id);
    await assert.rejects(() => f.runtime.useCases.continueReflection(f.owner.id, opened.reflection.id, "/unknown Learn"), /UnknownReflectionLens/);
    assert.equal(f.runtime.db.reflectionMessages(opened.reflection.id).length, 1);
    const result = await f.runtime.useCases.continueReflection(f.owner.id, opened.reflection.id, "/api-suggestion Discuss");
    assert.equal(result.draft?.edits.length, 0);
    assert.match(await f.runtime.useCases.reflectionSuggestion(f.owner.id, opened.reflection.id), /Suggested/);
    badCitation = true;
    await assert.rejects(() => f.runtime.useCases.continueReflection(f.owner.id, opened.reflection.id, "Discuss"), /ReflectionEvidenceMismatch/);
    f.runtime.db.updateLens("api-suggestion", false, "Disabled");
    await assert.rejects(() => f.runtime.useCases.continueReflection(f.owner.id, opened.reflection.id, "/api-suggestion Discuss"), /ReflectionLensDisabled/);
  } finally { await f.close(); }
});
