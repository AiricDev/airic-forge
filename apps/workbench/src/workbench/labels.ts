import type { WorkFeedbackKind, ReflectionLens } from "./types";
export const feedbackLabel: Record<WorkFeedbackKind, string> = {
  "required-human-decision": "必要人工判断",
  "avoidable-correction": "可避免纠正",
  "knowledge-helpful": "知识确有帮助",
  "work-outcome-correct": "工作结果正确",
  "work-outcome-incorrect": "工作结果有误",
};
export const lensName: Record<ReflectionLens["id"], string> = {
  "domain-knowledge": "Domain Knowledge",
  "delegation-gap": "Delegation Gap",
  "api-suggestion": "API Suggestion",
};
export const activityLabel: Record<string, string> = {
  works: "Work 总数",
  completedWorks: "已结束 Work",
  turns: "Turn 总数",
  reflections: "Reflection 总数",
  personalOmCommits: "个人 OM 提交",
  organizationContributions: "组织贡献",
  acceptedOrganizationContributions: "已吸收组织贡献",
  medianOrganizationReviewHours: "组织贡献吸收中位耗时",
};
export function baselineValue(key: string, value: number | null): string {
  if (value == null) return "样本不足";
  if (!key.endsWith("Hours")) return String(value);
  if (value > 0 && value * 60 < 1) return "不足 1 分钟";
  return value < 1
    ? `${Math.round(value * 60)} 分钟`
    : `${value.toFixed(1)} 小时`;
}
