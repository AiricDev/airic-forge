import { createHash } from "node:crypto";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { resolve } from "node:path";


export interface ForgeConfig {
  port: number;
  bindHost?: string;
  trustedProxy?: string;
  projectDir: string;
  dataDir: string;
  /** Explicit fixture/import source for programmatic callers, never loaded from env. */
  seedProjectDir?: string;
  workDefinitionId?: string;
  webDistDir: string;
  appUrl: string;
  appId?: string;
  appAdapterModule?: string;
  organizationId: string;
  allowedOrigin: string;
  publicUrl?: string;
  testIdentitySwitch?: boolean;
  modelProvider?: string;
  modelId?: string;
  modelApiKey?: string;
  modelBaseUrl?: string;
  contextOutputTokens?: number;
  agentConfigDir?: string;
  agentCacheDir?: string;
  deploymentId?: string;
  requiredPrograms?: string[];
}

export function loadConfig(env = process.env): ForgeConfig {
  return {
    agentConfigDir: env.FORGE_AGENT_CONFIG_DIR ? resolve(env.FORGE_AGENT_CONFIG_DIR) : undefined,
    agentCacheDir: env.FORGE_AGENT_CACHE_DIR ? resolve(env.FORGE_AGENT_CACHE_DIR) : undefined,
    deploymentId: env.FORGE_DEPLOYMENT_ID ?? sourceBuildIdentity(),
    requiredPrograms: env.FORGE_REQUIRED_PROGRAMS?.split(",").map(s => s.trim()).filter(Boolean),
    port: Number(env.FORGE_PORT ?? 4175),
    bindHost: env.FORGE_BIND_HOST,
    trustedProxy: env.FORGE_TRUST_PROXY,
    projectDir: resolve(env.FORGE_PROJECT_DIR ?? "./runtime/project"),
    dataDir: resolve(env.FORGE_DATA_DIR ?? "./runtime/data"),
    workDefinitionId: env.FORGE_WORK_DEFINITION,
    webDistDir: resolve(env.FORGE_WEB_DIST_DIR ?? "./apps/workbench/public"),
    appId: env.FORGE_APP_ID,
    appAdapterModule: env.FORGE_APP_ADAPTER_MODULE ? resolve(env.FORGE_APP_ADAPTER_MODULE) : undefined,
    appUrl: (env.FORGE_APP_URL ?? "http://127.0.0.1:8000").replace(/\/$/, ""),
    organizationId: (env.FORGE_ORGANIZATION_ID ?? "").trim(),
    allowedOrigin: env.FORGE_ALLOWED_ORIGIN ?? "http://127.0.0.1:5173",
    publicUrl: (env.FORGE_PUBLIC_URL ?? "http://127.0.0.1:4175").replace(/\/$/, ""),
    testIdentitySwitch: env.FORGE_ENABLE_TEST_IDENTITY_SWITCH === "true",
    modelProvider: env.FORGE_MODEL_PROVIDER,
    modelId: env.FORGE_MODEL_ID,
    modelApiKey: env.FORGE_MODEL_API_KEY,
    modelBaseUrl: env.FORGE_MODEL_BASE_URL,
    contextOutputTokens: positiveBudget(env.FORGE_CONTEXT_OUTPUT_TOKENS, 8_000),
  };
}

function positiveBudget(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1024 || number > 1_000_000) throw new Error("InvalidContextBudget");
  return number;
}

function sourceBuildIdentity(): string {
  const hash = createHash("sha256");
  const here = dirname(fileURLToPath(import.meta.url));
  for (const root of [here, resolve(here, "../../../packages/domain/dist")]) {
    if (!existsSync(root)) continue;
    for (const name of readdirSync(root).sort()) {
      if (!/\.(?:js|ts)$/.test(name) || /test|fixture|probe/.test(name)) continue;
      hash.update(name); hash.update(readFileSync(join(root, name)));
    }
  }
  return `source:${hash.digest("hex")}`;
}
