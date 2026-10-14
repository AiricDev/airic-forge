import { resolve } from "node:path";

const list = (value: string | undefined) => new Set((value ?? "").split(",").map((entry) => entry.trim().toLowerCase()).filter(Boolean));

export interface ForgeConfig {
  port: number;
  bindHost?: string;
  projectDir: string;
  dataDir: string;
  seedProjectDir: string;
  webDistDir: string;
  certReporterUrl: string;
  allowedOrigin: string;
  publicUrl?: string;
  initialAdminEmails: Set<string>;
  testIdentitySwitch?: boolean;
  modelProvider?: string;
  modelId?: string;
  modelApiKey?: string;
  modelBaseUrl?: string;
}

export function loadConfig(env = process.env): ForgeConfig {
  return {
    port: Number(env.FORGE_PORT ?? 4175),
    bindHost: env.FORGE_BIND_HOST,
    projectDir: resolve(env.FORGE_PROJECT_DIR ?? "./runtime/project"),
    dataDir: resolve(env.FORGE_DATA_DIR ?? "./runtime/data"),
    seedProjectDir: resolve(env.FORGE_SEED_PROJECT_DIR ?? "./seed/project"),
    webDistDir: resolve(env.FORGE_WEB_DIST_DIR ?? "./prototype/dist"),
    certReporterUrl: (env.FORGE_CERTREPORTER_URL ?? "http://127.0.0.1:8000").replace(/\/$/, ""),
    allowedOrigin: env.FORGE_ALLOWED_ORIGIN ?? "http://127.0.0.1:5173",
    publicUrl: (env.FORGE_PUBLIC_URL ?? "http://127.0.0.1:4175").replace(/\/$/, ""),
    initialAdminEmails: list(env.FORGE_INITIAL_ADMIN_EMAILS),
    testIdentitySwitch: env.FORGE_ENABLE_TEST_IDENTITY_SWITCH === "true",
    modelProvider: env.FORGE_MODEL_PROVIDER,
    modelId: env.FORGE_MODEL_ID,
    modelApiKey: env.FORGE_MODEL_API_KEY,
    modelBaseUrl: env.FORGE_MODEL_BASE_URL,
  };
}
