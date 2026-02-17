/**
 * Holly Backtester — Extract discriminative rules from historical outcomes,
 * score new setups against learned patterns, and measure strategy performance.
 *
 * Features:
 * - extractRules: Cohen's d effect size calculation for feature separation
 * - runBacktest: Precision, win rate, Sharpe ratio, P&L simulation
 * - scoreAgainstRules: Weighted rule matching for new candidates
 * - getStrategyBreakdown: Per-strategy performance metrics
 */
import type { Database as DatabaseType } from "better-sqlite3";
import type { FeatureVector } from "../eval/features/types.js";

// ── Types ────────────────────────────────────────────────────────────────

export interface Rule {
  feature: string;
  strategy: string | null;
  mean_win: number;
  mean_loss: number;
  std_win: number;
  std_loss: number;
  cohens_d: number;           // (mean_win - mean_loss) / pooled_std
  n_win: number;
  n_loss: number;
  threshold: number | null;   // decision boundary (if applicable)
  direction: "higher" | "lower" | "neutral";
}

export interface BacktestResult {
  total_trades: number;
  wins: number;
  losses: number;
  win_rate: number;
  avg_r: number;
  sharpe: number;
  total_pnl_r: number;
  precision: number;          // % of predicted wins that were actual wins
  max_drawdown: number;
  trades: BacktestTrade[];
}

export interface BacktestTrade {
  symbol: string;
  timestamp: string;
  predicted_win: boolean;
  actual_win: boolean;
  r_multiple: number;
  score: number;              // scoreAgainstRules output
}

export interface StrategyBreakdown {
  strategy: string;
  count: number;
  win_rate: number;
  avg_r: number;
  sharpe: number;
  total_pnl_r: number;
}

export interface RuleMatchScore {
  symbol: string;
  score: number;              // 0-100, weighted by Cohen's d
  matched_rules: number;
  total_rules: number;
}

// ── Cohen's d Calculation ────────────────────────────────────────────────

/**
 * Calculate Cohen's d effect size for a single feature.
 * d = (mean_win - mean_loss) / pooled_std
 * Pooled std = sqrt(((n1-1)*s1^2 + (n2-1)*s2^2) / (n1 + n2 - 2))
 */
function calculateCohensD(
  meanWin: number,
  meanLoss: number,
  stdWin: number,
  stdLoss: number,
  nWin: number,
  nLoss: number
): number {
  if (nWin < 2 || nLoss < 2) return 0; // Not enough samples
  
  const pooledVar = ((nWin - 1) * stdWin ** 2 + (nLoss - 1) * stdLoss ** 2) / (nWin + nLoss - 2);
  const pooledStd = Math.sqrt(pooledVar);
  
  if (pooledStd === 0) return 0; // No variance
  
  return (meanWin - meanLoss) / pooledStd;
}

/**
 * Determine direction based on Cohen's d and feature semantics.
 * Positive d → winners have higher values → "higher" is good
 * Negative d → winners have lower values → "lower" is good
 */
function inferDirection(cohensD: number, threshold = 0.2): "higher" | "lower" | "neutral" {
  if (Math.abs(cohensD) < threshold) return "neutral";
  return cohensD > 0 ? "higher" : "lower";
}

// ── extractRules ─────────────────────────────────────────────────────────

/**
 * Extract discriminative rules from historical outcomes using Cohen's d.
 * Returns one rule per (feature, strategy) combination where |d| > 0.2.
 */
export function extractRules(db: DatabaseType, minSamples = 10, minCohenD = 0.2): Rule[] {
  const features = [
    "rvol", "vwap_deviation_pct", "spread_pct", "float_rotation_est",
    "volume_acceleration", "atr_pct", "price_extension_pct", "gap_pct",
    "range_position_pct", "spy_change_pct", "qqq_change_pct", "minutes_since_open"
  ];
  
  const rules: Rule[] = [];
  
  // Get all strategies
  const strategies = db.prepare(`
    SELECT DISTINCT strategy FROM holly_alerts WHERE strategy IS NOT NULL
  `).all() as Array<{ strategy: string }>;
  
  // Add null strategy for cross-strategy patterns
  const strategyList = [null, ...strategies.map(s => s.strategy)];
  
  for (const strategy of strategyList) {
    for (const feature of features) {
      // Query wins and losses for this feature + strategy
      const query = strategy 
        ? `
          SELECT 
            e.${feature} as value,
            CASE WHEN o.r_multiple > 0 THEN 1 ELSE 0 END as is_win
          FROM evaluations e
          JOIN outcomes o ON o.evaluation_id = e.id
          JOIN signals s ON s.evaluation_id = e.id
          JOIN holly_alerts h ON h.id = s.holly_alert_id
          WHERE o.trade_taken = 1 
            AND o.r_multiple IS NOT NULL
            AND e.${feature} IS NOT NULL
            AND h.strategy = ?
        `
        : `
          SELECT 
            e.${feature} as value,
            CASE WHEN o.r_multiple > 0 THEN 1 ELSE 0 END as is_win
          FROM evaluations e
          JOIN outcomes o ON o.evaluation_id = e.id
          WHERE o.trade_taken = 1 
            AND o.r_multiple IS NOT NULL
            AND e.${feature} IS NOT NULL
        `;
      
      const rows = strategy
        ? db.prepare(query).all(strategy)
        : db.prepare(query).all();
      
      if (rows.length < minSamples) continue;
      
      const wins = (rows as Array<{ value: number; is_win: number }>).filter(r => r.is_win === 1).map(r => r.value);
      const losses = (rows as Array<{ value: number; is_win: number }>).filter(r => r.is_win === 0).map(r => r.value);
      
      if (wins.length < minSamples / 2 || losses.length < minSamples / 2) continue;
      
      const meanWin = wins.reduce((a, b) => a + b, 0) / wins.length;
      const meanLoss = losses.reduce((a, b) => a + b, 0) / losses.length;
      const stdWin = Math.sqrt(wins.reduce((a, b) => a + (b - meanWin) ** 2, 0) / wins.length);
      const stdLoss = Math.sqrt(losses.reduce((a, b) => a + (b - meanLoss) ** 2, 0) / losses.length);
      
      const cohensD = calculateCohensD(meanWin, meanLoss, stdWin, stdLoss, wins.length, losses.length);
      
      if (Math.abs(cohensD) < minCohenD) continue;
      
      const direction = inferDirection(cohensD);
      const threshold = direction === "higher" ? meanWin : direction === "lower" ? meanLoss : null;
      
      rules.push({
        feature,
        strategy,
        mean_win: Math.round(meanWin * 1000) / 1000,
        mean_loss: Math.round(meanLoss * 1000) / 1000,
        std_win: Math.round(stdWin * 1000) / 1000,
        std_loss: Math.round(stdLoss * 1000) / 1000,
        cohens_d: Math.round(cohensD * 1000) / 1000,
        n_win: wins.length,
        n_loss: losses.length,
        threshold,
        direction,
      });
    }
  }
  
  // Sort by absolute Cohen's d descending
  return rules.sort((a, b) => Math.abs(b.cohens_d) - Math.abs(a.cohens_d));
}

// ── scoreAgainstRules ────────────────────────────────────────────────────

/**
 * Score a feature vector against extracted rules.
 * Returns 0-100 weighted by Cohen's d magnitude.
 */
export function scoreAgainstRules(
  features: Partial<FeatureVector>,
  rules: Rule[],
  strategy?: string
): RuleMatchScore {
  // Filter rules by strategy
  const applicableRules = strategy
    ? rules.filter(r => r.strategy === strategy || r.strategy === null)
    : rules.filter(r => r.strategy === null);
  
  if (applicableRules.length === 0) {
    return { symbol: features.symbol || "unknown", score: 50, matched_rules: 0, total_rules: 0 };
  }
  
  let totalWeight = 0;
  let weightedScore = 0;
  let matchedCount = 0;
  
  for (const rule of applicableRules) {
    const value = (features as any)[rule.feature];
    if (value === undefined || value === null) continue;
    
    const weight = Math.abs(rule.cohens_d);
    totalWeight += weight;
    
    // Check if feature value aligns with winning direction
    let matches = false;
    if (rule.direction === "higher" && value >= (rule.threshold ?? rule.mean_win)) {
      matches = true;
    } else if (rule.direction === "lower" && value <= (rule.threshold ?? rule.mean_loss)) {
      matches = true;
    } else if (rule.direction === "neutral") {
      matches = true; // Neutral rules always match
    }
    
    if (matches) {
      weightedScore += weight * 100;
      matchedCount++;
    }
  }
  
  const finalScore = totalWeight > 0 ? Math.round(weightedScore / totalWeight) : 50;
  
  return {
    symbol: features.symbol || "unknown",
    score: finalScore,
    matched_rules: matchedCount,
    total_rules: applicableRules.length,
  };
}

// ── runBacktest ──────────────────────────────────────────────────────────

/**
 * Run backtest on historical data using extracted rules.
 * Predicts win/loss based on scoreAgainstRules, compares to actual outcomes.
 */
export function runBacktest(db: DatabaseType, rules: Rule[], winThreshold = 60): BacktestResult {
  // Get all evaluations with outcomes and features
  const rows = db.prepare(`
    SELECT 
      e.id as evaluation_id,
      e.symbol,
      e.timestamp,
      e.features_json,
      o.r_multiple,
      h.strategy
    FROM evaluations e
    JOIN outcomes o ON o.evaluation_id = e.id
    LEFT JOIN signals s ON s.evaluation_id = e.id
    LEFT JOIN holly_alerts h ON h.id = s.holly_alert_id
    WHERE o.trade_taken = 1 
      AND o.r_multiple IS NOT NULL
      AND e.features_json IS NOT NULL
    ORDER BY e.timestamp ASC
  `).all() as Array<{
    evaluation_id: string;
    symbol: string;
    timestamp: string;
    features_json: string;
    r_multiple: number;
    strategy: string | null;
  }>;
  
  if (rows.length === 0) {
    return {
      total_trades: 0,
      wins: 0,
      losses: 0,
      win_rate: 0,
      avg_r: 0,
      sharpe: 0,
      total_pnl_r: 0,
      precision: 0,
      max_drawdown: 0,
      trades: [],
    };
  }
  
  const trades: BacktestTrade[] = [];
  const returns: number[] = [];
  let predictedWins = 0;
  let actualPredictedWins = 0;
  
  for (const row of rows) {
    const features = JSON.parse(row.features_json) as Partial<FeatureVector>;
    const ruleScore = scoreAgainstRules(features, rules, row.strategy || undefined);
    const predictedWin = ruleScore.score >= winThreshold;
    const actualWin = row.r_multiple > 0;
    
    trades.push({
      symbol: row.symbol,
      timestamp: row.timestamp,
      predicted_win: predictedWin,
      actual_win: actualWin,
      r_multiple: row.r_multiple,
      score: ruleScore.score,
    });
    
    returns.push(row.r_multiple);
    
    if (predictedWin) {
      predictedWins++;
      if (actualWin) actualPredictedWins++;
    }
  }
  
  const wins = trades.filter(t => t.actual_win).length;
  const losses = trades.length - wins;
  const winRate = trades.length > 0 ? wins / trades.length : 0;
  const avgR = returns.length > 0 ? returns.reduce((a, b) => a + b, 0) / returns.length : 0;
  const totalPnlR = returns.reduce((a, b) => a + b, 0);
  
  // Sharpe ratio (annualized)
  const mean = avgR;
  const variance = returns.reduce((a, b) => a + (b - mean) ** 2, 0) / (returns.length || 1);
  const stdDev = Math.sqrt(variance);
  const sharpe = stdDev > 0 ? (mean / stdDev) * Math.sqrt(252) : 0;
  
  // Max drawdown
  let peak = 0;
  let equity = 0;
  let maxDrawdown = 0;
  for (const r of returns) {
    equity += r;
    if (equity > peak) peak = equity;
    const dd = peak > 0 ? (peak - equity) / peak : 0;
    if (dd > maxDrawdown) maxDrawdown = dd;
  }
  
  // Precision: of predicted wins, how many were actual wins
  const precision = predictedWins > 0 ? actualPredictedWins / predictedWins : 0;
  
  return {
    total_trades: trades.length,
    wins,
    losses,
    win_rate: Math.round(winRate * 1000) / 1000,
    avg_r: Math.round(avgR * 1000) / 1000,
    sharpe: Math.round(sharpe * 100) / 100,
    total_pnl_r: Math.round(totalPnlR * 100) / 100,
    precision: Math.round(precision * 1000) / 1000,
    max_drawdown: Math.round(maxDrawdown * 1000) / 1000,
    trades,
  };
}

// ── getStrategyBreakdown ─────────────────────────────────────────────────

/**
 * Per-strategy performance breakdown.
 */
export function getStrategyBreakdown(db: DatabaseType): StrategyBreakdown[] {
  const rows = db.prepare(`
    SELECT 
      h.strategy,
      COUNT(*) as count,
      SUM(CASE WHEN o.r_multiple > 0 THEN 1 ELSE 0 END) as wins,
      AVG(o.r_multiple) as avg_r,
      SUM(o.r_multiple) as total_pnl_r
    FROM evaluations e
    JOIN outcomes o ON o.evaluation_id = e.id
    JOIN signals s ON s.evaluation_id = e.id
    JOIN holly_alerts h ON h.id = s.holly_alert_id
    WHERE o.trade_taken = 1 
      AND o.r_multiple IS NOT NULL
      AND h.strategy IS NOT NULL
    GROUP BY h.strategy
    ORDER BY count DESC
  `).all() as Array<{
    strategy: string;
    count: number;
    wins: number;
    avg_r: number;
    total_pnl_r: number;
  }>;
  
  return rows.map(row => {
    const winRate = row.count > 0 ? row.wins / row.count : 0;
    
    // Calculate Sharpe for this strategy
    const returns = db.prepare(`
      SELECT o.r_multiple
      FROM evaluations e
      JOIN outcomes o ON o.evaluation_id = e.id
      JOIN signals s ON s.evaluation_id = e.id
      JOIN holly_alerts h ON h.id = s.holly_alert_id
      WHERE o.trade_taken = 1 
        AND o.r_multiple IS NOT NULL
        AND h.strategy = ?
    `).all(row.strategy) as Array<{ r_multiple: number }>;
    
    const mean = row.avg_r;
    const variance = returns.reduce((a, b) => a + (b.r_multiple - mean) ** 2, 0) / (returns.length || 1);
    const stdDev = Math.sqrt(variance);
    const sharpe = stdDev > 0 ? (mean / stdDev) * Math.sqrt(252) : 0;
    
    return {
      strategy: row.strategy,
      count: row.count,
      win_rate: Math.round(winRate * 1000) / 1000,
      avg_r: Math.round(row.avg_r * 1000) / 1000,
      sharpe: Math.round(sharpe * 100) / 100,
      total_pnl_r: Math.round(row.total_pnl_r * 100) / 100,
    };
  });
}
