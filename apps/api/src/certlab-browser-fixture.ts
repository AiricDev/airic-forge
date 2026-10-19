/** Local-only synthetic browser fixture, never a production entry point. */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { ForgeUseCases, type AgentRunnerPort, type ReflectionAgentPort } from "@airic-forge/domain";
import { ForgeRuntime } from "./runtime.js";
import { buildServer } from "./server.js";
import { systemPort } from "./system-port.js";
import { hashPassword, verifyPassword } from "./auth.js";

const root = mkdtempSync(join(tmpdir(), "certlab-forge-browser-"));
const apiPort = process.env.CERTLAB_E2E_API_PORT ?? "8000";
const webPort = process.env.CERTLAB_E2E_WEB_PORT ?? "5173";
const port = Number(process.env.CERTLAB_E2E_FORGE_PORT ?? "4176");
const forgeRoot = resolve(process.env.CERTLAB_FORGE_ROOT ?? "../../airic-forge");
const runtime = new ForgeRuntime({ port, projectDir: join(root, "project"), dataDir: join(root, "data"), seedProjectDir: join(forgeRoot, "seed/certlab"), webDistDir: join(forgeRoot, "apps/workbench/public"), certLabUrl: `http://127.0.0.1:${apiPort}`, organizationId: "synthetic-browser-institution", allowedOrigin: `http://127.0.0.1:${process.env.CERTLAB_E2E_BUILT === "1" ? apiPort : webPort}`, publicUrl: `http://127.0.0.1:${port}`, initialAdminEmails: new Set() });
const catalog = runtime.app.catalog.bind(runtime.app);
runtime.app.catalog = async (token) => {
  const candidate = await catalog(token);
  const admin = runtime.db.ensureUser("synthetic-fixture-admin@example.invalid", true);
  runtime.db.saveCandidate(candidate, {}); runtime.db.accept("certlab", candidate.digest, admin.id);
  return candidate;
};
const identity = runtime.app.identity.bind(runtime.app);
runtime.app.identity = async (token) => {
  const actor = await identity(token);
  await runtime.app.catalog(token);
  return actor;
};
const learnedId = "synthetic-browser-source-scope";
const agents: AgentRunnerPort = { runWork: async ({ tools, context, userMessage, onText, onModelStatus, signal, checkpoint, availableDocumentIds, loadDocument }) => {
  onModelStatus?.();
  await new Promise(resolve => setTimeout(resolve, 10));
  onText?.("合成 Agent 正在读取原目标。");
  if (userMessage === "learned") {
    if (!availableDocumentIds.includes(learnedId) || !(await loadDocument(learnedId)).includes("candidate")) throw new Error("SyntheticAdoptedKnowledgeMissing");
    return { text: "已在同一 Work 下一 Turn 读取作者采纳的新知识；旧 Turn 和专业确认仍不变。" };
  }
  if (userMessage === "slow") {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, 20_000);
      signal?.addEventListener("abort", () => { clearTimeout(timer); reject(new Error("SyntheticStopped")); }, { once: true });
    });
  }
  if (userMessage === "save") {
    const assessments = context.assessments as Array<{ id: string }>;
    const reportId = (context.resource as { resourceId: string }).resourceId;
    const assessmentId = assessments[0].id;
    const current = await tools.find((tool) => tool.capability.id === "assessment.context")!.invoke({ assessment_id: assessmentId });
    let recordNo = (current.assessment as { record_no: number }).record_no;
    if (!recordNo) {
      await tools.find((tool) => tool.capability.id === "assessment.start")!.invoke({ assessment_id: assessmentId, expected_record_no: recordNo });
      recordNo++;
    }
    await tools.find((tool) => tool.capability.id === "assessment.save-draft")!.invoke({ report_id: reportId, assessment_id: assessmentId, expected_record_no: recordNo, result_fields: { conformity: "conform", note: "Synthetic assistant fixture" }, rationale: "Synthetic browser fixture only" });
  }
  if (userMessage === "work") {
    const assessmentId = (context.assessments as Array<{ id: string }>)[0].id;
    const invoke = (id: string, input: Record<string, unknown>) => tools.find((tool) => tool.capability.id === id)!.invoke(input);
    const current = await invoke("assessment.context", { assessment_id: assessmentId });
    let recordNo = (current.assessment as { record_no: number }).record_no;
    if (!recordNo) {
      await invoke("assessment.start", { assessment_id: assessmentId, expected_record_no: 0 });
      recordNo++;
    }
    const created = await invoke("test-task.create", {
      assessment_id: assessmentId, expected_record_no: recordNo,
      requirements: "Synthetic actual physical test is required", asset_revision_ids: [], register_blocker: true,
    });
    if (created.status !== "committed") throw new Error("SyntheticWorkCreationFailed");
    const report = await invoke("report.context", {});
    const generated = await invoke("test-plan.generate", { expected_version: (report.project as { version: number }).version });
    if (generated.status !== "committed") throw new Error("SyntheticJobCreationFailed");
    const plan = (generated.receipt as { receipt: { response: { id: string } } }).receipt.response;
    const output = await invoke("output.context", { job_kind: "test-plan", object_id: plan.id });
    await checkpoint!({ summary: "已登记实际测试要求，尚未实测；检查稿 Job 已受理。",
      eventIds: [String(created.actionEventId), String(generated.actionEventId), String(output.observationEventId)],
      selfCheck: "没有伪造测量、交接或专业确认；Job 排队不等于生成成功。",
      uncertainties: ["缺少真实测量和样机信息"], nextStep: "人工执行并关联真实回传",
      remainingWork: ["实际测试", "专业确认", "报告交付"], waitFor: "external",
      resumeCondition: "真实回传已关联，并明确恢复原目标" });
    return { text: "合成事项已保存，等待真实系统外工作，目标未完成。" };
  }
  if (userMessage === "material") {
    const invoke = (id: string, input: Record<string, unknown>) => tools.find((tool) => tool.capability.id === id)!.invoke(input);
    const listed = await invoke("asset.list", {});
    const asset = (listed.items as Array<{ asset_id: string; revision_id: string }>)[0];
    if (!asset) throw new Error("SyntheticMaterialMissing");
    const material = await invoke("asset.read", { revision_id: asset.revision_id, page: 2, include_image: true });
    if (material.status !== "ready" || !material.image) throw new Error("SyntheticMaterialReadFailed");
    await checkpoint!({ summary: "已实际读取原 PDF 第二页，专业结果仍未验证。",
      eventIds: [String(material.observationEventId)], selfCheck: "来源固定原 revision；未把读取当作符合。",
      uncertainties: ["合成 Agent 不证明图纸理解质量"], nextStep: "工程师核对原图",
      remainingWork: ["实际专业分析", "人工确认"], waitFor: "feedback", resumeCondition: "工程师核对原页后明确反馈" });
    return { text: "合成来源读取已完成，判断未定，等待原图核对。" };
  }
  return { text: userMessage === "unsafe" ? '<script>alert("unsafe")</script> ![external](https://example.invalid/image.png)\n合成安全文本' : "合成回复结束，目标尚未完成。专业确认仍需人工。" };
} };
const reflectionAgent: ReflectionAgentPort = { analyze: async (input) => {
  const events = await input.readTrajectory!(0, 20);
  const citedEventIds = events.filter((event) => event.type === "observation" || event.type === "work.feedback").map((event) => event.id);
  if (input.lens.id !== "domain-knowledge" || !citedEventIds.length) return { outcome: "analysis", analysis: "证据不足以证明可复用专业改善，不自动产生提案。", attribution: "", citedEventIds };
  return { outcome: "proposal", analysis: "依据原资料读取及人工反馈提出有范围的知识候选，不宣称符合。", attribution: "本 Work 实际来源和工程师反馈", citedEventIds, edits: [{ path: "subject-knowledge/standards/synthetic/2026/source-scope.md", content: `---\nid: ${learnedId}\ntitle: 合成来源范围\nsummary: 保存原版本及实际限制。\ntopics: [source]\nreview_state: candidate\n---\n\n合成候选，不替代专业确认。\n` }] };
} };
Object.assign(runtime, { useCases: new ForgeUseCases({ accounts: runtime.db, works: runtime.db, om: runtime.om, omDrafts: runtime.db, app: runtime.app, organizationId: runtime.config.organizationId, catalogs: runtime.db, agents, reflectionAgent, reflectionRunStore: runtime.db, sessions: runtime.sessions, passwordSetups: runtime.passwordSetups, passwordCodec: { hash: hashPassword, verify: verifyPassword }, trajectories: runtime.trajectories, system: systemPort, initialAdminEmails: new Set() }) });
const app = buildServer(runtime);
await app.listen({ host: "127.0.0.1", port });
let stopping = false;
async function stop() {
  if (stopping) return; stopping = true;
  await app.close(); runtime.db.close(); rmSync(root, { recursive: true, force: true });
}
process.on("SIGTERM", () => { void stop(); });
process.on("SIGINT", () => { void stop(); });
