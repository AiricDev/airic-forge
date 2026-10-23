import assert from "node:assert/strict";
import test from "node:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bindInstanceRoots } from "./instance-binding.js";

test("new roots bind one App and organization and reject a changed binding on restart", () => {
  const root = mkdtempSync(join(tmpdir(), "forge-binding-"));
  try {
    const project = join(root, "project"), data = join(root, "data");
    bindInstanceRoots(project, data, "synthetic-org", "sample-app");
    mkdirSync(project); writeFileSync(join(project, "om.md"), "synthetic OM");
    bindInstanceRoots(project, data, "synthetic-org", "sample-app");
    assert.equal(JSON.parse(readFileSync(join(data, "instance-binding.json"), "utf8")).appId, "sample-app");
    assert.throws(() => bindInstanceRoots(project, data, "another-org", "sample-app"), /InstanceBindingMismatch/);
    assert.throws(() => bindInstanceRoots(project, data, "synthetic-org", "another-app"), /InstanceBindingMismatch/);
    assert.throws(() => bindInstanceRoots(join(root, "other"), data, "synthetic-org", "sample-app"), /InstanceBindingMismatch/);
    assert.equal(readFileSync(join(project, "om.md"), "utf8"), "synthetic OM");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("binding rejects old data, symlink and overlapping roots without rewriting old content", () => {
  const root = mkdtempSync(join(tmpdir(), "forge-binding-denied-"));
  try {
    const project = join(root, "old-project"), data = join(root, "old-data");
    mkdirSync(project); mkdirSync(data);
    writeFileSync(join(data, "legacy.sqlite"), "synthetic old data");
    assert.throws(() => bindInstanceRoots(project, data, "synthetic-org", "sample-app"), /ExistingUnboundRootDenied/);
    assert.equal(readFileSync(join(data, "legacy.sqlite"), "utf8"), "synthetic old data");
    symlinkSync(project, join(root, "linked"));
    assert.throws(() => bindInstanceRoots(join(root, "linked"), join(root, "fresh"), "synthetic-org", "sample-app"), /InstanceRootSymlinkDenied/);
    assert.throws(() => bindInstanceRoots(project, join(project, "nested"), "synthetic-org", "sample-app"), /InstanceRootsMustBeSeparate/);
    assert.throws(() => bindInstanceRoots(project, join(root, "fresh"), "", "sample-app"), /OrganizationIdRequired/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
