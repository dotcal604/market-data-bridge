#!/usr/bin/env node
/**
 * db-backup.mjs — Safe SQLite backup using .backup command
 *
 * Creates timestamped copies of production databases.
 * Uses SQLite's built-in .backup (crash-safe, WAL-aware).
 * Does NOT modify the source database.
 *
 * Usage:
 *   node scripts/db-backup.mjs                  # backup all DBs
 *   node scripts/db-backup.mjs --prune 7        # also delete backups older than 7 days
 */

import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = resolve(fileURLToPath(import.meta.url), "..");
const ROOT = resolve(__dirname, "..");
const BACKUP_DIR = join(ROOT, "data", "backups");
const PRUNE_ARG = process.argv.indexOf("--prune");
const PRUNE_DAYS = PRUNE_ARG >= 0 ? Number(process.argv[PRUNE_ARG + 1]) || 7 : null;

const DBS = [
  { name: "bridge", path: join(ROOT, "data", "bridge.db") },
  { name: "bridge-paper", path: join(ROOT, "data", "bridge-paper.db") },
  { name: "events", path: join(ROOT, "data", "events.db") },
];

const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);

// Ensure backup dir exists
if (!existsSync(BACKUP_DIR)) {
  mkdirSync(BACKUP_DIR, { recursive: true });
}

console.log(`Backup started: ${ts}`);
console.log(`Backup dir: ${BACKUP_DIR}\n`);

let backed = 0;

for (const db of DBS) {
  if (!existsSync(db.path)) {
    console.log(`  SKIP  ${db.name}: not found`);
    continue;
  }

  const dest = join(BACKUP_DIR, `${db.name}_${ts}.db`);

  try {
    // Use sqlite3 .backup — crash-safe, respects WAL
    execSync(`sqlite3 "${db.path}" ".backup '${dest}'"`, { timeout: 30_000 });
    const sizeMB = (statSync(dest).size / 1024 / 1024).toFixed(1);
    console.log(`  OK    ${db.name} → ${dest} (${sizeMB} MB)`);
    backed++;
  } catch (err) {
    // Fallback: simple file copy (still safe for SQLite in WAL mode if DB isn't mid-write)
    try {
      execSync(`copy "${db.path}" "${dest}"`, { timeout: 10_000 });
      console.log(`  COPY  ${db.name} → ${dest} (fallback — sqlite3 not available)`);
      backed++;
    } catch {
      console.log(`  FAIL  ${db.name}: ${err.message}`);
    }
  }
}

console.log(`\n${backed} database(s) backed up.`);

// Prune old backups
if (PRUNE_DAYS !== null) {
  console.log(`\nPruning backups older than ${PRUNE_DAYS} days...`);
  const cutoff = Date.now() - PRUNE_DAYS * 24 * 60 * 60 * 1000;
  let pruned = 0;

  for (const f of readdirSync(BACKUP_DIR)) {
    const full = join(BACKUP_DIR, f);
    if (f.endsWith(".db") && statSync(full).mtime.getTime() < cutoff) {
      unlinkSync(full);
      console.log(`  DEL   ${f}`);
      pruned++;
    }
  }

  console.log(`${pruned} old backup(s) removed.`);
}
