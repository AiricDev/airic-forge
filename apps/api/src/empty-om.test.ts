import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { GitOperatingModel } from "./git-om.js";
import { loadConfig } from "./config.js";

test("startup ignores the old seed environment setting", () => {
  assert.equal(loadConfig({ FORGE_SEED_PROJECT_DIR: "/missing/seed" }).seedProjectDir, undefined);
});

test("missing OM initializes an empty main and supports personal branches without a seed", () => {
  const root = mkdtempSync(join(tmpdir(), "forge-empty-om-"));
  try {
    const project = join(root, "project");
    const om = new GitOperatingModel(project, join(root, "data"));
    om.initialize();
    const head = om.head("main");
    assert.deepEqual(om.listFiles(head), []);
    assert.deepEqual(om.knowledgeIssues(head), []);
    assert.equal(om.head(om.ensureUserBranch("synthetic-user").branch), head);
    om.initialize();
    assert.equal(om.head("main"), head);
    // An existing OM must not depend on an obsolete fixture source either.
    new GitOperatingModel(project, join(root, "data"), join(root, "missing-source")).initialize();
    assert.equal(om.head("main"), head);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("an already initialized unborn repository gets an empty commit without staging unrelated files", () => {
  const root = mkdtempSync(join(tmpdir(), "forge-unborn-om-"));
  try {
    execFileSync("git", ["init", "--initial-branch=main", root]);
    writeFileSync(join(root, "unrelated.txt"), "preserve existing user content");
    const om = new GitOperatingModel(root, join(root, "data"));
    om.initialize();
    assert.equal(execFileSync("git", ["-C", root, "ls-tree", "-r", "--name-only", "main"], { encoding: "utf8" }), "");
    assert.equal(readFileSync(join(root, "unrelated.txt"), "utf8"), "preserve existing user content");
  } finally { rmSync(root, { recursive: true, force: true }); }
});
