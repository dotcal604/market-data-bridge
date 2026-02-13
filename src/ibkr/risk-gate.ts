import { logRisk } from "../logging.js";

// Configurable limits — override via env or data/risk-config.json
const LIMITS = {
  maxOrderSize: parseInt(process.env.RISK_MAX_ORDER_SIZE ?? "1000", 10),
  maxNotionalValue: parseFloat(process.env.RISK_MAX_NOTIONAL ?? "50000"),
  maxOrdersPerMinute: parseInt(process.env.RISK_MAX_ORDERS_PER_MIN ?? "5", 10),
  minSharePrice: parseFloat(process.env.RISK_MIN_PRICE ?? "1"),
};

// Sliding window for order frequency
const recentOrderTimestamps: number[] = [];

export interface RiskCheckParams {
  symbol: string;
  action: string;
  orderType: string;
  totalQuantity: number;
  lmtPrice?: number;
  auxPrice?: number;
  secType?: string;
  estimatedPrice?: number; // current market price for notional calculation
}

export interface RiskCheckResult {
  allowed: boolean;
  reason?: string;
}

export function checkRisk(params: RiskCheckParams): RiskCheckResult {
  // 1. Max order size
  if (params.totalQuantity > LIMITS.maxOrderSize) {
    const reason = `Order size ${params.totalQuantity} exceeds max ${LIMITS.maxOrderSize} shares`;
    logRisk.warn({ ...params, limit: LIMITS.maxOrderSize }, reason);
    return { allowed: false, reason };
  }

  // 2. Max notional value
  const price = params.estimatedPrice ?? params.lmtPrice ?? params.auxPrice ?? 0;
  if (price > 0) {
    const notional = params.totalQuantity * price;
    if (notional > LIMITS.maxNotionalValue) {
      const reason = `Notional value $${notional.toFixed(2)} exceeds max $${LIMITS.maxNotionalValue}`;
      logRisk.warn({ ...params, notional, limit: LIMITS.maxNotionalValue }, reason);
      return { allowed: false, reason };
    }
  }

  // 3. Max orders per minute
  const now = Date.now();
  const oneMinuteAgo = now - 60_000;
  // Prune old timestamps
  while (recentOrderTimestamps.length > 0 && recentOrderTimestamps[0] < oneMinuteAgo) {
    recentOrderTimestamps.shift();
  }
  if (recentOrderTimestamps.length >= LIMITS.maxOrdersPerMinute) {
    const reason = `Order frequency ${recentOrderTimestamps.length}/${LIMITS.maxOrdersPerMinute} per minute exceeded`;
    logRisk.warn({ ...params, recent: recentOrderTimestamps.length, limit: LIMITS.maxOrdersPerMinute }, reason);
    return { allowed: false, reason };
  }

  // 4. Penny stock / minimum price check (skip for MKT orders without price info)
  if (price > 0 && price < LIMITS.minSharePrice) {
    const reason = `Share price $${price} below minimum $${LIMITS.minSharePrice} — penny stock rejected`;
    logRisk.warn({ ...params, price, limit: LIMITS.minSharePrice }, reason);
    return { allowed: false, reason };
  }

  // All checks passed — record timestamp
  recentOrderTimestamps.push(now);
  logRisk.debug({ symbol: params.symbol, action: params.action, qty: params.totalQuantity }, "Risk check passed");
  return { allowed: true };
}

export function getRiskLimits() {
  return { ...LIMITS };
}
