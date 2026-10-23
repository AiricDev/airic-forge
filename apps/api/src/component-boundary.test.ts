/** Guard release ownership: App DTOs and synthetic fixtures must not enter either shipped component. */
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { resolve, join } from "node:path";
test("clean production builds contain neither App-specific policy nor test entry points", () => {
  for (const directory of [
    resolve("dist"),
    resolve("../../packages/domain/dist"),
  ]) {
    const names = readdirSync(directory).filter((name) => name.endsWith(".js"));
    assert(names.length > 0);
    for (const name of names) {
      assert.doesNotMatch(name, /test|fixture|probe|certlab/i);
      assert.doesNotMatch(
        readFileSync(join(directory, name), "utf8"),
        /certlab|report-authoring|assessment\.(?:context|save-draft)|asset\.read|workspace_id/i,
        name,
      );
    }
  }
});
