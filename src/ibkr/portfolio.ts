import { getPositions, getAccountSummary, type PositionData } from "./account.js";
import { getContractDetails, type ContractDetailsData } from "./contracts.js";
import { getHistoricalBars, type BarData, getQuote } from "../providers/yahoo.js";
import { logger } from "../logging.js";

const log = logger.child({ subsystem: "ibkr-portfolio" });

// ─── Contract Details Cache (24h TTL) ─────────────────────────

interface CachedContractDetails {
  data: ContractDetailsData;
  timestamp: number;
}

const contractCache = new Map<string, CachedContractDetails>();
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

async function getCachedContractDetails(symbol: string): Promise<ContractDetailsData | null> {
  const cached = contractCache.get(symbol);
  const now = Date.now();

  if (cached && (now - cached.timestamp) < CACHE_TTL_MS) {
    return cached.data;
  }

  try {
    const details = await getContractDetails({ symbol });
    if (details.length > 0) {
      const firstDetail = details[0];
      contractCache.set(symbol, { data: firstDetail, timestamp: now });
      return firstDetail;
    }
  } catch {
    if (cached) {
      return cached.data;
    }
  }

  return null;
}

// ─── Math Helpers ─────────────────────────────────────────────

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

// ─── ATR Calculation ──────────────────────────────────────────

export function calculateATR(bars: BarData[], period: number = 14): number {
  if (bars.length < 2) return 0;

  const trs: number[] = [];
  for (let i = 1; i < bars.length; i++) {
    const curr = bars[i];
    const prev = bars[i - 1];
    const tr = Math.max(
      curr.high - curr.low,
      Math.abs(curr.high - prev.close),
      Math.abs(curr.low - prev.close)
    );
    trs.push(tr);
  }

  if (trs.length === 0) return 0;

  const recent = trs.slice(-period);
  const atr = recent.reduce((sum, val) => sum + val, 0) / recent.length;

  return Math.round(atr * 100) / 100;
}

// ─── Beta Calculation ─────────────────────────────────────────

export async function calculateBeta(symbol: string, benchmarkSymbol: string = "SPY"): Promise<number> {
  try {
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

    return Math.round(beta * 100) / 100;
  } catch {
    return 1;
  }
}

// ─── Stress Test ──────────────────────────────────────────────

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

// ─── Portfolio Exposure ───────────────────────────────────────

export interface PortfolioExposureResponse {
  grossExposure: number;
  netExposure: number;
  percentDeployed: number;
  largestPositionPercent: number;
  largestPosition: string | null;
  sectorBreakdown: Record<string, number>;
  betaWeightedExposure: number;
  portfolioHeat: number;
  positionCount: number;
  netLiquidation: number;
}

interface PositionWithValue extends PositionData {
  marketValue: number;
  sector: string | null;
  beta: number;
  atr: number;
}

export async function computePortfolioExposure(): Promise<PortfolioExposureResponse> {
  const [positions, summary] = await Promise.all([
    getPositions(),
    getAccountSummary(),
  ]);

  const netLiquidation = summary.netLiquidation ?? 0;

  if (positions.length === 0 || netLiquidation === 0) {
    return {
      grossExposure: 0,
      netExposure: 0,
      percentDeployed: 0,
      largestPositionPercent: 0,
      largestPosition: null,
      sectorBreakdown: {},
      betaWeightedExposure: 0,
      portfolioHeat: 0,
      positionCount: 0,
      netLiquidation,
    };
  }

  const enrichedPositions: PositionWithValue[] = await Promise.all(
    positions.map(async (pos) => {
      let currentPrice: number;
      try {
        const quote = await getQuote(pos.symbol);
        if (quote.last !== null) {
          currentPrice = quote.last;
        } else {
          log.warn({ symbol: pos.symbol }, "Quote last is null, using avgCost");
          currentPrice = pos.avgCost;
        }
      } catch (err: any) {
        log.warn({ symbol: pos.symbol, error: err.message }, "Failed to fetch quote, using avgCost");
        currentPrice = pos.avgCost;
      }
      const marketValue = pos.position * currentPrice;

      const contractDetails = await getCachedContractDetails(pos.symbol);
      const sector = contractDetails?.category ?? null;

      const [beta, bars] = await Promise.all([
        calculateBeta(pos.symbol),
        getHistoricalBars(pos.symbol, "1mo", "1d").catch((err: any) => {
          log.warn({ symbol: pos.symbol, error: err.message }, "Failed to fetch historical bars, ATR will be 0");
          return [];
        }),
      ]);

      const atr = calculateATR(bars, 14);

      return { ...pos, marketValue, sector, beta, atr };
    })
  );

  const grossExposure = enrichedPositions.reduce((sum, p) => sum + Math.abs(p.marketValue), 0);
  const netExposure = enrichedPositions.reduce((sum, p) => sum + p.marketValue, 0);
  const percentDeployed = netLiquidation > 0 ? (grossExposure / netLiquidation) * 100 : 0;

  let largestPosition: string | null = null;
  let largestPositionValue = 0;
  for (const pos of enrichedPositions) {
    const absValue = Math.abs(pos.marketValue);
    if (absValue > largestPositionValue) {
      largestPositionValue = absValue;
      largestPosition = pos.symbol;
    }
  }
  const largestPositionPercent = netLiquidation > 0 ? (largestPositionValue / netLiquidation) * 100 : 0;

  const sectorTotals = new Map<string, number>();
  for (const pos of enrichedPositions) {
    const sector = pos.sector ?? "Unknown";
    const absValue = Math.abs(pos.marketValue);
    sectorTotals.set(sector, (sectorTotals.get(sector) ?? 0) + absValue);
  }

  const sectorBreakdown: Record<string, number> = {};
  for (const [sector, total] of sectorTotals.entries()) {
    const percentage = grossExposure > 0 ? (total / grossExposure) * 100 : 0;
    sectorBreakdown[sector] = Math.round(percentage * 10) / 10;
  }

  const betaWeightedExposure = enrichedPositions.reduce(
    (sum, p) => sum + p.marketValue * p.beta,
    0
  );

  const portfolioHeat = enrichedPositions.reduce((sum, p) => {
    const stopDistance = p.atr * 2;
    const heat = Math.abs(p.position) * stopDistance;
    return sum + heat;
  }, 0);

  return {
    grossExposure: Math.round(grossExposure),
    netExposure: Math.round(netExposure),
    percentDeployed: Math.round(percentDeployed * 10) / 10,
    largestPositionPercent: Math.round(largestPositionPercent * 10) / 10,
    largestPosition,
    sectorBreakdown,
    betaWeightedExposure: Math.round(betaWeightedExposure),
    portfolioHeat: Math.round(portfolioHeat),
    positionCount: positions.length,
    netLiquidation: Math.round(netLiquidation),
  };
}
