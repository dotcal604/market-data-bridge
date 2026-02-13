import { db, upsertRiskConfig, type RiskConfigRow } from "../db/database.js";
import { RISK_CONFIG_DEFAULTS, type RiskConfigParam } from "../db/schema.js";
import { logger } from "../logging.js";

export interface RiskTuneResult {
  sampleSize: number;
  winRate: number;
  avgWinR: number;
  avgLossRAbs: number;
  halfKelly: number;
  suggestions: Array<{ param: RiskConfigParam; value: number }>;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function parseRFromJournalRow(row: { outcome_tags: string | null; notes: string | null }): number | null {
  const payload = `${row.outcome_tags ?? ""} ${row.notes ?? ""}`;
  const match = payload.match(/(-?\d+(?:\.\d+)?)\s*[rR]/);
  if (!match) return null;
  const parsed = Number.parseFloat(match[1]);
  return Number.isFinite(parsed) ? parsed : null;
}

function loadRecentRMultiples(limit: number = 100): number[] {
  const journalRows = db.prepare(`
    SELECT outcome_tags, notes
    FROM trade_journal
    WHERE outcome_tags IS NOT NULL OR notes IS NOT NULL
    ORDER BY updated_at DESC
    LIMIT ?
  `).all(limit * 3) as Array<{ outcome_tags: string | null; notes: string | null }>;

  const parsedFromJournal = journalRows
    .map((row) => parseRFromJournalRow(row))
    .filter((value): value is number => value !== null)
    .slice(0, limit);

  if (parsedFromJournal.length > 0) {
    return parsedFromJournal;
  }

  const fallback = db.prepare(`
    SELECT o.r_multiple
    FROM outcomes o
    WHERE o.trade_taken = 1 AND o.r_multiple IS NOT NULL
    ORDER BY o.recorded_at DESC
    LIMIT ?
  `).all(limit) as Array<{ r_multiple: number }>;

  return fallback
    .map((row) => row.r_multiple)
    .filter((value): value is number => Number.isFinite(value));
}

export function tuneRiskParams(): RiskTuneResult {
  const rMultiples = loadRecentRMultiples(100);
  const wins = rMultiples.filter((value) => value > 0);
  const losses = rMultiples.filter((value) => value <= 0);

  const winRate = rMultiples.length > 0 ? wins.length / rMultiples.length : 0;
  const avgWinR = wins.length > 0 ? wins.reduce((sum, value) => sum + value, 0) / wins.length : 0;
  const avgLossRAbs = losses.length > 0
    ? Math.abs(losses.reduce((sum, value) => sum + value, 0) / losses.length)
    : 1;

  const rawKelly = avgLossRAbs > 0 ? winRate - ((1 - winRate) / (avgWinR / avgLossRAbs || 1)) : 0;
  const halfKelly = clamp(rawKelly * 0.5, 0.001, RISK_CONFIG_DEFAULTS.max_position_pct);

  const stdDev = rMultiples.length > 1
    ? Math.sqrt(rMultiples.reduce((sum, value) => sum + (value ** 2), 0) / rMultiples.length)
    : 0;

  const volatilityScalar = clamp(1 / (1 + stdDev), 0.25, RISK_CONFIG_DEFAULTS.volatility_scalar);
  const maxPositionPct = clamp(halfKelly * volatilityScalar, 0.001, RISK_CONFIG_DEFAULTS.max_position_pct);
  const maxDailyLossPct = clamp(maxPositionPct * 0.4, 0.002, RISK_CONFIG_DEFAULTS.max_daily_loss_pct);
  const maxConcentrationPct = clamp(maxPositionPct * 4, 0.05, RISK_CONFIG_DEFAULTS.max_concentration_pct);

  const suggestions: Array<{ param: RiskConfigParam; value: number }> = [
    { param: "max_position_pct", value: round4(maxPositionPct) },
    { param: "max_daily_loss_pct", value: round4(maxDailyLossPct) },
    { param: "max_concentration_pct", value: round4(maxConcentrationPct) },
    { param: "volatility_scalar", value: round4(volatilityScalar) },
  ];

  upsertRiskConfig(suggestions.map((entry) => ({ ...entry, source: "auto-tuned" })));

  logger.info({ sampleSize: rMultiples.length, halfKelly: round4(halfKelly), suggestions }, "Risk params auto-tuned");

  return {
    sampleSize: rMultiples.length,
    winRate: round4(winRate),
    avgWinR: round4(avgWinR),
    avgLossRAbs: round4(avgLossRAbs),
    halfKelly: round4(halfKelly),
    suggestions,
  };
}

export function normalizeRiskConfig(rows: RiskConfigRow[]): Record<RiskConfigParam, number> {
  const normalized: Record<RiskConfigParam, number> = {
    max_position_pct: RISK_CONFIG_DEFAULTS.max_position_pct,
    max_daily_loss_pct: RISK_CONFIG_DEFAULTS.max_daily_loss_pct,
    max_concentration_pct: RISK_CONFIG_DEFAULTS.max_concentration_pct,
    volatility_scalar: RISK_CONFIG_DEFAULTS.volatility_scalar,
  };

  rows.forEach((row) => {
    if (row.param in normalized && Number.isFinite(row.value)) {
      normalized[row.param as RiskConfigParam] = row.value;
    }
  });

  return normalized;
}
