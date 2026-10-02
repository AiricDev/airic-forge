import { resolve } from "node:path";

const list = (value: string | undefined) => new Set((value ?? "").split(",").map((entry) => entry.trim().toLowerCase()).filter(Boolean));

export interface ForgeConfig {
  port: number;
  projectDir: string;
  dataDir: string;
  seedProjectDir: string;
  certReporterUrl: string;
  allowedOrigin: string;
  initialAdminEmails: Set<string>;
}

export function loadConfig(env = process.env): ForgeConfig {
  return {
    port: Number(env.FORGE_PORT ?? 4175),
    projectDir: resolve(env.FORGE_PROJECT_DIR ?? "./runtime/project"),
    dataDir: resolve(env.FORGE_DATA_DIR ?? "./runtime/data"),
    seedProjectDir: resolve(env.FORGE_SEED_PROJECT_DIR ?? "./seed/project"),
    certReporterUrl: (env.FORGE_CERTREPORTER_URL ?? "http://127.0.0.1:8000").replace(/\/$/, ""),
    allowedOrigin: env.FORGE_ALLOWED_ORIGIN ?? "http://127.0.0.1:5173",
    initialAdminEmails: list(env.FORGE_INITIAL_ADMIN_EMAILS),
  };
}
