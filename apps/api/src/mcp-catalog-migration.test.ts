import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { ForgeDatabase } from "./database.js";
import { testCatalog } from "./certlab-test-catalog.js";

test("legacy catalogs require an explicit additive migration and fresh acceptance", () => {
  const root = mkdtempSync(join(tmpdir(), "forge-mcp-migration-"));
  try {
    const original = new ForgeDatabase(root);
    const admin = original.ensureUser("migration@example.invalid", true);
    original.close();
    const legacy = new DatabaseSync(join(root, "forge.sqlite"));
    legacy.exec("DROP TABLE mcp_accepted_catalogs; DROP TABLE mcp_catalog_candidates; CREATE TABLE catalog_candidates (app_id TEXT, digest TEXT, catalog_json TEXT, openapi_json TEXT); CREATE TABLE accepted_catalogs (app_id TEXT, digest TEXT);");
    const catalog = testCatalog("original");
    legacy.prepare("INSERT INTO catalog_candidates VALUES (?, ?, ?, ?)").run("certlab", catalog.digest, JSON.stringify(catalog), "{}");
    legacy.prepare("INSERT INTO accepted_catalogs VALUES (?, ?)").run("certlab", catalog.digest);
    legacy.close();
    assert.throws(() => new ForgeDatabase(root), /McpCatalogMigrationRequired/);
    for (let i = 0; i < 2; i++) {
      const migrated = new ForgeDatabase(root, { migrateMcpCatalogs: true });
      assert.equal(migrated.accepted("certlab"), undefined);
      assert.equal(migrated.userById(admin.id)?.email, admin.email);
      migrated.close();
    }
    const preserved = new DatabaseSync(join(root, "forge.sqlite"));
    assert.equal(preserved.prepare("SELECT catalog_json FROM catalog_candidates").get()?.catalog_json, JSON.stringify(catalog));
    assert.equal(preserved.prepare("SELECT digest FROM accepted_catalogs").get()?.digest, "original");
    preserved.close();
    const current = new ForgeDatabase(root);
    current.saveCandidate({ ...catalog, source: "mcp", digest: "new-mcp" });
    current.accept("certlab", "new-mcp", admin.id);
    assert.equal(current.accepted("certlab")?.digest, "new-mcp");
    current.close();
  } finally { rmSync(root, { recursive: true, force: true }); }
});
