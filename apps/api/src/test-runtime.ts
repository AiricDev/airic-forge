import { ForgeRuntime } from "./runtime.js";
import { unavailableApp } from "./unavailable-app.js";
import type { ForgeConfig } from "./config.js";
/** Synthetic unit fixture. It never connects to an App or invokes a model by default. */
export class TestRuntime extends ForgeRuntime {
  constructor(config: ForgeConfig) {
    const app = unavailableApp();
    app.bindInput = (entityId, input) => {
      if (input.workspace_id !== undefined && input.workspace_id !== entityId)
        throw Error("CommandTargetMismatch");
      return { ...input, workspace_id: entityId };
    };
    app.prepareCommand = async (_token, capability, input) => ({
      resourceKind: "workspace",
      resourceId: "fixture",
      scope: capability,
      targetKind: "item",
      targetId: String(input.entry_id ?? input.entity_id ?? "item"),
    });
    config.appId ??= "app";
    app.auditObservation = (_id, result) => ({
      status: result.status,
      source: result.source,
      warnings: result.warnings,
      textCharacters:
        typeof result.text === "string" ? Array.from(result.text).length : 0,
      imageAvailable: !!result.image,
    });
    super(config, app);
  }
}
