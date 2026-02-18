#!/usr/bin/env node
/**
 * ops-check.mjs — Read-only production health audit
 *
 * Checks everything, changes nothing. Safe to run while live trading.
 *
 * Usage:
 *   node scripts/ops-check.mjs            # full audit
 *   node scripts/ops-check.mjs --json     # machine-readable output
 */

import { execSync } from "node:child_process";
import { statSync, existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = resolve(fileURLToPath(import.meta.url), "..");
const ROOT = resolve(__dirname, "..");
const jsonMode = process.argv.includes("--json");

const results = { pass: [], warn: [], fail: [], info: [] };

function pass(msg) { results.pass.push(msg); }
function warn(msg) { results.warn.push(msg); }
function fail(msg) { results.fail.push(msg); }
function info(msg) { results.info.push(msg); }

function fileSize(path) {
  try { return statSync(path).size; } catch { return -1; }
}

function fileSizeMB(path) {
  const s = fileSize(path);
  return s >= 0 ? (s / 1024 / 1024).toFixed(1) : "N/A";
}

function shell(cmd) {
  try { return execSync(cmd, { encoding: "utf-8", timeout: 10_000, stdio: ["pipe", "pipe", "pipe"] }).trim(); } catch { return null; }
}

// ── 1. Process health ──────────────────────────────────────────────

info("=== Process Health ===");

const pm2List = shell("pm2 jlist");
if (pm2List) {
  try {
    const procs = JSON.parse(pm2List);
    for (const p of procs) {
      const name = p.name;
      const status = p.pm2_env?.status;
      const restarts = p.pm2_env?.restart_time ?? 0;
      const uptime = p.pm2_env?.pm_uptime ? Math.floor((Date.now() - p.pm2_env.pm_uptime) / 1000) : 0;
      const mem = p.monit?.memory ? (p.monit.memory / 1024 / 1024).toFixed(0) : "?";

      if (status === "online") {
        pass(`${name}: online, uptime ${Math.floor(uptime / 60)}m, ${mem}MB RAM, ${restarts} restarts`);
      } else {
        fail(`${name}: ${status} (${restarts} restarts)`);
      }

      if (restarts > 10) {
        warn(`${name}: ${restarts} restarts — possible crash loop`);
      }
      if (Number(mem) > 400) {
        warn(`${name}: ${mem}MB RAM — approaching 512MB limit`);
      }
    }
  } catch {
    warn("pm2 output unparseable");
  }
} else {
  warn("pm2 not running or not installed");
}

// ── 2. Bridge health endpoint ──────────────────────────────────────

info("=== Bridge Health ===");

async function fetchHealth(url, label) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5_000) });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

const health = await fetchHealth("http://localhost:3000/health", "live");
if (health) {
  if (health.ibkr_connected) {
    pass("IBKR connected");
  } else {
    fail("IBKR disconnected");
  }
  info(`Bridge uptime: ${health.uptime_seconds ? Math.floor(health.uptime_seconds / 60) + "m" : "unknown"}`);
} else {
  fail("Bridge health endpoint unreachable (localhost:3000/health)");
}

// Paper instance (port 3001)
const healthPaper = await fetchHealth("http://localhost:3001/health", "paper");
if (healthPaper) {
  info("Paper instance (port 3001): running");
} else {
  info("Paper instance (port 3001): not running");
}

// ── 3. Database health ─────────────────────────────────────────────

info("=== Database Health ===");

const DB_FILES = [
  "data/bridge.db",
  "data/bridge-paper.db",
  "data/events.db",
];

for (const dbRel of DB_FILES) {
  const dbPath = join(ROOT, dbRel);
  if (!existsSync(dbPath)) {
    info(`${dbRel}: not found (OK if not used)`);
    continue;
  }

  const sizeMB = fileSizeMB(dbPath);
  info(`${dbRel}: ${sizeMB} MB`);

  if (Number(sizeMB) > 500) {
    warn(`${dbRel}: ${sizeMB} MB — consider VACUUM`);
  }

  // WAL file size
  const walPath = dbPath + "-wal";
  if (existsSync(walPath)) {
    const walMB = fileSizeMB(walPath);
    if (Number(walMB) > 50) {
      warn(`${dbRel}-wal: ${walMB} MB — WAL bloat, checkpoint may be stuck`);
    }
  }

  // Integrity check (read-only)
  const integrity = shell(`sqlite3 "${dbPath}" "PRAGMA integrity_check" 2>/dev/null`);
  if (integrity === "ok") {
    pass(`${dbRel}: integrity OK`);
  } else if (integrity) {
    fail(`${dbRel}: integrity issue — ${integrity.slice(0, 200)}`);
  } else {
    info(`${dbRel}: sqlite3 not available for integrity check`);
  }
}

// ── 4. Log file sizes ──────────────────────────────────────────────

info("=== Log Files ===");

const LOG_DIR = join(ROOT, "logs");
if (existsSync(LOG_DIR)) {
  const logFiles = readdirSync(LOG_DIR).filter(f => f.endsWith(".log"));
  for (const f of logFiles) {
    const mb = fileSizeMB(join(LOG_DIR, f));
    if (Number(mb) > 100) {
      fail(`logs/${f}: ${mb} MB — needs rotation NOW`);
    } else if (Number(mb) > 50) {
      warn(`logs/${f}: ${mb} MB — getting large`);
    } else {
      pass(`logs/${f}: ${mb} MB`);
    }
  }

  if (logFiles.length === 0) {
    info("No log files found in logs/");
  }
} else {
  info("logs/ directory not found");
}

// ── 5. .env drift detection ────────────────────────────────────────

info("=== Config Drift ===");

const examplePath = join(ROOT, ".env.example");
const envPath = join(ROOT, ".env");

if (existsSync(examplePath) && existsSync(envPath)) {
  const exampleKeys = readFileSync(examplePath, "utf-8")
    .split("\n")
    .filter(l => /^[A-Z]/.test(l) && l.includes("="))
    .map(l => l.split("=")[0].trim());

  const envKeys = readFileSync(envPath, "utf-8")
    .split("\n")
    .filter(l => /^[A-Z]/.test(l) && l.includes("="))
    .map(l => l.split("=")[0].trim());

  const missing = exampleKeys.filter(k => !envKeys.includes(k) && !k.startsWith("#"));
  const extra = envKeys.filter(k => !exampleKeys.includes(k));

  if (missing.length === 0) {
    pass(".env has all required keys from .env.example");
  } else {
    // Filter out optional/commented keys
    const requiredMissing = missing.filter(k =>
      !["TUNNEL_URL", "CLAUDE_MODEL", "OPENAI_MODEL", "GEMINI_MODEL",
        "MODEL_TEMPERATURE", "MODEL_TIMEOUT_MS", "GEMINI_TIMEOUT_MS",
        "ORCHESTRATOR_WEIGHT_CLAUDE", "ORCHESTRATOR_WEIGHT_GPT", "ORCHESTRATOR_WEIGHT_GEMINI",
        "HOLLY_WATCH_PATH", "HOLLY_POLL_INTERVAL_MS",
        "DIVOOM_DEVICE_IP", "DIVOOM_REFRESH_MS", "DIVOOM_BRIGHTNESS",
        "DRIFT_ALERTS_ENABLED", "AUTO_EVAL_ENABLED", "AUTO_EVAL_MAX_CONCURRENT",
      ].includes(k)
    );
    if (requiredMissing.length > 0) {
      warn(`.env missing keys: ${requiredMissing.join(", ")}`);
    } else {
      pass(".env has all required keys (optional keys omitted — OK)");
    }
  }

  if (extra.length > 0) {
    info(`.env has extra keys not in .env.example: ${extra.join(", ")}`);
  }
} else {
  warn(".env or .env.example not found — can't check drift");
}

// ── 6. Tunnel health ───────────────────────────────────────────────

info("=== Tunnel Health ===");

const tunnelHealth = await fetchHealth("https://api.klfh-dot-io.com/health", "tunnel");
if (tunnelHealth) {
  pass("Cloudflare tunnel reachable externally");
} else {
  warn("Cloudflare tunnel unreachable (may be expected if not configured)");
}

// ── 7. Disk space ──────────────────────────────────────────────────

info("=== Disk Space ===");

const diskInfo = shell('powershell -NoProfile -Command "Get-PSDrive C | Select-Object Used,Free | Format-List"') ||
                 shell('df -h . 2>/dev/null');
if (diskInfo) {
  info(diskInfo.split("\n").slice(0, 5).join(" | "));
} else {
  info("Disk space check unavailable");
}

// ── 8. Git status ──────────────────────────────────────────────────

info("=== Git Status ===");

const branch = shell(`git -C "${ROOT}" branch --show-current`);
const behind = shell(`git -C "${ROOT}" rev-list --count HEAD..origin/main 2>/dev/null`);
const dirty = shell(`git -C "${ROOT}" status --porcelain 2>/dev/null`);

if (branch) {
  info(`Branch: ${branch}`);
}
if (behind && Number(behind) > 0) {
  warn(`${behind} commits behind origin/main — deploy needed`);
} else if (behind === "0") {
  pass("Up to date with origin/main");
}
if (dirty && dirty.length > 0) {
  const lines = dirty.split("\n").filter(Boolean).length;
  warn(`${lines} uncommitted changes in working tree`);
}

// ── 9. Build freshness ─────────────────────────────────────────────

info("=== Build Status ===");

const buildIndex = join(ROOT, "build", "index.js");
if (existsSync(buildIndex)) {
  const buildTime = statSync(buildIndex).mtime;
  const srcFiles = shell(`git -C "${ROOT}" log -1 --format=%ct -- src/`);
  if (srcFiles) {
    const lastSrcChange = new Date(Number(srcFiles) * 1000);
    if (buildTime < lastSrcChange) {
      warn(`Build is stale — build/${buildTime.toISOString()} < src/${lastSrcChange.toISOString()}`);
    } else {
      pass("Build is fresh (newer than last src/ commit)");
    }
  }
  info(`Build age: ${Math.floor((Date.now() - buildTime.getTime()) / 3600000)}h`);
} else {
  fail("build/index.js not found — no build exists");
}

// ── Output ─────────────────────────────────────────────────────────

if (jsonMode) {
  console.log(JSON.stringify(results, null, 2));
} else {
  console.log("");
  console.log("╔══════════════════════════════════════════════╗");
  console.log("║        OPS HEALTH CHECK — READ ONLY         ║");
  console.log("║  " + new Date().toISOString().slice(0, 19) + "                     ║");
  console.log("╚══════════════════════════════════════════════╝");
  console.log("");

  for (const i of results.info) {
    if (i.startsWith("===")) {
      console.log(`\n  ${i}`);
    } else {
      console.log(`     ${i}`);
    }
  }

  console.log("\n  ─── Results ───────────────────────────────\n");

  for (const p of results.pass) console.log(`  [PASS] ${p}`);
  for (const w of results.warn) console.log(`  [WARN] ${w}`);
  for (const f of results.fail) console.log(`  [FAIL] ${f}`);

  const total = results.pass.length + results.warn.length + results.fail.length;
  console.log(`\n  ${results.pass.length}/${total} pass, ${results.warn.length} warn, ${results.fail.length} fail`);

  if (results.fail.length > 0) {
    console.log("\n  *** ACTION REQUIRED — see FAIL items above ***\n");
    process.exit(1);
  } else if (results.warn.length > 0) {
    console.log("\n  Warnings present — review when convenient.\n");
  } else {
    console.log("\n  All clear.\n");
  }
}
