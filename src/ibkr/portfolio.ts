import { getPositions, getAccountSummary, type PositionData } from "./account.js";
import { getContractDetails, type ContractDetailsData } from "./contracts.js";
import { getHistoricalBars, type BarData, getQuote } from "../providers/yahoo.js";
import { logger } from "../logging.js";

const logPortfolio = logger.child({ subsystem: "portfolio" });

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
  
  // Fetch fresh data
  try {
    const details = await getContractDetails({ symbol });
    if (details.length > 0) {
      const firstDetail = details[0];
      contractCache.set(symbol, { data: firstDetail, timestamp: now });
      return firstDetail;
    }
  } catch {
    // If fetch fails but we have stale cache, use it
    if (cached) {
      return cached.data;
    }
  }
  
  return null;
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

// ─── Beta Calculation (Correlation with SPY) ──────────────────

function calculateReturns(bars: BarData[]): number[] {
  const returns: number[] = [];
  for (let i = 1; i < bars.length; i++) {
    const prev = bars[i - 1].close;
    const curr = bars[i].close;
    if (prev > 0) {
      returns.push((curr - prev) / prev);
    }
  }
  return returns;
}

function calculateCovariance(x: number[], y: number[]): number {
  if (x.length !== y.length || x.length === 0) return 0;
  
  const meanX = x.reduce((sum, val) => sum + val, 0) / x.length;
  const meanY = y.reduce((sum, val) => sum + val, 0) / y.length;
  
  let cov = 0;
  for (let i = 0; i < x.length; i++) {
    cov += (x[i] - meanX) * (y[i] - meanY);
  }
  
  return cov / x.length;
}

function calculateVariance(x: number[]): number {
  if (x.length === 0) return 0;
  
  const mean = x.reduce((sum, val) => sum + val, 0) / x.length;
  let variance = 0;
  
  for (let i = 0; i < x.length; i++) {
    variance += Math.pow(x[i] - mean, 2);
  }
  
  return variance / x.length;
}

export async function calculateBeta(symbol: string, days: number = 20): Promise<number> {
  try {
    // Fetch historical bars for both the stock and SPY
    const [stockBars, spyBars] = await Promise.all([
      getHistoricalBars(symbol, "1mo", "1d"),
      getHistoricalBars("SPY", "1mo", "1d"),
    ]);
    
    // Take the last 'days' bars
    const stockRecent = stockBars.slice(-days);
    const spyRecent = spyBars.slice(-days);
    
    if (stockRecent.length < 2 || spyRecent.length < 2) return 1.0;
    
    // Calculate returns
    const stockReturns = calculateReturns(stockRecent);
    const spyReturns = calculateReturns(spyRecent);
    
    if (stockReturns.length !== spyReturns.length || stockReturns.length === 0) return 1.0;
    
    // Beta = Covariance(stock, SPY) / Variance(SPY)
    const cov = calculateCovariance(stockReturns, spyReturns);
    const variance = calculateVariance(spyReturns);
    
    if (variance === 0) return 1.0;
    
    const beta = cov / variance;
    
    // Round to 2 decimals
    return Math.round(beta * 100) / 100;
  } catch {
    // Default to beta of 1.0 on error
    return 1.0;
  }
}

// ─── Portfolio Exposure Response ──────────────────────────────

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

// ─── Main Exposure Computation ────────────────────────────────

export async function computePortfolioExposure(): Promise<PortfolioExposureResponse> {
  // Fetch positions and account summary
  const [positions, summary] = await Promise.all([
    getPositions(),
    getAccountSummary(),
  ]);
  
  const netLiquidation = summary.netLiquidation ?? 0;
  
  // If no positions, return zeroed response
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
  
  // Enrich positions with market value, sector, beta, and ATR
  const enrichedPositions: PositionWithValue[] = await Promise.all(
    positions.map(async (pos) => {
      // Get current price from quote
      let quote;
      let currentPrice = pos.avgCost; // Default to avgCost
      try {
        quote = await getQuote(pos.symbol);
        currentPrice = quote.last ?? pos.avgCost;
      } catch (err: any) {
        logPortfolio.warn(
          { symbol: pos.symbol, error: err.message },
          `Failed to fetch quote for ${pos.symbol}, using avgCost as fallback`
        );
      }
      const marketValue = pos.position * currentPrice;
      
      // Get contract details for sector
      const contractDetails = await getCachedContractDetails(pos.symbol);
      const sector = contractDetails?.category ?? null;
      
      // Calculate beta and ATR in parallel
      const [beta, bars] = await Promise.all([
        calculateBeta(pos.symbol),
        getHistoricalBars(pos.symbol, "1mo", "1d").catch((err: any) => {
          logPortfolio.warn(
            { symbol: pos.symbol, error: err.message },
            `Failed to fetch historical bars for ${pos.symbol}, ATR will be 0`
          );
          return [];
        }),
      ]);
      
      const atr = calculateATR(bars, 14);
      
      return {
        ...pos,
        marketValue,
        sector,
        beta,
        atr,
      };
    })
  );
  
  // Compute metrics
  const grossExposure = enrichedPositions.reduce((sum, p) => sum + Math.abs(p.marketValue), 0);
  const netExposure = enrichedPositions.reduce((sum, p) => sum + p.marketValue, 0);
  const percentDeployed = netLiquidation > 0 ? (grossExposure / netLiquidation) * 100 : 0;
  
  // Find largest position
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
  
  // Sector breakdown (as % of gross exposure)
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
  
  // Beta-weighted exposure
  const betaWeightedExposure = enrichedPositions.reduce(
    (sum, p) => sum + p.marketValue * p.beta,
    0
  );
  
  // Portfolio heat (sum of position size * 2x ATR as estimated stop distance)
  const portfolioHeat = enrichedPositions.reduce((sum, p) => {
    const stopDistance = p.atr * 2; // Estimate stop as 2x ATR
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
