/** Deployment-owned code extension. Forge supplies transport; the App owns DTOs and professional policy. */
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import { digest, normalizeEmail } from "./ids.js";
import * as mcp from "./mcp-client.js";
import type { AppPort } from "@airic-forge/domain";
import type { ForgeConfig } from "./config.js";
const services = { Ajv2020, digest, normalizeEmail, ...mcp };
export type AppAdapterFactory = (input: {
  config: { appId: string; appUrl: string; organizationId: string };
  services: typeof services;
}) => AppPort;
export function loadAppPort(config: ForgeConfig): AppPort {
  if (!config.appId?.trim()) throw Error("AppIdRequired");
  if (!config.appAdapterModule) throw Error("AppAdapterModuleRequired");
  const module = createRequire(import.meta.url)(
    resolve(config.appAdapterModule),
  ) as { createAppPort?: AppAdapterFactory };
  if (typeof module.createAppPort !== "function")
    throw Error("InvalidAppAdapterModule");
  const app = module.createAppPort({
    config: {
      appId: config.appId,
      appUrl: config.appUrl,
      organizationId: config.organizationId,
    },
    services,
  });
  for (const method of [
    "identity",
    "resourceContext",
    "discoverTools",
    "query",
    "prepareCommand",
    "submitCommand",
    "receipt",
  ] as const)
    if (typeof app[method] !== "function") throw Error("InvalidAppAdapterPort");
  return app;
}
