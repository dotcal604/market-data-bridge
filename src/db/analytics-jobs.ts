/**
 * Analytics jobs domain module.
 */

import { getStmts } from "./connection.js";
const stmts = getStmts();

// ── Types ────────────────────────────────────────────────────────────────

export interface AnalyticsJobRow {
  id: number;
  script: string;
  trigger_type: string;
  status: string;
  exit_code: number | null;
  stdout: string | null;
  stderr: string | null;
  duration_ms: number | null;
  created_at: string;
  completed_at: string | null;
}

// ── Functions ────────────────────────────────────────────────────────────

export function insertAnalyticsJob(script: string, triggerType: string = "manual"): number {
  const result = stmts.insertAnalyticsJob.run({
    script,
    trigger_type: triggerType,
    status: "running",
  });
  return result.lastInsertRowid as number;
}

export function updateAnalyticsJob(
  id: number,
  update: {
    status: string;
    exitCode?: number | null;
    stdout?: string | null;
    stderr?: string | null;
    durationMs?: number | null;
  }
): void {
  stmts.updateAnalyticsJob.run({
    id,
    status: update.status,
    exit_code: update.exitCode ?? null,
    stdout: update.stdout ?? null,
    stderr: update.stderr ?? null,
    duration_ms: update.durationMs ?? null,
  });
}

export function queryAnalyticsJobs(limit: number = 50): AnalyticsJobRow[] {
  return stmts.queryAnalyticsJobs.all(limit) as AnalyticsJobRow[];
}

export function getAnalyticsJobById(id: number): AnalyticsJobRow | undefined {
  return stmts.getAnalyticsJobById.get(id) as AnalyticsJobRow | undefined;
}
