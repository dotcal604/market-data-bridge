import { getAccountSummary, getPositions } from "./account.js";
import { getQuote, getHistoricalBars } from "../providers/yahoo.js";
import { logger } from "../logging.js";

const log = logger.child({ subsystem: "ibkr-portfolio" });

export interface StressTestPositionResult {
  symbol: string;
  marketValue: number;
  beta: number;
  effectiveShock: number;
  projectedLoss: number;
}

export interface PortfolioStressTestResult {
  shockPercent: number;
  betaAdjusted: boolean;
  totalProjectedPnL: number;
  equityImpactPercent: number;
  currentNetLiq: number;
  projectedNetLiq: number;
  positions: StressTestPositionResult[];
  warnings: string[];
}

function computeDailyReturns(closes: readonly number[]): number[] {
  if (closes.length < 2) return [];
  const returns: number[] = [];
  for (let index = 1; index < closes.length; index += 1) {
    const previous = closes[index - 1];
    const current = closes[index];
    if (!Number.isFinite(previous) || !Number.isFinite(current) || previous === 0) {
      continue;
    }
    returns.push((current - previous) / previous);
  }
  return returns;
}

function standardDeviation(values: readonly number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

function correlation(xs: readonly number[], ys: readonly number[]): number {
  if (xs.length < 2 || ys.length < 2 || xs.length !== ys.length) return 0;
  const meanX = xs.reduce((sum, value) => sum + value, 0) / xs.length;
  const meanY = ys.reduce((sum, value) => sum + value, 0) / ys.length;

  let covariance = 0;
  let sumSquaresX = 0;
  let sumSquaresY = 0;

  for (let index = 0; index < xs.length; index += 1) {
    const dx = xs[index] - meanX;
    const dy = ys[index] - meanY;
    covariance += dx * dy;
    sumSquaresX += dx * dx;
    sumSquaresY += dy * dy;
  }

  if (sumSquaresX === 0 || sumSquaresY === 0) return 0;
  return covariance / Math.sqrt(sumSquaresX * sumSquaresY);
}

export async function calculateBeta(symbol: string, benchmarkSymbol: string = "SPY"): Promise<number> {
  const [symbolBars, benchmarkBars] = await Promise.all([
    getHistoricalBars(symbol, "1mo", "1d"),
    getHistoricalBars(benchmarkSymbol, "1mo", "1d"),
  ]);

  const symbolCloses = symbolBars.map((bar) => bar.close).filter((close) => Number.isFinite(close));
  const benchmarkCloses = benchmarkBars.map((bar) => bar.close).filter((close) => Number.isFinite(close));

  const symbolReturns = computeDailyReturns(symbolCloses);
  const benchmarkReturns = computeDailyReturns(benchmarkCloses);

  const sampleSize = Math.min(symbolReturns.length, benchmarkReturns.length);
  if (sampleSize < 2) {
    log.warn({ symbol, benchmarkSymbol }, "Insufficient bar data for beta calculation; using beta=1");
    return 1;
  }

  const trimmedSymbol = symbolReturns.slice(symbolReturns.length - sampleSize);
  const trimmedBenchmark = benchmarkReturns.slice(benchmarkReturns.length - sampleSize);

  const corr = correlation(trimmedSymbol, trimmedBenchmark);
  const symbolStdDev = standardDeviation(trimmedSymbol);
  const benchmarkStdDev = standardDeviation(trimmedBenchmark);

  if (benchmarkStdDev === 0) {
    log.warn({ symbol, benchmarkSymbol }, "Benchmark volatility is zero; using beta=1");
    return 1;
  }

  const beta = corr * (symbolStdDev / benchmarkStdDev);
  if (!Number.isFinite(beta)) {
    log.warn({ symbol, benchmarkSymbol, corr, symbolStdDev, benchmarkStdDev }, "Computed non-finite beta; using beta=1");
    return 1;
  }

  return beta;
}

export async function runPortfolioStressTest(shockPercent: number, betaAdjusted: boolean): Promise<PortfolioStressTestResult> {
  const [positions, accountSummary] = await Promise.all([getPositions(), getAccountSummary()]);

  const currentNetLiq = accountSummary.netLiquidation ?? 0;
  if (positions.length === 0) {
    return {
      shockPercent,
      betaAdjusted,
      totalProjectedPnL: 0,
      equityImpactPercent: 0,
      currentNetLiq,
      projectedNetLiq: currentNetLiq,
      positions: [],
      warnings: shockPercent > 0 ? ["Positive shockPercent indicates upside scenario, not stress loss."] : [],
    };
  }

  const warnings: string[] = [];
  const positionResults: StressTestPositionResult[] = [];

  for (const position of positions) {
    const quantity = position.position;
    if (!Number.isFinite(quantity) || quantity === 0 || !position.symbol) continue;

    let marketValue = quantity * position.avgCost;
    try {
      const quote = await getQuote(position.symbol);
      const price = quote.last ?? quote.close;
      if (price !== null && Number.isFinite(price)) {
        marketValue = quantity * price;
      }
    } catch (error) {
      log.warn({ err: error, symbol: position.symbol }, "Failed to load quote; falling back to avgCost market value");
    }

    let beta = 1;
    if (betaAdjusted) {
      try {
        beta = await calculateBeta(position.symbol);
      } catch (error) {
        log.warn({ err: error, symbol: position.symbol }, "Failed to calculate beta; using beta=1");
        beta = 1;
      }
    }

    const effectiveShock = shockPercent * (betaAdjusted ? beta : 1);
    const projectedLoss = (marketValue * effectiveShock) / 100;

    if (beta > 2) {
      warnings.push(`${position.symbol} has high beta (${beta.toFixed(2)}), which may amplify moves.`);
    }

    positionResults.push({
      symbol: position.symbol,
      marketValue,
      beta,
      effectiveShock,
      projectedLoss,
    });
  }

  const totalProjectedPnL = positionResults.reduce((sum, item) => sum + item.projectedLoss, 0);
  const projectedNetLiq = currentNetLiq + totalProjectedPnL;
  const equityImpactPercent = currentNetLiq === 0 ? 0 : (totalProjectedPnL / currentNetLiq) * 100;

  if (currentNetLiq > 0 && totalProjectedPnL < -0.1 * currentNetLiq) {
    warnings.push("Projected loss exceeds 10% of current net liquidation value.");
  }
  if (shockPercent > 0) {
    warnings.push("Positive shockPercent indicates upside scenario, not stress loss.");
  }

  return {
    shockPercent,
    betaAdjusted,
    totalProjectedPnL,
    equityImpactPercent,
    currentNetLiq,
    projectedNetLiq,
    positions: positionResults,
    warnings,
  };
}
