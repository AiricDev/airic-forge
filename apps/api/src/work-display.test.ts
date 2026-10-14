import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { ForgeRuntime } from "./runtime.js";
import { ForgeDatabase } from "./database.js";

test("Work remembers authorized entity titles, refreshes renamed objects and keeps names when context omits them", async () => {
  const root = mkdtempSync(join(tmpdir(), "forge-work-title-"));
  const runtime = new ForgeRuntime({ port: 0, projectDir: join(root, "project"), dataDir: join(root, "data"), seedProjectDir: resolve("../../seed/certlab"), webDistDir: join(root, "web"), certLabUrl: "http://127.0.0.1:1", organizationId: "synthetic-org", allowedOrigin: "http://localhost", initialAdminEmails: new Set() });
  let title: string | undefined = "Equipment safety report";
  let resourceId = "report-uuid";
  runtime.app.identity = async () => ({ appId: "certlab", organizationId: "synthetic-org", appUserId: "author", email: "title-owner@example.invalid", displayName: "Author" });
  runtime.app.reportContext = async () => ({ resource: { namespace: "certlab", resourceType: "report", resourceId }, entityTitle: title });
  try {
    const first = await runtime.useCases.bootstrap({ token: "fixture", reportId: resourceId, goal: "Inspect report" });
    assert.equal(first.work.entityTitle, title);
    assert.equal((await runtime.useCases.workHistory(first.user.id, first.work.id)).work.entityTitle, title);
    title = "Renamed safety report";
    const next = await runtime.useCases.bootstrap({ token: "fixture", reportId: resourceId, workId: first.work.id });
    assert.equal(next.work.id, first.work.id);
    assert.equal(runtime.db.work(first.work.id)?.entityTitle, title);
    assert.equal((await runtime.useCases.worksForUser(first.user.id, first.user.id)).works[0]?.entityTitle, title);
    title = undefined;
    await runtime.useCases.bootstrap({ token: "fixture", reportId: resourceId, workId: first.work.id });
    assert.equal(runtime.db.work(first.work.id)?.entityTitle, "Renamed safety report");
    title = "Must not leak from a mismatched resource";
    resourceId = "other-report";
    await assert.rejects(() => runtime.useCases.bootstrap({ token: "fixture", reportId: "report-uuid" }), /InvalidReportContext/);
    assert.equal(runtime.db.work(first.work.id)?.entityTitle, "Renamed safety report");
    const stranger = runtime.db.ensureUser("title-stranger@example.invalid", false);
    await assert.rejects(() => runtime.useCases.workHistory(stranger.id, first.work.id), /Forbidden/);
  } finally { runtime.db.close(); rmSync(root, { recursive: true, force: true }); }
});

test("older Work databases gain optional names without losing records and names persist across restart", () => {
  const root = mkdtempSync(join(tmpdir(), "forge-work-title-migration-"));
  let db = new ForgeDatabase(root);
  try {
    const owner = db.ensureUser("migration@example.invalid", false);
    const work = db.createWork(owner.id, "certreporter", "report-authoring", "original-id");
    db.close();
    const legacy = new DatabaseSync(join(root, "forge.sqlite"));
    legacy.exec("ALTER TABLE works DROP COLUMN entity_title");
    legacy.close();
    db = new ForgeDatabase(root);
    assert.equal(db.work(work.id)?.entityId, "original-id");
    assert.equal(db.work(work.id)?.entityTitle, undefined);
    db.setWorkEntityTitle(work.id, "Readable report");
    db.close();
    db = new ForgeDatabase(root);
    assert.equal(db.work(work.id)?.entityTitle, "Readable report");
  } finally { db.close(); rmSync(root, { recursive: true, force: true }); }
});
