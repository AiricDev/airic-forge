/** Explicit deployment adapters cannot inherit credentials through the factory configuration. */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadAppPort } from "./app-adapter.js";
import { loadConfig } from "./config.js";
test("App adapter configuration is explicit, validated and excludes model secrets", async () => {
  const root = mkdtempSync(join(tmpdir(), "forge-adapter-"));
  const file = join(root, "adapter.mjs");
  const config = {
    ...loadConfig({}),
    appId: "inventory",
    appUrl: "https://inventory.invalid",
    organizationId: "org",
    modelApiKey: "private-model-secret",
  };
  try {
    assert.throws(
      () => loadAppPort({ ...config, appId: undefined }),
      /AppIdRequired/,
    );
    assert.throws(() => loadAppPort(config), /AppAdapterModuleRequired/);
    writeFileSync(
      file,
      `export const createAppPort=({config})=>{
    if(Object.keys(config).sort().join(',')!=='appId,appUrl,organizationId')throw Error('UnexpectedConfig');
    const fail=async()=>{throw Error('unused')};
    return {identity:async()=>({appId:config.appId,appUserId:'u',email:'u@example.invalid',displayName:'User',organizationId:config.organizationId}),resourceContext:fail,discoverTools:fail,query:fail,prepareCommand:fail,submitCommand:fail,receipt:fail};
  };`,
    );
    const app = loadAppPort({ ...config, appAdapterModule: file });
    assert.equal((await app.identity("unused")).appId, "inventory");
    const invalid = join(root, "invalid.cjs");
    writeFileSync(invalid, "exports.createAppPort=()=>({});");
    assert.throws(
      () => loadAppPort({ ...config, appAdapterModule: invalid }),
      /InvalidAppAdapterPort/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
