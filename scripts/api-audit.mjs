#!/usr/bin/env node
/**
 * API Dependency Audit Script
 *
 * Checks all external API dependencies for:
 * 1. npm package updates (npm outdated)
 * 2. AI model deprecation status (Anthropic, OpenAI, Google)
 * 3. Known deprecation deadlines
 *
 * Run manually:   node scripts/api-audit.mjs
 * Run in CI:      .github/workflows/api-audit.yml (weekly)
 *
 * Exit codes:
 *   0 = all clear
 *   1 = warnings (updates available, approaching deadlines)
 *   2 = critical (past deadline, model deprecated)
 */

import { execSync } from "child_process";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

// ─── Configuration ──────────────────────────────────────────────

const EVAL_CONFIG_PATH = join(ROOT, "src", "eval", "config.ts");

// Known deprecation deadlines (update these when providers announce changes)
const DEPRECATION_CALENDAR = [
  {
    id: "gpt-4o-chatgpt",
    description: "GPT-4o removed from ChatGPT (replaced by GPT-5 series)",
    deadline: "2026-02-13",
    severity: "info", // doesn't affect API usage
    action: "No code change needed — only affects ChatGPT UI, not API",
  },
  {
    id: "chatgpt-4o-latest-api",
    description: "chatgpt-4o-latest API alias deprecated",
    deadline: "2026-02-17",
    severity: "info", // we don't use this alias
    action: "No action — we use 'gpt-4o' not 'chatgpt-4o-latest'",
  },
  {
    id: "gemini-2.0-flash-shutdown",
    description: "gemini-2.0-flash model shutdown by Google",
    deadline: "2026-03-31",
    severity: "critical",
    action: "Migrate GEMINI_MODEL to 'gemini-2.5-flash' or 'gemini-2.5-pro'",
  },
  {
    id: "google-genai-sdk-legacy",
    description: "@google/generative-ai SDK deprecated (migrate to @google/genai)",
    deadline: "2026-06-24",
    severity: "warning",
    action: "Replace @google/generative-ai with unified @google/genai SDK",
  },
  {
    id: "yahoo-finance2-v3",
    description: "yahoo-finance2 v3 breaking changes (ESM-only, new class API)",
    deadline: "2026-06-30", // estimated — no firm date yet
    severity: "warning",
    action: "Pin to v2.x until ready; v3 changes instantiation pattern",
  },
  {
    id: "stoqey-ib-10.42",
    description: "@stoqey/ib support for TWS API 10.42 features (one-message brackets)",
    deadline: "2026-12-31", // no firm date — watch releases
    severity: "info",
    action: "Monitor github.com/stoqey/ib for releases. Enables atomic bracket orders.",
  },
];

// Critical packages to track
const TRACKED_PACKAGES = [
  "@anthropic-ai/sdk",
  "openai",
  "@google/generative-ai",
  "@stoqey/ib",
  "yahoo-finance2",
  "@modelcontextprotocol/sdk",
];

// ─── Helpers ────────────────────────────────────────────────────

function log(level, msg) {
  const prefix = { info: "ℹ️", warning: "⚠️", critical: "🚨", ok: "✅" }[level] || "•";
  console.log(`${prefix} [${level.toUpperCase()}] ${msg}`);
}

function daysUntil(dateStr) {
  const deadline = new Date(dateStr);
  const now = new Date();
  return Math.ceil((deadline - now) / (1000 * 60 * 60 * 24));
}

// ─── Check 1: npm outdated ──────────────────────────────────────

function checkNpmOutdated() {
  log("info", "Checking npm package versions...");

  let outdated;
  try {
    // npm outdated exits 1 when packages are outdated
    execSync("npm outdated --json", { cwd: ROOT, encoding: "utf-8" });
    outdated = {};
  } catch (e) {
    try {
      outdated = JSON.parse(e.stdout || "{}");
    } catch {
      log("warning", "Could not parse npm outdated output");
      return [];
    }
  }

  const findings = [];
  for (const pkg of TRACKED_PACKAGES) {
    if (outdated[pkg]) {
      const { current, wanted, latest } = outdated[pkg];
      const isMajor = latest && current && latest.split(".")[0] !== current.split(".")[0];
      findings.push({
        severity: isMajor ? "warning" : "info",
        message: `${pkg}: ${current} → ${latest} (wanted: ${wanted})${isMajor ? " [MAJOR]" : ""}`,
      });
    }
  }

  if (findings.length === 0) {
    log("ok", "All tracked packages up to date");
  } else {
    for (const f of findings) log(f.severity, f.message);
  }

  return findings;
}

// ─── Check 2: Model names in eval config ────────────────────────

function checkModelConfig() {
  log("info", "Checking AI model configuration...");

  let configSource;
  try {
    configSource = readFileSync(EVAL_CONFIG_PATH, "utf-8");
  } catch {
    log("warning", `Could not read ${EVAL_CONFIG_PATH}`);
    return [];
  }

  const findings = [];

  // Extract model defaults
  const claudeMatch = configSource.match(/claudeModel:.*?"([^"]+)"/);
  const openaiMatch = configSource.match(/openaiModel:.*?"([^"]+)"/);
  const geminiMatch = configSource.match(/geminiModel:.*?"([^"]+)"/);

  if (claudeMatch) log("info", `Claude model: ${claudeMatch[1]}`);
  if (openaiMatch) log("info", `OpenAI model: ${openaiMatch[1]}`);
  if (geminiMatch) log("info", `Gemini model: ${geminiMatch[1]}`);

  // Check for known-deprecated model names
  const deprecatedModels = [
    { pattern: /claude-3-5-sonnet/, replacement: "claude-sonnet-4-20250514" },
    { pattern: /claude-3-7-sonnet/, replacement: "claude-sonnet-4-20250514" },
    { pattern: /gpt-4-turbo/, replacement: "gpt-4o" },
    { pattern: /gpt-3\.5/, replacement: "gpt-4o-mini" },
    { pattern: /gemini-1\.5/, replacement: "gemini-2.5-flash" },
    { pattern: /gemini-1\.0/, replacement: "gemini-2.5-flash" },
  ];

  for (const { pattern, replacement } of deprecatedModels) {
    if (pattern.test(configSource)) {
      findings.push({
        severity: "critical",
        message: `Deprecated model found in config: ${pattern} → migrate to ${replacement}`,
      });
    }
  }

  // Check gemini-2.0-flash specifically (approaching deadline)
  if (geminiMatch && geminiMatch[1] === "gemini-2.0-flash") {
    const days = daysUntil("2026-03-31");
    if (days <= 0) {
      findings.push({
        severity: "critical",
        message: `gemini-2.0-flash is PAST its shutdown date (March 31, 2026)! Migrate immediately.`,
      });
    } else if (days <= 30) {
      findings.push({
        severity: "critical",
        message: `gemini-2.0-flash shuts down in ${days} days (March 31, 2026). Migrate NOW.`,
      });
    } else if (days <= 90) {
      findings.push({
        severity: "warning",
        message: `gemini-2.0-flash shuts down in ${days} days (March 31, 2026). Plan migration.`,
      });
    }
  }

  if (findings.length === 0) {
    log("ok", "No deprecated model names detected");
  } else {
    for (const f of findings) log(f.severity, f.message);
  }

  return findings;
}

// ─── Check 3: Deprecation calendar ─────────────────────────────

function checkDeprecationCalendar() {
  log("info", "Checking deprecation calendar...");

  const findings = [];
  const now = new Date();

  for (const entry of DEPRECATION_CALENDAR) {
    const days = daysUntil(entry.deadline);

    if (days < 0) {
      findings.push({
        severity: entry.severity === "info" ? "info" : "critical",
        message: `PAST DEADLINE: ${entry.description} (was ${entry.deadline}). ${entry.action}`,
      });
    } else if (days <= 30 && entry.severity !== "info") {
      findings.push({
        severity: "critical",
        message: `${days}d remaining: ${entry.description} (${entry.deadline}). ${entry.action}`,
      });
    } else if (days <= 90 && entry.severity !== "info") {
      findings.push({
        severity: "warning",
        message: `${days}d remaining: ${entry.description} (${entry.deadline}). ${entry.action}`,
      });
    } else {
      findings.push({
        severity: "info",
        message: `${days}d remaining: ${entry.description} (${entry.deadline})`,
      });
    }
  }

  for (const f of findings) log(f.severity, f.message);
  return findings;
}

// ─── Main ───────────────────────────────────────────────────────

async function main() {
  console.log("═══════════════════════════════════════════════");
  console.log("  Market Data Bridge — API Dependency Audit");
  console.log(`  ${new Date().toISOString()}`);
  console.log("═══════════════════════════════════════════════\n");

  const allFindings = [];

  console.log("── npm Package Versions ──\n");
  allFindings.push(...checkNpmOutdated());

  console.log("\n── AI Model Configuration ──\n");
  allFindings.push(...checkModelConfig());

  console.log("\n── Deprecation Calendar ──\n");
  allFindings.push(...checkDeprecationCalendar());

  // Summary
  const critical = allFindings.filter((f) => f.severity === "critical").length;
  const warnings = allFindings.filter((f) => f.severity === "warning").length;

  console.log("\n═══════════════════════════════════════════════");
  console.log(`  Summary: ${critical} critical, ${warnings} warnings, ${allFindings.length} total`);
  console.log("═══════════════════════════════════════════════\n");

  // GitHub Actions output (for PR/issue creation)
  if (process.env.GITHUB_OUTPUT) {
    const { appendFileSync } = await import("fs");
    appendFileSync(process.env.GITHUB_OUTPUT, `critical_count=${critical}\n`);
    appendFileSync(process.env.GITHUB_OUTPUT, `warning_count=${warnings}\n`);
    appendFileSync(process.env.GITHUB_OUTPUT, `total_count=${allFindings.length}\n`);

    // Build markdown summary for issue body
    const lines = allFindings
      .filter((f) => f.severity === "critical" || f.severity === "warning")
      .map((f) => `- ${f.severity === "critical" ? "🚨" : "⚠️"} ${f.message}`);

    if (lines.length > 0) {
      const body = lines.join("\n");
      appendFileSync(process.env.GITHUB_OUTPUT, `findings<<EOF\n${body}\nEOF\n`);
    }
  }

  if (critical > 0) process.exit(2);
  if (warnings > 0) process.exit(1);
  process.exit(0);
}

main().catch((e) => {
  console.error("Audit failed:", e);
  process.exit(2);
});
