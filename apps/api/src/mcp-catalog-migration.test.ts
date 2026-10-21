import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { ForgeDatabase } from "./database.js";
import { testCatalog } from "./certlab-test-catalog.js";

test("discovered MCP snapshots need no acceptance and preserve historical approval rows", () => {
  const root = mkdtempSync(join(tmpdir(), "forge-mcp-snapshots-"));
  try {
    const original = new ForgeDatabase(root);original.close();
    const legacy = new DatabaseSync(join(root,"forge.sqlite"));
    legacy.exec("CREATE TABLE catalog_candidates(app_id TEXT,digest TEXT,catalog_json TEXT); CREATE TABLE accepted_catalogs(app_id TEXT,digest TEXT); CREATE TABLE mcp_accepted_catalogs(app_id TEXT,digest TEXT); INSERT INTO accepted_catalogs VALUES ('certlab','legacy-approval'); INSERT INTO mcp_accepted_catalogs VALUES ('certlab','previous-mcp-approval')");legacy.close();
    const current = new ForgeDatabase(root), tools = testCatalog("current-discovery");
    current.recordToolSnapshot(tools);current.recordToolSnapshot({...tools,discoveredAt:"later"});
    assert.equal(current.toolSnapshot("certlab",tools.digest)?.digest,tools.digest);
    assert.throws(()=>current.recordToolSnapshot({...tools,tools:[]}),/ToolSnapshotDigestCollision/);current.close();
    const check=new DatabaseSync(join(root,"forge.sqlite"));
    assert.equal(check.prepare("SELECT digest FROM accepted_catalogs").get()?.digest,"legacy-approval");
    assert.equal(check.prepare("SELECT digest FROM mcp_accepted_catalogs").get()?.digest,"previous-mcp-approval");
    assert.equal(check.prepare("SELECT COUNT(*) AS n FROM mcp_tool_snapshots").get()?.n,1);
    assert.throws(()=>check.exec("UPDATE mcp_tool_snapshots SET snapshot_json='{}'"),/ToolSnapshotImmutable/);
    assert.throws(()=>check.exec("DELETE FROM mcp_tool_snapshots"),/ToolSnapshotImmutable/);check.close();
  } finally {rmSync(root,{recursive:true,force:true});}
});
