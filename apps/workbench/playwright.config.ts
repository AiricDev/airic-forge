import { defineConfig, devices } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
const port = Number(process.env.FORGE_E2E_PORT || 4189);
const metadata = (process.env.FORGE_E2E_METADATA ||= join(
  tmpdir(),
  `airic-mui-e2e-metadata-${randomUUID()}.json`,
));
export default defineConfig({
  testDir: "./e2e",
  timeout: 45000,
  expect: { timeout: 10000 },
  workers: 1,
  fullyParallel: false,
  outputDir: "./test-results",
  reporter: "list",
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "node scripts/acceptance/mui-browser-server.mjs",
    cwd: "../..",
    url: `http://127.0.0.1:${port}/health`,
    timeout: 120000,
    reuseExistingServer: false,
    env: { FORGE_E2E_METADATA: metadata },
    gracefulShutdown: { signal: "SIGTERM", timeout: 5000 },
  },
});
