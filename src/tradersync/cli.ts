#!/usr/bin/env npx tsx
/**
 * CLI: Import TraderSync CSV into the database.
 *
 * Usage:
 *   npx tsx src/tradersync/cli.ts path/to/trade_data.csv
 */

import fs from "fs";
import path from "path";
import { importTraderSyncCSV } from "./importer.js";

const csvPath = process.argv[2];
if (!csvPath) {
  console.error("Usage: npx tsx src/tradersync/cli.ts <path-to-trade_data.csv>");
  process.exit(1);
}

const resolved = path.resolve(csvPath);
if (!fs.existsSync(resolved)) {
  console.error(`File not found: ${resolved}`);
  process.exit(1);
}

console.log(`Importing TraderSync data from: ${resolved}`);
const csv = fs.readFileSync(resolved, "utf-8");
const result = importTraderSyncCSV(csv);

console.log(`\nImport complete (batch: ${result.batch_id})`);
console.log(`  Parsed:   ${result.total_parsed} rows`);
console.log(`  Inserted: ${result.inserted}`);
console.log(`  Skipped:  ${result.skipped} (duplicates)`);
if (result.errors.length > 0) {
  console.log(`  Errors:   ${result.errors.length}`);
  for (const err of result.errors.slice(0, 10)) {
    console.log(`    - ${err}`);
  }
  if (result.errors.length > 10) {
    console.log(`    ... and ${result.errors.length - 10} more`);
  }
}
