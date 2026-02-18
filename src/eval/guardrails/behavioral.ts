import type { EnsembleScore } from "../ensemble/types.js";
import { evalConfig } from "../config.js";
import type { DriftReport } from "../drift.js";

export interface GuardrailResult {
  allowed: boolean;
  flags: string[];
  trading_window_ok: boolean;
  consecutive_losses: number;
  insufficient_sample: boolean;
  sample_size: number;
  model_disagreement_level: "none" | "mild" | "severe";
  regime_shift_detected: boolean;
}

/**
 * Post-ensemble behavioral guardrails.
 * getRecentOutcomesFn is injected to avoid circular dependency with DB.
 * getDriftReportFn is injected to check for regime shifts.
 */
export function runGuardrails(
  ensemble: EnsembleScore,
  getRecentOutcomesFn?: (limit: number) => Array<Record<string, unknown>>,
  getOutcomeCountFn?: () => number,
  getDriftReportFn?: () => DriftReport | null,
): GuardrailResult {
  const flags: string[] = [];

  // 1. Trading window check (ET)
  const now = new Date();
  const etOffset = isEasternDST(now) ? -4 : -5;
  const etHours = (now.getUTCHours() + etOffset + 24) % 24;
  const etMinutes = now.getUTCMinutes();
  const totalMinutes = etHours * 60 + etMinutes;

  const tradingWindowOk =
    totalMinutes >= evalConfig.tradingWindowStart &&
    totalMinutes <= evalConfig.tradingWindowEnd;

  if (!tradingWindowOk) {
    flags.push(`Outside trading window (${formatTime(totalMinutes)} ET)`);
  }

  // 2. Loss streak check
  let consecutiveLosses = 0;
  if (getRecentOutcomesFn) {
    try {
      const recentOutcomes = getRecentOutcomesFn(10);
      for (const o of recentOutcomes) {
        if ((o.r_multiple as number) < 0) {
          consecutiveLosses++;
        } else {
          break;
        }
      }
    } catch {
      // DB might not be initialized yet
    }
  }

  if (consecutiveLosses >= evalConfig.maxConsecutiveLosses) {
    flags.push(`${consecutiveLosses} consecutive losses — consider pausing`);
  }

  // 3. Sample-size confidence check
  let insufficientSample = false;
  let sampleSize = 0;
  if (getOutcomeCountFn) {
    try {
      sampleSize = getOutcomeCountFn();
      if (sampleSize < evalConfig.minOutcomesSoft) {
        flags.push(`insufficient sample: ${sampleSize} trades, metrics unreliable`);
      }
      insufficientSample = sampleSize < evalConfig.minOutcomesHard;
    } catch {
      // DB might not be initialized yet
    }
  }

  // 4. Model disagreement check
  let disagreementLevel: "none" | "mild" | "severe" = "none";
  if (ensemble.score_spread > 30) {
    disagreementLevel = "severe";
    flags.push(`Severe model disagreement (spread=${ensemble.score_spread})`);
  } else if (ensemble.score_spread > 15) {
    disagreementLevel = "mild";
    flags.push(`Mild model disagreement (spread=${ensemble.score_spread})`);
  }

  if (!ensemble.unanimous && !ensemble.majority_trade) {
    flags.push("No majority consensus to trade");
  }

  // 5. Regime shift check
  let regimeShiftDetected = false;
  if (getDriftReportFn) {
    try {
      const drift = getDriftReportFn();
      if (drift?.regime_shift_detected) {
        regimeShiftDetected = true;
        flags.push("Regime shift detected — model accuracy degrading, consider pausing");
      }
    } catch {
      // Drift computation may fail if insufficient data
    }
  }

  const allowed = tradingWindowOk
    && consecutiveLosses < evalConfig.maxConsecutiveLosses
    && !insufficientSample
    && !regimeShiftDetected;

  return {
    allowed,
    flags,
    trading_window_ok: tradingWindowOk,
    consecutive_losses: consecutiveLosses,
    insufficient_sample: insufficientSample,
    sample_size: sampleSize,
    model_disagreement_level: disagreementLevel,
    regime_shift_detected: regimeShiftDetected,
  };
}

function formatTime(totalMinutes: number): string {
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${h}:${String(m).padStart(2, "0")}`;
}

function isEasternDST(date: Date): boolean {
  const year = date.getUTCFullYear();
  const marchSecondSunday = getNthSunday(year, 2, 2);
  const novFirstSunday = getNthSunday(year, 10, 1);
  return date >= marchSecondSunday && date < novFirstSunday;
}

function getNthSunday(year: number, month: number, n: number): Date {
  const d = new Date(Date.UTC(year, month, 1));
  let count = 0;
  while (count < n) {
    if (d.getUTCDay() === 0) count++;
    if (count < n) d.setUTCDate(d.getUTCDate() + 1);
  }
  d.setUTCHours(7, 0, 0, 0);
  return d;
}
