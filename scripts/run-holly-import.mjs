#!/usr/bin/env node
/**
 * One-shot script: Import Holly CSV and run exit autopsy.
 * Usage: node scripts/run-holly-import.mjs <csv-path>
 */

import { importHollyTradesFromFile, getHollyTradeStats } from "../build/holly/trade-importer.js";
import { runExitAutopsy } from "../build/holly/exit-autopsy.js";

const csvPath = process.argv[2] || "D:\\Downloads\\Trading\\Holly AI\\Trade Ideas Holly AI trades.csv";

console.log("=== Holly Trade Import ===");
console.log(`File: ${csvPath}`);
console.log();

const result = importHollyTradesFromFile(csvPath);
console.log(`Import result: ${JSON.stringify(result, null, 2)}`);
console.log();

console.log("=== Holly Trade Stats ===");
const stats = getHollyTradeStats();
console.log(JSON.stringify(stats, null, 2));
console.log();

console.log("=== Running Exit Autopsy ===");
const report = runExitAutopsy();
console.log();

console.log("--- Overview ---");
console.log(JSON.stringify(report.overview, null, 2));
console.log();

console.log("--- Strategy Leaderboard (top 10 by total profit) ---");
for (const s of report.strategy_leaderboard.slice(0, 10)) {
  console.log(`  ${s.strategy.padEnd(35)} trades=${String(s.total_trades).padStart(4)} WR=${(s.win_rate * 100).toFixed(1).padStart(5)}% PF=${String(s.profit_factor).padStart(6)} Sharpe=${String(s.sharpe).padStart(6)} totalP&L=$${s.total_profit.toFixed(0).padStart(8)} avgGiveback=${(s.avg_giveback_ratio * 100).toFixed(1)}% archetype`);
}
console.log();

console.log("--- Exit Policy Recommendations ---");
for (const r of report.exit_policy_recs.slice(0, 10)) {
  console.log(`  [${r.archetype.padEnd(13)}] ${r.strategy}: ${r.recommendation}`);
}
console.log();

console.log("--- Time of Day ---");
for (const t of report.time_of_day) {
  const bar = "#".repeat(Math.max(0, Math.round(t.avg_profit / 5)));
  console.log(`  ${t.label}  trades=${String(t.total_trades).padStart(5)} WR=${(t.win_rate * 100).toFixed(1).padStart(5)}% avg=$${t.avg_profit.toFixed(2).padStart(8)} ${bar}`);
}
console.log();

console.log("--- Segment Comparison ---");
for (const s of report.segment_comparison) {
  console.log(`  ${(s.segment || "Unknown").padEnd(20)} trades=${String(s.total_trades).padStart(5)} WR=${(s.win_rate * 100).toFixed(1).padStart(5)}% total=$${s.total_profit.toFixed(0).padStart(8)} avgGiveback=${(s.avg_giveback_ratio * 100).toFixed(1)}%`);
}
console.log();

console.log("--- MFE/MAE Profiles (top 10 by giveback ratio) ---");
for (const m of report.mfe_mae_profiles.slice(0, 10)) {
  console.log(`  ${m.strategy.padEnd(30)} seg=${(m.segment || "-").padEnd(12)} MFE=$${m.avg_mfe.toFixed(0).padStart(6)} MAE=$${m.avg_mae.toFixed(0).padStart(7)} giveback=${(m.avg_giveback_ratio * 100).toFixed(1)}% peakIn30m=${(m.pct_peak_in_30min * 100).toFixed(0)}%`);
}

console.log("\n=== Done ===");
process.exit(0);
