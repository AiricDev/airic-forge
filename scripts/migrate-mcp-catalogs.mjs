/** Explicit additive schema migration. Legacy snapshots and acceptance remain untouched. */
import { DatabaseSync } from "node:sqlite";
import { isAbsolute, join } from "node:path";
import { ForgeDatabase } from "../apps/api/dist/database.js";

const args = process.argv.slice(2);
const index = args.indexOf("--data-dir");
const dataDir = index >= 0 ? args[index + 1] : undefined;
if (!dataDir || !isAbsolute(dataDir) || args.some((arg, i) => !["--data-dir", "--apply"].includes(arg) && i !== index + 1)) {
  throw new Error("Usage: node scripts/migrate-mcp-catalogs.mjs --data-dir /absolute/data [--apply]");
}
const inspection = new DatabaseSync(join(dataDir, "forge.sqlite"), { readOnly: true });
const tables = inspection.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row => row.name);
inspection.close();
if (!args.includes("--apply")) {
  console.log(JSON.stringify({ needsMigration: tables.includes("catalog_candidates") && !tables.includes("mcp_catalog_candidates"), preservesLegacyCatalogs: true, requiresNewAcceptance: true }));
} else {
  const database = new ForgeDatabase(dataDir, { migrateMcpCatalogs: true });
  database.close();
  console.log("MCP catalog tables ready. Import and accept the MCP catalog explicitly.");
}
