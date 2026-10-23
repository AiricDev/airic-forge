import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, mkdtempSync, rmSync, symlinkSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { GitOperatingModel } from "./git-om.js";

test("seed symlinks and source/runtime overlap are rejected before importing files", () => {
  const root = mkdtempSync(join(tmpdir(), "forge-unsafe-seed-"));
  try {
    const seed = join(root, "seed");
    mkdirSync(join(seed, "subject-knowledge"), { recursive: true });
    writeFileSync(join(root, "private.md"), "not authorized");
    symlinkSync(join(root, "private.md"), join(seed, "subject-knowledge/linked.md"));
    const om = new GitOperatingModel(join(root, "project"), join(root, "data"), seed);
    assert.throws(() => om.initialize(), /OmSeedSymlinkNotAllowed/);
    assert(!existsSync(join(root, "project/subject-knowledge/linked.md")));
    assert.throws(() => new GitOperatingModel(seed, join(root, "data"), seed).initialize(), /OmSeedRuntimeOverlap/);
    assert(!existsSync(join(seed, ".git")));
  } finally { rmSync(root, { recursive: true, force: true }); }
});
