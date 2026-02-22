/**
 * Edge Analytics Engine — walk-forward validation, rolling risk metrics,
 * feature attribution, and edge decay detection.
 *
 * Answers the question: "Is the ensemble producing real edge, or is it luck?"
 */
import { getDb } from "../db/database.js";
import { computeEnsembleWithWeights } from "./ensemble/scorer.js";
import { computeCVaR, computeRecoveryFactor, computeSkewness, computeUlcerIndex } from "./features/edge-metrics.js";
import type { ModelEvaluation } from "./models/types.js";

// ── Types ────────────────────────────────────────────────────────────────

export interface WalkForwardWindow {
  train_start: string;
  train_end: string;
  test_start: string;
  test_end: string;
  train_size: number;
  test_size: number;
  test_win_rate: number;
  test_avg_r: number;
  test_sharpe: number;
  optimal_weights: { claude: number; gpt4o: number; gemini: number; k: number };
}

export interface WalkForwardResult {
  windows: WalkForwardWindow[];
  aggregate: {
    oos_win_rate: number;          // out-of-sample win rate across all test windows
    oos_avg_r: number;             // out-of-sample avg R across all test windows
    oos_sharpe: number;            // out-of-sample Sharpe across all test windows
    total_oos_trades: number;
    total_windows: number;
    edge_stable: boolean;          // true if oos_win_rate > 50% in majority of windows
    edge_decay_detected: boolean;  // true if recent windows worse than earlier ones
  };
}

export interface RollingMetrics {
  date: string;
  cumulative_trades: number;
  rolling_win_rate: number;     // last N trades
  rolling_avg_r: number;        // last N trades
  rolling_sharpe: number;       // annualized from daily P&L
  rolling_sortino: number;      // annualized downside deviation
  rolling_max_dd: number;       // max drawdown from peak
  equity_curve: number;         // cumulative R
}

export interface BootstrapCI {
  metric: string;
  observed: number;
  ci_lower: number;     // 2.5th percentile
  ci_upper: number;     // 97.5th percentile
  significant: boolean; // CI doesn't cross zero (for metrics where zero = no edge)
  n_resamples: number;
}

export interface EdgeReport {
  rolling_metrics: RollingMetrics[];
  current: {
    win_rate: number;
    avg_r: number;
    sharpe: number;
    sortino: number;
    max_drawdown: number;
    recovery_factor: number;
    cvar_5: number;
    skewness: number;
    kurtosis: number;
    ulcer_index: number;
    profit_factor: number;
    total_trades: number;
    expectancy: number;
    edge_score: number;         // composite 0-100 score
  };
  walk_forward: WalkForwardResult | null;
  feature_attribution: FeatureAttribution[];
  bootstrap_ci: BootstrapCI[] | null;
  monte_carlo: MonteCarloResult | null;
}

export interface MonteCarloResult {
  simulations: number;
  trades_per_sim: number;
  max_dd_mean: number;
  max_dd_median: number;
  max_dd_95th: number;
  max_dd_99th: number;
  final_equity_mean: number;
  final_equity_median: number;
  ruin_probability: number;
}

export interface FeatureAttribution {
  feature: string;
  win_rate_when_high: number;
  win_rate_when_low: number;
  lift: number;               // difference: high - low
  sample_high: number;
  sample_low: number;
  significant: boolean;       // lift > 5pp and both samples > 10
}

// ── Helpers ──────────────────────────────────────────────────────────────

/** Build a minimal ModelEvaluation for re-scoring (only trade_score/RR/confidence matter). */
function toModelEval(o: {
  model_id: string;
  trade_score: number | null;
  expected_rr: number | null;
  confidence: number | null;
  should_trade: number | null;
}): ModelEvaluation {
  return {
    model_id: o.model_id as "claude" | "gpt4o" | "gemini",
    compliant: true,
    output: {
      trade_score: o.trade_score!,
      extension_risk: 0,
      exhaustion_risk: 0,
      float_rotation_risk: 0,
      market_alignment: 0,
      expected_rr: o.expected_rr ?? 0,
      confidence: o.confidence ?? 0,
      should_trade: o.should_trade === 1,
      reasoning: "",
    },
    raw_response: "",
    latency_ms: 0,
    error: null,
    model_version: "",
    prompt_hash: "",
    token_count: 0,
    api_response_id: "",
    timestamp: "",
  };
}

function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

interface OutcomeRow {
  evaluation_id: string;
  symbol: string;
  direction: string;
  timestamp: string;
  ensemble_trade_score: number;
  ensemble_should_trade: number;
  r_multiple: number;
  trade_taken: number;
  // Feature columns
  rvol: number | null;
  vwap_deviation_pct: number | null;
  spread_pct: number | null;
  volume_acceleration: number | null;
  atr_pct: number | null;
  gap_pct: number | null;
  range_position_pct: number | null;
  price_extension_pct: number | null;
  spy_change_pct: number | null;
  qqq_change_pct: number | null;
  minutes_since_open: number | null;
  volatility_regime: string | null;
  time_of_day: string | null;
}

function getOutcomeRows(days: number): OutcomeRow[] {
  const db = getDb();
  return db.prepare(`
    SELECT
      e.id as evaluation_id,
      e.symbol,
      e.direction,
      e.timestamp,
      e.ensemble_trade_score,
      e.ensemble_should_trade,
      o.r_multiple,
      o.trade_taken,
      e.rvol,
      e.vwap_deviation_pct,
      e.spread_pct,
      e.volume_acceleration,
      e.atr_pct,
      e.gap_pct,
      e.range_position_pct,
      e.price_extension_pct,
      e.spy_change_pct,
      e.qqq_change_pct,
      e.minutes_since_open,
      e.volatility_regime,
      e.time_of_day
    FROM evaluations e
    JOIN outcomes o ON o.evaluation_id = e.id
    WHERE o.trade_taken = 1
      AND o.r_multiple IS NOT NULL
      AND e.prefilter_passed = 1
      AND e.timestamp >= datetime('now', ? || ' days')
    ORDER BY e.timestamp ASC
  `).all(`-${days}`) as OutcomeRow[];
}

// ── Rolling Risk Metrics ─────────────────────────────────────────────────

function computeRollingMetrics(rows: OutcomeRow[], windowSize: number = 20): RollingMetrics[] {
  if (rows.length === 0) return [];

  const metrics: RollingMetrics[] = [];
  let peak = 0;
  let equity = 0;
  let maxDd = 0;

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i].r_multiple;
    equity += r;
    if (equity > peak) peak = equity;
    const dd = peak > 0 ? (peak - equity) / peak : 0;
    if (dd > maxDd) maxDd = dd;

    // Rolling window stats
    const windowStart = Math.max(0, i - windowSize + 1);
    const window = rows.slice(windowStart, i + 1);
    const wins = window.filter((w) => w.r_multiple > 0).length;
    const winRate = wins / window.length;
    const avgR = window.reduce((s, w) => s + w.r_multiple, 0) / window.length;

    // Rolling Sharpe (annualized assuming 252 trading days)
    const returns = window.map((w) => w.r_multiple);
    const mean = avgR;
    const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / returns.length;
    const stdDev = Math.sqrt(variance);
    const sharpe = stdDev > 0 ? (mean / stdDev) * Math.sqrt(252) : 0;

    // Rolling Sortino (downside deviation only)
    const downReturns = returns.filter((r) => r < 0);
    const downVar = downReturns.length > 0
      ? downReturns.reduce((s, r) => s + r ** 2, 0) / returns.length
      : 0;
    const downDev = Math.sqrt(downVar);
    const sortino = downDev > 0 ? (mean / downDev) * Math.sqrt(252) : 0;

    metrics.push({
      date: rows[i].timestamp.slice(0, 10),
      cumulative_trades: i + 1,
      rolling_win_rate: round3(winRate),
      rolling_avg_r: round3(avgR),
      rolling_sharpe: round2(sharpe),
      rolling_sortino: round2(sortino),
      rolling_max_dd: round3(maxDd),
      equity_curve: round2(equity),
    });
  }

  return metrics;
}

// ── Current Aggregate Stats ──────────────────────────────────────────────

function computeCurrentStats(rows: OutcomeRow[]) {
  if (rows.length === 0) {
    return {
      win_rate: 0, avg_r: 0, sharpe: 0, sortino: 0,
      max_drawdown: 0, recovery_factor: 0, cvar_5: 0,
      skewness: 0, kurtosis: 0, ulcer_index: 0,
      profit_factor: 0, total_trades: 0,
      expectancy: 0, edge_score: 0,
    };
  }

  const wins = rows.filter((r) => r.r_multiple > 0);
  const losses = rows.filter((r) => r.r_multiple <= 0);
  const winRate = wins.length / rows.length;
  const avgR = rows.reduce((s, r) => s + r.r_multiple, 0) / rows.length;

  const grossProfit = wins.reduce((s, r) => s + r.r_multiple, 0);
  const grossLoss = Math.abs(losses.reduce((s, r) => s + r.r_multiple, 0));
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;

  // Expectancy = (win% * avg_win) - (loss% * avg_loss)
  const avgWin = wins.length > 0 ? wins.reduce((s, r) => s + r.r_multiple, 0) / wins.length : 0;
  const avgLoss = losses.length > 0 ? Math.abs(losses.reduce((s, r) => s + r.r_multiple, 0) / losses.length) : 0;
  const expectancy = (winRate * avgWin) - ((1 - winRate) * avgLoss);

  // Full-period Sharpe/Sortino
  const returns = rows.map((r) => r.r_multiple);
  const mean = avgR;
  const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / returns.length;
  const stdDev = Math.sqrt(variance);
  const sharpe = stdDev > 0 ? (mean / stdDev) * Math.sqrt(252) : 0;

  const downReturns = returns.filter((r) => r < 0);
  const downVar = downReturns.length > 0
    ? downReturns.reduce((s, r) => s + r ** 2, 0) / returns.length
    : 0;
  const sortino = Math.sqrt(downVar) > 0 ? (mean / Math.sqrt(downVar)) * Math.sqrt(252) : 0;

  // Max drawdown
  let peak = 0, equity = 0, maxDd = 0;
  for (const r of rows) {
    equity += r.r_multiple;
    if (equity > peak) peak = equity;
    const dd = peak > 0 ? (peak - equity) / peak : 0;
    if (dd > maxDd) maxDd = dd;
  }

  const recoveryFactor = computeRecoveryFactor(returns);
  const cvar5 = computeCVaR(returns, 0.05);
  const skewness = computeSkewness(returns);
  const ulcerIndex = computeUlcerIndex(returns);

  // Skewness = E[(x-μ)^3] / σ^3 ; Kurtosis(excess) = E[(x-μ)^4] / σ^4 - 3
  const fourthMoment = returns.reduce((s, r) => s + (r - mean) ** 4, 0) / returns.length;
  const kurtosis = stdDev > 0 ? (fourthMoment / (stdDev ** 4)) - 3 : 0;

  // Edge Score (composite 0-100)
  // Components: win_rate (30%), profit_factor (25%), sharpe (25%), sample_size (20%)
  const wrScore = Math.min(30, (winRate - 0.4) * 150); // 40% = 0, 60% = 30
  const pfScore = Math.min(25, (Math.min(profitFactor, 3) - 1) * 12.5); // 1.0 = 0, 3.0 = 25
  const shScore = Math.min(25, Math.max(0, sharpe * 12.5)); // 0 = 0, 2.0 = 25
  const szScore = Math.min(20, rows.length / 5); // 100 trades = 20
  const edgeScore = Math.max(0, Math.round(wrScore + pfScore + shScore + szScore));

  return {
    win_rate: round3(winRate),
    avg_r: round3(avgR),
    sharpe: round2(sharpe),
    sortino: round2(sortino),
    max_drawdown: round3(maxDd),
    recovery_factor: round3(recoveryFactor),
    cvar_5: round3(cvar5),
    skewness: round3(skewness),
    kurtosis: round3(kurtosis),
    ulcer_index: round3(ulcerIndex),
    profit_factor: round2(profitFactor),
    total_trades: rows.length,
    expectancy: round3(expectancy),
    edge_score: Math.min(100, edgeScore),
  };
}

// ── Bootstrap Confidence Intervals ───────────────────────────────────────

/**
 * Seeded pseudo-random for reproducible bootstraps (Mulberry32).
 */
function mulberry32(seed: number): () => number {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Bootstrap confidence intervals for key edge metrics.
 * Resamples R-multiples with replacement N times, computes metrics on each
 * resample, then reports 2.5th / 97.5th percentile bounds.
 *
 * Pure function — deterministic with seed.
 * @param rMultiples Array of trade outcomes (R-multiples)
 * @param nResamples Number of bootstrap iterations (default 1000)
 * @param seed Random seed for reproducibility
 * @returns Array of confidence intervals for key metrics
 */
export function computeBootstrapCI(
  rMultiples: number[],
  nResamples: number = 1000,
  seed: number = 42,
): BootstrapCI[] {
  if (rMultiples.length < 10) return [];

  const rng = mulberry32(seed);
  const n = rMultiples.length;

  const winRates: number[] = [];
  const avgRs: number[] = [];
  const expectancies: number[] = [];
  const sharpes: number[] = [];

  for (let i = 0; i < nResamples; i++) {
    // Resample with replacement
    const sample: number[] = [];
    for (let j = 0; j < n; j++) {
      sample.push(rMultiples[Math.floor(rng() * n)]);
    }

    const wins = sample.filter((r) => r > 0);
    const losses = sample.filter((r) => r <= 0);
    const wr = wins.length / sample.length;
    const avgR = sample.reduce((s, r) => s + r, 0) / sample.length;

    const avgWin = wins.length > 0 ? wins.reduce((s, r) => s + r, 0) / wins.length : 0;
    const avgLoss = losses.length > 0 ? Math.abs(losses.reduce((s, r) => s + r, 0) / losses.length) : 0;
    const exp = (wr * avgWin) - ((1 - wr) * avgLoss);

    const variance = sample.reduce((s, r) => s + (r - avgR) ** 2, 0) / sample.length;
    const stdDev = Math.sqrt(variance);
    const sharpe = stdDev > 0 ? (avgR / stdDev) * Math.sqrt(252) : 0;

    winRates.push(wr);
    avgRs.push(avgR);
    expectancies.push(exp);
    sharpes.push(sharpe);
  }

  const percentile = (arr: number[], p: number): number => {
    const sorted = [...arr].sort((a, b) => a - b);
    const idx = Math.floor(sorted.length * p);
    return sorted[Math.min(idx, sorted.length - 1)];
  };

  const observed = {
    win_rate: rMultiples.filter((r) => r > 0).length / rMultiples.length,
    avg_r: rMultiples.reduce((s, r) => s + r, 0) / rMultiples.length,
    expectancy: (() => {
      const wins = rMultiples.filter((r) => r > 0);
      const losses = rMultiples.filter((r) => r <= 0);
      const wr = wins.length / rMultiples.length;
      const avgWin = wins.length > 0 ? wins.reduce((s, r) => s + r, 0) / wins.length : 0;
      const avgLoss = losses.length > 0 ? Math.abs(losses.reduce((s, r) => s + r, 0) / losses.length) : 0;
      return (wr * avgWin) - ((1 - wr) * avgLoss);
    })(),
    sharpe: (() => {
      const mean = rMultiples.reduce((s, r) => s + r, 0) / rMultiples.length;
      const variance = rMultiples.reduce((s, r) => s + (r - mean) ** 2, 0) / rMultiples.length;
      return Math.sqrt(variance) > 0 ? (mean / Math.sqrt(variance)) * Math.sqrt(252) : 0;
    })(),
  };

  return [
    {
      metric: "win_rate",
      observed: round3(observed.win_rate),
      ci_lower: round3(percentile(winRates, 0.025)),
      ci_upper: round3(percentile(winRates, 0.975)),
      significant: percentile(winRates, 0.025) > 0.5, // edge = better than coin flip
      n_resamples: nResamples,
    },
    {
      metric: "avg_r",
      observed: round3(observed.avg_r),
      ci_lower: round3(percentile(avgRs, 0.025)),
      ci_upper: round3(percentile(avgRs, 0.975)),
      significant: percentile(avgRs, 0.025) > 0,
      n_resamples: nResamples,
    },
    {
      metric: "expectancy",
      observed: round3(observed.expectancy),
      ci_lower: round3(percentile(expectancies, 0.025)),
      ci_upper: round3(percentile(expectancies, 0.975)),
      significant: percentile(expectancies, 0.025) > 0,
      n_resamples: nResamples,
    },
    {
      metric: "sharpe",
      observed: round2(observed.sharpe),
      ci_lower: round2(percentile(sharpes, 0.025)),
      ci_upper: round2(percentile(sharpes, 0.975)),
      significant: percentile(sharpes, 0.025) > 0,
      n_resamples: nResamples,
    },
  ];
}

/**
 * Monte Carlo drawdown simulation using bootstrap resampling of R-multiples.
 *
 * For each simulation:
 * 1) Resample trades with replacement.
 * 2) Build equity curve from sampled R-multiples.
 * 3) Track maximum drawdown and final equity.
 * @param rMultiples Array of trade outcomes
 * @param nSimulations Number of simulations (default 1000)
 * @param nTrades Trades per simulation (defaults to input length)
 * @param seed Random seed
 * @returns Monte Carlo risk metrics
 */
export function computeMonteCarloDD(
  rMultiples: number[],
  nSimulations: number = 1000,
  nTrades: number = rMultiples.length,
  seed: number = 42,
): MonteCarloResult {
  if (rMultiples.length === 0 || nSimulations <= 0 || nTrades <= 0) {
    return {
      simulations: 0,
      trades_per_sim: 0,
      max_dd_mean: 0,
      max_dd_median: 0,
      max_dd_95th: 0,
      max_dd_99th: 0,
      final_equity_mean: 0,
      final_equity_median: 0,
      ruin_probability: 0,
    };
  }

  const percentile = (arr: number[], p: number): number => {
    const sorted = [...arr].sort((a, b) => a - b);
    const idx = Math.floor(sorted.length * p);
    return sorted[Math.min(idx, sorted.length - 1)];
  };

  const rng = mulberry32(seed);
  const maxDds: number[] = [];
  const finalEquities: number[] = [];
  let ruinCount = 0;

  for (let i = 0; i < nSimulations; i++) {
    let equity = 0;
    let peak = 0;
    let maxDd = 0;

    for (let j = 0; j < nTrades; j++) {
      equity += rMultiples[Math.floor(rng() * rMultiples.length)];
      if (equity > peak) peak = equity;

      const dd = peak > 0 ? (peak - equity) / peak : 0;
      if (dd > maxDd) maxDd = dd;
    }

    if (maxDd >= 0.5) ruinCount++;
    maxDds.push(maxDd);
    finalEquities.push(equity);
  }

  const mean = (arr: number[]): number => arr.reduce((s, v) => s + v, 0) / arr.length;

  return {
    simulations: nSimulations,
    trades_per_sim: nTrades,
    max_dd_mean: round3(mean(maxDds)),
    max_dd_median: round3(percentile(maxDds, 0.5)),
    max_dd_95th: round3(percentile(maxDds, 0.95)),
    max_dd_99th: round3(percentile(maxDds, 0.99)),
    final_equity_mean: round3(mean(finalEquities)),
    final_equity_median: round3(percentile(finalEquities, 0.5)),
    ruin_probability: round3(ruinCount / nSimulations),
  };
}

// ── Walk-Forward Validation ──────────────────────────────────────────────

/**
 * Walk-forward validation: train on N trades, test on M trades, step forward.
 * Tests whether optimized weights produce real out-of-sample edge.
 * @param opts Configuration (days lookback, train/test split size)
 * @returns Walk-forward analysis result
 */
export function runWalkForward(opts: {
  days?: number;
  trainSize?: number;
  testSize?: number;
} = {}): WalkForwardResult {
  const days = opts.days ?? 180;
  const trainSize = opts.trainSize ?? 30;
  const testSize = opts.testSize ?? 10;

  const db = getDb();

  // Pull all evals with outcomes + model outputs
  const rows = db.prepare(`
    SELECT
      e.id as evaluation_id,
      e.symbol,
      e.timestamp,
      e.ensemble_trade_score,
      e.ensemble_should_trade,
      o.r_multiple,
      o.trade_taken
    FROM evaluations e
    JOIN outcomes o ON o.evaluation_id = e.id
    WHERE o.trade_taken = 1
      AND o.r_multiple IS NOT NULL
      AND e.prefilter_passed = 1
      AND e.timestamp >= datetime('now', ? || ' days')
    ORDER BY e.timestamp ASC
  `).all(`-${days}`) as Array<{
    evaluation_id: string;
    symbol: string;
    timestamp: string;
    ensemble_trade_score: number;
    ensemble_should_trade: number;
    r_multiple: number;
    trade_taken: number;
  }>;

  // Load all model outputs for these evals
  if (rows.length === 0) {
    return {
      windows: [],
      aggregate: {
        oos_win_rate: 0, oos_avg_r: 0, oos_sharpe: 0,
        total_oos_trades: 0, total_windows: 0,
        edge_stable: false, edge_decay_detected: false,
      },
    };
  }

  const evalIds = rows.map((r) => r.evaluation_id);
  const placeholders = evalIds.map(() => "?").join(",");
  const modelOutputs = db.prepare(`
    SELECT evaluation_id, model_id, trade_score, expected_rr, confidence, should_trade, compliant
    FROM model_outputs
    WHERE evaluation_id IN (${placeholders})
  `).all(...evalIds) as Array<{
    evaluation_id: string;
    model_id: string;
    trade_score: number | null;
    expected_rr: number | null;
    confidence: number | null;
    should_trade: number | null;
    compliant: number;
  }>;

  const outputMap = new Map<string, typeof modelOutputs>();
  for (const o of modelOutputs) {
    const arr = outputMap.get(o.evaluation_id) ?? [];
    arr.push(o);
    outputMap.set(o.evaluation_id, arr);
  }

  const windows: WalkForwardWindow[] = [];
  const minTotal = trainSize + testSize;
  if (rows.length < minTotal) {
    return {
      windows: [],
      aggregate: {
        oos_win_rate: 0, oos_avg_r: 0, oos_sharpe: 0,
        total_oos_trades: rows.length, total_windows: 0,
        edge_stable: false, edge_decay_detected: false,
      },
    };
  }

  // Walk forward
  for (let start = 0; start + minTotal <= rows.length; start += testSize) {
    const trainRows = rows.slice(start, start + trainSize);
    const testRows = rows.slice(start + trainSize, start + trainSize + testSize);
    if (testRows.length === 0) break;

    // Find optimal weights on training window via grid search
    const bestWeights = gridSearchWeights(trainRows, outputMap);

    // Evaluate on test window with optimized weights
    const testResults = testRows.map((r) => {
      const outputs = outputMap.get(r.evaluation_id) ?? [];
      const modelEvals = outputs
        .filter((o) => o.compliant === 1 && o.trade_score !== null)
        .map(toModelEval);

      const score = computeEnsembleWithWeights(modelEvals, bestWeights);
      return { ...r, should_trade_optimized: score.should_trade, score: score.trade_score };
    });

    const taken = testResults; // already filtered to trade_taken=1
    const wins = taken.filter((r) => r.r_multiple > 0).length;
    const testWinRate = taken.length > 0 ? wins / taken.length : 0;
    const testAvgR = taken.length > 0 ? taken.reduce((s, r) => s + r.r_multiple, 0) / taken.length : 0;

    // Test window Sharpe
    const returns = taken.map((r) => r.r_multiple);
    const mean = testAvgR;
    const variance = returns.length > 1
      ? returns.reduce((s, r) => s + (r - mean) ** 2, 0) / returns.length
      : 0;
    const stdDev = Math.sqrt(variance);
    const testSharpe = stdDev > 0 ? (mean / stdDev) * Math.sqrt(252) : 0;

    windows.push({
      train_start: trainRows[0].timestamp,
      train_end: trainRows[trainRows.length - 1].timestamp,
      test_start: testRows[0].timestamp,
      test_end: testRows[testRows.length - 1].timestamp,
      train_size: trainRows.length,
      test_size: testRows.length,
      test_win_rate: round3(testWinRate),
      test_avg_r: round3(testAvgR),
      test_sharpe: round2(testSharpe),
      optimal_weights: bestWeights,
    });
  }

  // Aggregate out-of-sample stats
  const allOosTrades = windows.reduce((s, w) => s + w.test_size, 0);
  const totalOosWins = windows.reduce((s, w) => s + Math.round(w.test_win_rate * w.test_size), 0);
  const oosWinRate = allOosTrades > 0 ? totalOosWins / allOosTrades : 0;
  const oosAvgR = windows.length > 0
    ? windows.reduce((s, w) => s + w.test_avg_r * w.test_size, 0) / allOosTrades
    : 0;
  const oosSharpe = windows.length > 0
    ? windows.reduce((s, w) => s + w.test_sharpe, 0) / windows.length
    : 0;

  // Edge stability: win_rate > 50% in majority of windows
  const winningWindows = windows.filter((w) => w.test_win_rate > 0.5).length;
  const edgeStable = windows.length > 0 && winningWindows / windows.length >= 0.6;

  // Edge decay: compare first half vs second half of windows
  const mid = Math.floor(windows.length / 2);
  const firstHalf = windows.slice(0, mid);
  const secondHalf = windows.slice(mid);
  const firstAvgWr = firstHalf.length > 0 ? firstHalf.reduce((s, w) => s + w.test_win_rate, 0) / firstHalf.length : 0;
  const secondAvgWr = secondHalf.length > 0 ? secondHalf.reduce((s, w) => s + w.test_win_rate, 0) / secondHalf.length : 0;
  const edgeDecay = windows.length >= 4 && secondAvgWr < firstAvgWr - 0.05;

  return {
    windows,
    aggregate: {
      oos_win_rate: round3(oosWinRate),
      oos_avg_r: round3(oosAvgR),
      oos_sharpe: round2(oosSharpe),
      total_oos_trades: allOosTrades,
      total_windows: windows.length,
      edge_stable: edgeStable,
      edge_decay_detected: edgeDecay,
    },
  };
}

/**
 * Simple grid search for optimal ensemble weights on a training set.
 * Tests weight combinations in 0.1 increments and picks the one
 * that maximizes expectancy (win% * avg_win - loss% * avg_loss).
 */
function gridSearchWeights(
  trainRows: Array<{ evaluation_id: string; r_multiple: number }>,
  outputMap: Map<string, Array<{
    evaluation_id: string; model_id: string;
    trade_score: number | null; expected_rr: number | null;
    confidence: number | null; should_trade: number | null; compliant: number;
  }>>,
): { claude: number; gpt4o: number; gemini: number; k: number } {
  let bestWeights = { claude: 0.33, gpt4o: 0.33, gemini: 0.33, k: 1.0 };
  let bestExpectancy = -Infinity;

  // Coarse grid: step 0.1, k in [0.5, 1.0, 1.5, 2.0]
  for (let c = 0.1; c <= 0.8; c += 0.1) {
    for (let g = 0.1; g <= 0.8 - c + 0.01; g += 0.1) {
      const gpt = round3(1.0 - c - g);
      if (gpt < 0.05) continue;

      for (const k of [0.5, 1.0, 1.5, 2.0]) {
        const weights = { claude: round3(c), gpt4o: round3(gpt), gemini: round3(g), k };

        // Score all training rows with these weights
        let wins = 0, losses = 0, totalWinR = 0, totalLossR = 0;

        for (const row of trainRows) {
          const outputs = outputMap.get(row.evaluation_id) ?? [];
          const modelEvals = outputs
            .filter((o) => o.compliant === 1 && o.trade_score !== null)
            .map(toModelEval);

          const score = computeEnsembleWithWeights(modelEvals, weights);
          // Only count if the ensemble says "should trade"
          if (score.should_trade) {
            if (row.r_multiple > 0) { wins++; totalWinR += row.r_multiple; }
            else { losses++; totalLossR += Math.abs(row.r_multiple); }
          }
        }

        const total = wins + losses;
        if (total < 5) continue; // Need minimum sample

        const winRate = wins / total;
        const avgWin = wins > 0 ? totalWinR / wins : 0;
        const avgLoss = losses > 0 ? totalLossR / losses : 0;
        const expectancy = (winRate * avgWin) - ((1 - winRate) * avgLoss);

        if (expectancy > bestExpectancy) {
          bestExpectancy = expectancy;
          bestWeights = weights;
        }
      }
    }
  }

  return bestWeights;
}

// ── Feature Attribution ──────────────────────────────────────────────────

/**
 * Compute feature attribution by splitting outcomes on each feature's
 * median and comparing win rates above/below. Simple but effective.
 */
function computeFeatureAttribution(rows: OutcomeRow[]): FeatureAttribution[] {
  if (rows.length < 20) return [];

  const numericFeatures: Array<{ name: string; accessor: (r: OutcomeRow) => number | null }> = [
    { name: "rvol", accessor: (r) => r.rvol },
    { name: "vwap_deviation_pct", accessor: (r) => r.vwap_deviation_pct },
    { name: "spread_pct", accessor: (r) => r.spread_pct },
    { name: "volume_acceleration", accessor: (r) => r.volume_acceleration },
    { name: "atr_pct", accessor: (r) => r.atr_pct },
    { name: "gap_pct", accessor: (r) => r.gap_pct },
    { name: "range_position_pct", accessor: (r) => r.range_position_pct },
    { name: "price_extension_pct", accessor: (r) => r.price_extension_pct },
    { name: "spy_change_pct", accessor: (r) => r.spy_change_pct },
    { name: "qqq_change_pct", accessor: (r) => r.qqq_change_pct },
    { name: "minutes_since_open", accessor: (r) => r.minutes_since_open },
    { name: "ensemble_trade_score", accessor: (r) => r.ensemble_trade_score },
  ];

  const results: FeatureAttribution[] = [];

  for (const feat of numericFeatures) {
    const valid = rows.filter((r) => feat.accessor(r) !== null);
    if (valid.length < 20) continue;

    // Find median
    const sorted = valid.map((r) => feat.accessor(r)!).sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];

    const high = valid.filter((r) => feat.accessor(r)! > median);
    const low = valid.filter((r) => feat.accessor(r)! <= median);

    if (high.length < 5 || low.length < 5) continue;

    const highWinRate = high.filter((r) => r.r_multiple > 0).length / high.length;
    const lowWinRate = low.filter((r) => r.r_multiple > 0).length / low.length;
    const lift = highWinRate - lowWinRate;

    results.push({
      feature: feat.name,
      win_rate_when_high: round3(highWinRate),
      win_rate_when_low: round3(lowWinRate),
      lift: round3(lift),
      sample_high: high.length,
      sample_low: low.length,
      significant: Math.abs(lift) > 0.05 && high.length >= 10 && low.length >= 10,
    });
  }

  // Sort by absolute lift descending
  results.sort((a, b) => Math.abs(b.lift) - Math.abs(a.lift));
  return results;
}

// ── Main Entry Point ─────────────────────────────────────────────────────

/**
 * Compute full edge report: rolling metrics, current stats,
 * walk-forward validation, and feature attribution.
 * @param opts Configuration options
 * @returns Comprehensive edge report
 */
export function computeEdgeReport(opts: {
  days?: number;
  rollingWindow?: number;
  includeWalkForward?: boolean;
} = {}): EdgeReport {
  const days = opts.days ?? 90;
  const rollingWindow = opts.rollingWindow ?? 20;
  const includeWF = opts.includeWalkForward ?? true;

  const rows = getOutcomeRows(days);
  const rollingMetrics = computeRollingMetrics(rows, rollingWindow);
  const current = computeCurrentStats(rows);
  const featureAttribution = computeFeatureAttribution(rows);

  let walkForward: WalkForwardResult | null = null;
  if (includeWF && rows.length >= 40) {
    walkForward = runWalkForward({ days });
  }

  // Bootstrap CI: requires at least 10 outcomes
  const bootstrapCI = rows.length >= 10
    ? computeBootstrapCI(rows.map((r) => r.r_multiple))
    : null;

  const monteCarlo = rows.length >= 20
    ? computeMonteCarloDD(rows.map((r) => r.r_multiple))
    : null;

  return {
    rolling_metrics: rollingMetrics,
    current,
    walk_forward: walkForward,
    feature_attribution: featureAttribution,
    bootstrap_ci: bootstrapCI,
    monte_carlo: monteCarlo,
  };
}
