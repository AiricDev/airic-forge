import { resolve } from "node:path";


export interface ForgeConfig {
  port: number;
  bindHost?: string;
  trustedProxy?: string;
  projectDir: string;
  dataDir: string;
  /** Explicit fixture/import source for programmatic callers, never loaded from env. */
  seedProjectDir?: string;
  reportWorkDefinitionId?: string;
  webDistDir: string;
  certLabUrl: string;
  organizationId: string;
  allowedOrigin: string;
  publicUrl?: string;
  testIdentitySwitch?: boolean;
  modelProvider?: string;
  modelId?: string;
  modelApiKey?: string;
  modelBaseUrl?: string;
  contextInputTokens?: number;
  contextOutputTokens?: number;
}

export function loadConfig(env = process.env): ForgeConfig {
  return {
    port: Number(env.FORGE_PORT ?? 4175),
    bindHost: env.FORGE_BIND_HOST,
    trustedProxy: env.FORGE_TRUST_PROXY,
    projectDir: resolve(env.FORGE_PROJECT_DIR ?? "./runtime/certlab/project"),
    dataDir: resolve(env.FORGE_DATA_DIR ?? "./runtime/certlab/data"),
    reportWorkDefinitionId: env.FORGE_REPORT_WORK_DEFINITION,
    webDistDir: resolve(env.FORGE_WEB_DIST_DIR ?? "./apps/workbench/public"),
    certLabUrl: (env.FORGE_CERTLAB_URL ?? "http://127.0.0.1:8000").replace(/\/$/, ""),
    organizationId: (env.FORGE_ORGANIZATION_ID ?? "").trim(),
    allowedOrigin: env.FORGE_ALLOWED_ORIGIN ?? "http://127.0.0.1:5173",
    publicUrl: (env.FORGE_PUBLIC_URL ?? "http://127.0.0.1:4175").replace(/\/$/, ""),
    testIdentitySwitch: env.FORGE_ENABLE_TEST_IDENTITY_SWITCH === "true",
    modelProvider: env.FORGE_MODEL_PROVIDER,
    modelId: env.FORGE_MODEL_ID,
    modelApiKey: env.FORGE_MODEL_API_KEY,
    modelBaseUrl: env.FORGE_MODEL_BASE_URL,
    contextInputTokens: positiveBudget(env.FORGE_CONTEXT_INPUT_TOKENS, 256_000),
    contextOutputTokens: positiveBudget(env.FORGE_CONTEXT_OUTPUT_TOKENS, 8_000),
  };
}

function positiveBudget(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1024 || number > 1_000_000) throw new Error("InvalidContextBudget");
  return number;
}
