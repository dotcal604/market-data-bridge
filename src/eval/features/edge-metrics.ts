export interface EdgeMetrics {
  recoveryFactor: number;
  cvar: number;
  skewness: number;
  ulcerIndex: number;
}

interface DrawdownStats {
  maxDrawdown: number;
  drawdowns: number[];
}

function computeDrawdownStats(outcomes: number[]): DrawdownStats {
  let peak = 0;
  let equity = 0;
  let maxDrawdown = 0;
  const drawdowns: number[] = [];

  for (const outcome of outcomes) {
    equity += outcome;
    if (equity > peak) peak = equity;

    const drawdown = peak > 0 ? (peak - equity) / peak : 0;
    drawdowns.push(drawdown);
    if (drawdown > maxDrawdown) maxDrawdown = drawdown;
  }

  return { maxDrawdown, drawdowns };
}

export function computeRecoveryFactor(outcomes: number[]): number {
  if (outcomes.length === 0) return 0;

  const { maxDrawdown } = computeDrawdownStats(outcomes);
  const netProfit = outcomes.reduce((sum, value) => sum + value, 0);

  if (maxDrawdown > 0) return netProfit / Math.abs(maxDrawdown);
  return netProfit > 0 ? Number.POSITIVE_INFINITY : 0;
}

export function computeCVaR(outcomes: number[], alpha: number = 0.05): number {
  if (outcomes.length === 0) return 0;

  const sorted = [...outcomes].sort((a, b) => a - b);
  const tailCount = Math.max(1, Math.ceil(sorted.length * alpha));
  const tail = sorted.slice(0, tailCount);
  return tail.reduce((sum, value) => sum + value, 0) / tail.length;
}

export function computeSkewness(outcomes: number[]): number {
  if (outcomes.length === 0) return 0;

  const mean = outcomes.reduce((sum, value) => sum + value, 0) / outcomes.length;
  const variance = outcomes.reduce((sum, value) => sum + (value - mean) ** 2, 0) / outcomes.length;
  const stdDev = Math.sqrt(variance);

  if (stdDev === 0) return 0;

  const thirdMoment = outcomes.reduce((sum, value) => sum + (value - mean) ** 3, 0) / outcomes.length;
  return thirdMoment / (stdDev ** 3);
}

export function computeUlcerIndex(outcomes: number[]): number {
  if (outcomes.length === 0) return 0;

  const { drawdowns } = computeDrawdownStats(outcomes);
  return Math.sqrt(drawdowns.reduce((sum, drawdown) => sum + (drawdown ** 2), 0) / drawdowns.length);
}

export function computeEdgeMetrics(outcomes: number[], alpha: number = 0.05): EdgeMetrics {
  return {
    recoveryFactor: computeRecoveryFactor(outcomes),
    cvar: computeCVaR(outcomes, alpha),
    skewness: computeSkewness(outcomes),
    ulcerIndex: computeUlcerIndex(outcomes),
  };
}
