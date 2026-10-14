import assert from "node:assert/strict";
import test from "node:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bindCertLabRoots } from "./instance-binding.js";

test("new roots bind one App and organization and reject a changed binding on restart", () => {
  const root = mkdtempSync(join(tmpdir(), "certlab-binding-"));
  try {
    const project = join(root, "project"), data = join(root, "data");
    bindCertLabRoots(project, data, "synthetic-org");
    mkdirSync(project); writeFileSync(join(project, "om.md"), "synthetic OM");
    bindCertLabRoots(project, data, "synthetic-org");
    assert.equal(JSON.parse(readFileSync(join(data, "instance-binding.json"), "utf8")).appId, "certlab");
    assert.throws(() => bindCertLabRoots(project, data, "another-org"), /InstanceBindingMismatch/);
    assert.throws(() => bindCertLabRoots(join(root, "other"), data, "synthetic-org"), /InstanceBindingMismatch/);
    assert.equal(readFileSync(join(project, "om.md"), "utf8"), "synthetic OM");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("binding rejects old data, symlink and overlapping roots without rewriting old content", () => {
  const root = mkdtempSync(join(tmpdir(), "certlab-binding-denied-"));
  try {
    const project = join(root, "old-project"), data = join(root, "old-data");
    mkdirSync(project); mkdirSync(data);
    writeFileSync(join(data, "legacy.sqlite"), "synthetic old data");
    assert.throws(() => bindCertLabRoots(project, data, "synthetic-org"), /ExistingUnboundRootDenied/);
    assert.equal(readFileSync(join(data, "legacy.sqlite"), "utf8"), "synthetic old data");
    symlinkSync(project, join(root, "linked"));
    assert.throws(() => bindCertLabRoots(join(root, "linked"), join(root, "fresh"), "synthetic-org"), /InstanceRootSymlinkDenied/);
    assert.throws(() => bindCertLabRoots(project, join(project, "nested"), "synthetic-org"), /InstanceRootsMustBeSeparate/);
    assert.throws(() => bindCertLabRoots(project, join(root, "fresh"), ""), /OrganizationIdRequired/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
