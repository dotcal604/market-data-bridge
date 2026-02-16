import { getAccountSummary, type AccountSummaryData } from "./account.js";
import { getRiskConfigRows } from "../db/database.js";
import { RISK_CONFIG_DEFAULTS } from "../db/schema.js";
import { logRisk } from "../logging.js";

export interface PositionSizeRequest {
  symbol: string;
  entryPrice: number;
  stopPrice: number;
  riskPercent?: number;
  riskAmount?: number;
  maxCapitalPercent?: number;
  /** Current volatility regime — "low", "normal", "high". Scales position down in high-vol. */
  volatilityRegime?: string;
}

export interface PositionSizeResponse {
  symbol: string;
  recommendedShares: number;
  riskPerShare: number;
  totalRisk: number;
  totalCapital: number;
  percentOfEquity: number;
  sizing: {
    byRisk: number;
    byCapital: number;
    byMargin: number;
    byConfig: number;
    binding: "byRisk" | "byCapital" | "byMargin" | "byConfig";
  };
  regime: string;
  volatilityScalar: number;
  warnings: string[];
  netLiquidation: number;
}

const DEFAULT_RISK_PERCENT = 1.0;
const DEFAULT_MAX_CAPITAL_PERCENT = 10.0;
const MARGIN_MULTIPLIER = 0.25; // 25% initial margin estimate for RegT
const LARGE_GAP_THRESHOLD = 0.20; // 20% gap between entry and stop
const LARGE_GAP_REDUCTION = 0.50; // 50% size reduction for large gaps

// Regime-based scaling factors applied to position size
const REGIME_SCALARS: Record<string, number> = {
  low: 1.0,     // full size in low-vol regime
  normal: 0.75, // 75% in normal vol
  high: 0.5,    // 50% in high vol
};

/** Load effective risk config from DB (tuned values) with defaults fallback */
function loadTunedRiskConfig(): { max_position_pct: number; volatility_scalar: number } {
  try {
    const rows = getRiskConfigRows();
    const byParam = new Map(rows.map((r) => [r.param, r.value]));
    return {
      max_position_pct: byParam.get("max_position_pct") ?? RISK_CONFIG_DEFAULTS.max_position_pct,
      volatility_scalar: byParam.get("volatility_scalar") ?? RISK_CONFIG_DEFAULTS.volatility_scalar,
    };
  } catch {
    return {
      max_position_pct: RISK_CONFIG_DEFAULTS.max_position_pct,
      volatility_scalar: RISK_CONFIG_DEFAULTS.volatility_scalar,
    };
  }
}

export async function calculatePositionSize(
  request: PositionSizeRequest
): Promise<PositionSizeResponse> {
  const tunedConfig = loadTunedRiskConfig();

  const {
    symbol,
    entryPrice,
    stopPrice,
    riskPercent = DEFAULT_RISK_PERCENT,
    riskAmount,
    maxCapitalPercent = DEFAULT_MAX_CAPITAL_PERCENT,
  } = request;

  // Validate inputs
  if (entryPrice <= 0) {
    throw new Error("Entry price must be positive");
  }
  if (stopPrice < 0) {
    throw new Error("Stop price must be non-negative");
  }
  if (riskPercent !== undefined && (riskPercent <= 0 || riskPercent > 100)) {
    throw new Error("Risk percent must be a positive number between 0 (exclusive) and 100");
  }
  if (maxCapitalPercent <= 0 || maxCapitalPercent > 100) {
    throw new Error("Max capital percent must be between 0 and 100");
  }

  // Get account data
  const account: AccountSummaryData = await getAccountSummary();
  const netLiq = account.netLiquidation ?? 0;
  const availableFunds = account.availableFunds ?? 0;

  if (netLiq <= 0) {
    throw new Error("Net liquidation value must be positive");
  }

  const warnings: string[] = [];

  // Calculate risk per share
  const riskPerShare = Math.abs(entryPrice - stopPrice);

  // Handle zero or very small risk per share
  if (riskPerShare === 0) {
    logRisk.warn(
      { symbol, entryPrice, stopPrice },
      "Stop price equals entry price — zero risk per share"
    );
    return {
      symbol,
      recommendedShares: 0,
      riskPerShare: 0,
      totalRisk: 0,
      totalCapital: 0,
      percentOfEquity: 0,
      sizing: {
        byRisk: 0,
        byCapital: 0,
        byMargin: 0,
        byConfig: 0,
        binding: "byRisk",
      },
      regime: request.volatilityRegime ?? "normal",
      volatilityScalar: 1,
      warnings: ["Stop price equals entry price - no risk buffer defined"],
      netLiquidation: netLiq,
    };
  }

  // Determine risk budget
  const riskBudget = riskAmount ?? (netLiq * riskPercent) / 100;

  // Calculate shares by each constraint
  let sharesByRisk = Math.floor(riskBudget / riskPerShare);
  const sharesByCapital = Math.floor((netLiq * maxCapitalPercent) / 100 / entryPrice);
  const sharesByMargin = Math.floor(availableFunds / (entryPrice * MARGIN_MULTIPLIER));

  // Check for large gap between entry and stop
  const gapPercent = Math.abs((entryPrice - stopPrice) / entryPrice);
  let appliedReduction = false;
  if (gapPercent > LARGE_GAP_THRESHOLD) {
    const originalShares = sharesByRisk;
    sharesByRisk = Math.floor(sharesByRisk * LARGE_GAP_REDUCTION);
    const actualReduction = ((originalShares - sharesByRisk) / originalShares * 100).toFixed(0);
    warnings.push(
      `Large gap detected (${(gapPercent * 100).toFixed(1)}%) — size reduced by ${actualReduction}% from ${originalShares} to ${sharesByRisk} shares`
    );
    appliedReduction = true;
    logRisk.warn(
      { symbol, entryPrice, stopPrice, gapPercent, originalShares, reducedShares: sharesByRisk },
      "Large gap between entry and stop — auto-reduced position size"
    );
  }

  // Apply tuned max_position_pct cap from risk_config
  const maxSharesByConfig = Math.floor((netLiq * tunedConfig.max_position_pct) / entryPrice);

  // Find the binding constraint (now includes tuned config cap)
  const constraints = [
    { name: "byRisk" as const, shares: sharesByRisk },
    { name: "byCapital" as const, shares: sharesByCapital },
    { name: "byMargin" as const, shares: sharesByMargin },
    { name: "byConfig" as const, shares: maxSharesByConfig },
  ];
  const binding = constraints.reduce((min, curr) =>
    curr.shares < min.shares ? curr : min
  );
  let recommendedShares = Math.max(0, binding.shares);

  // Apply regime-based volatility scaling
  const regime = request.volatilityRegime ?? "normal";
  const regimeScalar = REGIME_SCALARS[regime] ?? 0.75;
  const volScalar = tunedConfig.volatility_scalar;
  const combinedScalar = regimeScalar * volScalar;

  if (combinedScalar < 1.0) {
    const preScaleShares = recommendedShares;
    recommendedShares = Math.floor(recommendedShares * combinedScalar);
    if (preScaleShares !== recommendedShares) {
      warnings.push(
        `Volatility-scaled: ${preScaleShares} → ${recommendedShares} shares (regime=${regime}, scalar=${combinedScalar.toFixed(2)})`,
      );
    }
  }

  // Calculate totals
  const totalCapital = recommendedShares * entryPrice;
  const totalRisk = recommendedShares * riskPerShare;
  const percentOfEquity = (totalCapital / netLiq) * 100;

  // Additional warnings
  if (recommendedShares === 0) {
    warnings.push("Position too risky for current account size");
  }
  if (availableFunds < entryPrice) {
    warnings.push("Insufficient available funds");
  }

  logRisk.info(
    {
      symbol,
      entryPrice,
      stopPrice,
      recommendedShares,
      binding: binding.name,
      regime,
      combinedScalar,
      riskPerShare,
      totalRisk,
      percentOfEquity,
      warnings,
    },
    `Position size calculated: ${recommendedShares} shares (${binding.name}, regime=${regime})`,
  );

  return {
    symbol,
    recommendedShares,
    riskPerShare,
    totalRisk,
    totalCapital,
    percentOfEquity,
    sizing: {
      byRisk: sharesByRisk,
      byCapital: sharesByCapital,
      byMargin: sharesByMargin,
      byConfig: maxSharesByConfig,
      binding: binding.name,
    },
    regime,
    volatilityScalar: combinedScalar,
    warnings,
    netLiquidation: netLiq,
  };
}
