import { getRiskConfigRows } from "../db/database.js";
import { RISK_CONFIG_DEFAULTS } from "../db/schema.js";
import { logRisk } from "../logging.js";
import { config } from "../config.js";

const ACCOUNT_EQUITY_BASE = parseFloat(process.env.RISK_ACCOUNT_EQUITY_BASE ?? "25000");

const LIMITS = {
  maxOrderSize: parseInt(process.env.RISK_MAX_ORDER_SIZE ?? "1000", 10),
  maxNotionalValue: parseFloat(process.env.RISK_MAX_NOTIONAL ?? "50000"),
  maxOrdersPerMinute: parseInt(process.env.RISK_MAX_ORDERS_PER_MIN ?? "5", 10),
  minSharePrice: parseFloat(process.env.RISK_MIN_PRICE ?? "1"),
};

const SESSION_LIMITS = {
  maxDailyLoss: parseFloat(process.env.RISK_MAX_DAILY_LOSS ?? "500"),
  maxDailyTrades: parseInt(process.env.RISK_MAX_DAILY_TRADES ?? "20", 10),
  consecutiveLossLimit: parseInt(process.env.RISK_CONSEC_LOSS_LIMIT ?? "3", 10),
  cooldownMinutes: parseInt(process.env.RISK_COOLDOWN_MINUTES ?? "15", 10),
  lateDayLockoutMinutes: parseInt(process.env.RISK_LATE_LOCKOUT_MIN ?? "15", 10),
  marketOpenHour: 9,
  marketOpenMinute: 30,
  marketCloseHour: 16,
  marketCloseMinute: 0,
};

const MANUAL_RISK_LIMITS = {
  max_position_pct: parseFloat(process.env.RISK_MAX_POSITION_PCT ?? `${RISK_CONFIG_DEFAULTS.max_position_pct}`),
  max_daily_loss_pct: parseFloat(process.env.RISK_MAX_DAILY_LOSS_PCT ?? `${RISK_CONFIG_DEFAULTS.max_daily_loss_pct}`),
  max_concentration_pct: parseFloat(process.env.RISK_MAX_CONCENTRATION_PCT ?? `${RISK_CONFIG_DEFAULTS.max_concentration_pct}`),
  volatility_scalar: parseFloat(process.env.RISK_VOLATILITY_SCALAR ?? `${RISK_CONFIG_DEFAULTS.volatility_scalar}`),
};

interface EffectiveRiskConfig {
  max_position_pct: number;
  max_daily_loss_pct: number;
  max_concentration_pct: number;
  volatility_scalar: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function getEffectiveRiskConfig(): EffectiveRiskConfig {
  const rows = getRiskConfigRows();
  const dbValues: Partial<EffectiveRiskConfig> = {};
  rows.forEach((row) => {
    if (row.param in RISK_CONFIG_DEFAULTS) {
      (dbValues as Record<string, number>)[row.param] = row.value;
    }
  });

  const maxPositionPct = Math.min(
    RISK_CONFIG_DEFAULTS.max_position_pct,
    MANUAL_RISK_LIMITS.max_position_pct,
    dbValues.max_position_pct ?? RISK_CONFIG_DEFAULTS.max_position_pct
  );
  const maxDailyLossPct = Math.min(
    RISK_CONFIG_DEFAULTS.max_daily_loss_pct,
    MANUAL_RISK_LIMITS.max_daily_loss_pct,
    dbValues.max_daily_loss_pct ?? RISK_CONFIG_DEFAULTS.max_daily_loss_pct
  );
  const maxConcentrationPct = Math.min(
    RISK_CONFIG_DEFAULTS.max_concentration_pct,
    MANUAL_RISK_LIMITS.max_concentration_pct,
    dbValues.max_concentration_pct ?? RISK_CONFIG_DEFAULTS.max_concentration_pct
  );
  const volatilityScalar = Math.min(
    RISK_CONFIG_DEFAULTS.volatility_scalar,
    MANUAL_RISK_LIMITS.volatility_scalar,
    dbValues.volatility_scalar ?? RISK_CONFIG_DEFAULTS.volatility_scalar
  );

  return {
    max_position_pct: clamp(maxPositionPct, 0.001, RISK_CONFIG_DEFAULTS.max_position_pct),
    max_daily_loss_pct: clamp(maxDailyLossPct, 0.001, RISK_CONFIG_DEFAULTS.max_daily_loss_pct),
    max_concentration_pct: clamp(maxConcentrationPct, 0.01, RISK_CONFIG_DEFAULTS.max_concentration_pct),
    volatility_scalar: clamp(volatilityScalar, 0.1, RISK_CONFIG_DEFAULTS.volatility_scalar),
  };
}

/**
 * Get current risk configuration.
 * @returns Object with effective, floor, manual, and raw DB config
 */
export function getRiskGateConfig(): {
  effective: EffectiveRiskConfig;
  floors: typeof RISK_CONFIG_DEFAULTS;
  manual: typeof MANUAL_RISK_LIMITS;
  rows: ReturnType<typeof getRiskConfigRows>;
} {
  return {
    effective: getEffectiveRiskConfig(),
    floors: { ...RISK_CONFIG_DEFAULTS },
    manual: { ...MANUAL_RISK_LIMITS },
    rows: getRiskConfigRows(),
  };
}

interface SessionState {
  date: string;
  realizedPnl: number;
  tradeCount: number;
  consecutiveLosses: number;
  lastTradeTime: number;
  lastLossTime: number;
  locked: boolean;
  lockReason: string | null;
}

function getTodayET(): string {
  const now = new Date();
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

function getNowET(): { hours: number; minutes: number } {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  }).formatToParts(now);
  const hours = parseInt(parts.find((p) => p.type === "hour")?.value ?? "0", 10);
  const minutes = parseInt(parts.find((p) => p.type === "minute")?.value ?? "0", 10);
  return { hours, minutes };
}

function freshSession(date: string): SessionState {
  return {
    date,
    realizedPnl: 0,
    tradeCount: 0,
    consecutiveLosses: 0,
    lastTradeTime: 0,
    lastLossTime: 0,
    locked: false,
    lockReason: null,
  };
}

let session: SessionState = freshSession(getTodayET());

function ensureToday(): void {
  const today = getTodayET();
  if (session.date !== today) {
    logRisk.info({ oldDate: session.date, newDate: today }, "Session auto-reset: new trading day");
    session = freshSession(today);
  }
}

const recentOrderTimestamps: number[] = [];

export interface RiskCheckParams {
  symbol: string;
  action: string;
  orderType: string;
  totalQuantity: number;
  lmtPrice?: number;
  auxPrice?: number;
  secType?: string;
  estimatedPrice?: number;
}

export interface RiskCheckResult {
  allowed: boolean;
  reason?: string;
}

/**
 * Validate a proposed order against risk limits.
 * @param params Order parameters
 * @returns Risk check result (allowed: boolean)
 */
export function checkRisk(params: RiskCheckParams): RiskCheckResult {
  // Paper trading bypasses all risk gates — safe to test freely
  const paperPorts = new Set([7497, 4002]);
  if (paperPorts.has(config.ibkr.port)) {
    return { allowed: true };
  }

  ensureToday();
  const effective = getEffectiveRiskConfig();
  const dynamicMaxNotional = Math.min(
    LIMITS.maxNotionalValue,
    ACCOUNT_EQUITY_BASE * Math.min(effective.max_position_pct, effective.max_concentration_pct) * effective.volatility_scalar
  );
  const dynamicMaxDailyLoss = Math.min(SESSION_LIMITS.maxDailyLoss, ACCOUNT_EQUITY_BASE * effective.max_daily_loss_pct);

  if (session.locked) {
    const reason = `Session locked: ${session.lockReason ?? "manual override"}`;
    logRisk.warn({ ...params }, reason);
    return { allowed: false, reason };
  }

  if (session.realizedPnl <= -dynamicMaxDailyLoss) {
    const reason = `Daily loss limit hit: $${session.realizedPnl.toFixed(2)} realized (max -$${dynamicMaxDailyLoss.toFixed(2)})`;
    logRisk.warn({ ...params, pnl: session.realizedPnl }, reason);
    return { allowed: false, reason };
  }

  if (session.tradeCount >= SESSION_LIMITS.maxDailyTrades) {
    const reason = `Daily trade limit hit: ${session.tradeCount}/${SESSION_LIMITS.maxDailyTrades} trades`;
    logRisk.warn({ ...params, count: session.tradeCount }, reason);
    return { allowed: false, reason };
  }

  if (session.consecutiveLosses >= SESSION_LIMITS.consecutiveLossLimit && session.lastLossTime > 0) {
    const cooldownMs = SESSION_LIMITS.cooldownMinutes * 60_000;
    const elapsed = Date.now() - session.lastLossTime;
    if (elapsed < cooldownMs) {
      const remaining = Math.ceil((cooldownMs - elapsed) / 60_000);
      const reason = `Cooldown active: ${session.consecutiveLosses} consecutive losses — ${remaining} min remaining`;
      logRisk.warn({ ...params, consecutive: session.consecutiveLosses, remaining }, reason);
      return { allowed: false, reason };
    }
  }

  const et = getNowET();
  const minutesSinceOpen =
    (et.hours - SESSION_LIMITS.marketOpenHour) * 60 +
    (et.minutes - SESSION_LIMITS.marketOpenMinute);
  const minutesBeforeClose =
    (SESSION_LIMITS.marketCloseHour - et.hours) * 60 +
    (SESSION_LIMITS.marketCloseMinute - et.minutes);

  if (minutesBeforeClose <= SESSION_LIMITS.lateDayLockoutMinutes && minutesBeforeClose >= 0) {
    const reason = `Late-day lockout: ${minutesBeforeClose} min before close (lockout at ${SESSION_LIMITS.lateDayLockoutMinutes} min)`;
    logRisk.warn({ ...params, minutesBeforeClose }, reason);
    return { allowed: false, reason };
  }

  if (minutesSinceOpen < 0 || minutesBeforeClose < 0) {
    const reason = `Outside regular trading hours (${et.hours}:${String(et.minutes).padStart(2, "0")} ET)`;
    logRisk.warn({ ...params, time: `${et.hours}:${et.minutes}` }, reason);
    return { allowed: false, reason };
  }

  if (params.totalQuantity > LIMITS.maxOrderSize) {
    const reason = `Order size ${params.totalQuantity} exceeds max ${LIMITS.maxOrderSize} shares`;
    logRisk.warn({ ...params, limit: LIMITS.maxOrderSize }, reason);
    return { allowed: false, reason };
  }

  const price = params.estimatedPrice ?? params.lmtPrice ?? params.auxPrice ?? 0;
  if (price > 0) {
    const notional = params.totalQuantity * price;
    if (notional > dynamicMaxNotional) {
      const reason = `Notional value $${notional.toFixed(2)} exceeds max $${dynamicMaxNotional.toFixed(2)}`;
      logRisk.warn({ ...params, notional, limit: dynamicMaxNotional }, reason);
      return { allowed: false, reason };
    }
  }

  const now = Date.now();
  const oneMinuteAgo = now - 60_000;
  while (recentOrderTimestamps.length > 0 && recentOrderTimestamps[0] < oneMinuteAgo) {
    recentOrderTimestamps.shift();
  }
  if (recentOrderTimestamps.length >= LIMITS.maxOrdersPerMinute) {
    const reason = `Order frequency ${recentOrderTimestamps.length}/${LIMITS.maxOrdersPerMinute} per minute exceeded`;
    logRisk.warn({ ...params, recent: recentOrderTimestamps.length, limit: LIMITS.maxOrdersPerMinute }, reason);
    return { allowed: false, reason };
  }

  if (price > 0 && price < LIMITS.minSharePrice) {
    const reason = `Share price $${price} below minimum $${LIMITS.minSharePrice} — penny stock rejected`;
    logRisk.warn({ ...params, price, limit: LIMITS.minSharePrice }, reason);
    return { allowed: false, reason };
  }

  recentOrderTimestamps.push(now);
  logRisk.debug({ symbol: params.symbol, action: params.action, qty: params.totalQuantity }, "Risk check passed");
  return { allowed: true };
}

/**
 * Update session state with a completed trade result.
 * @param realizedPnl Profit/Loss from the trade
 */
export function recordTradeResult(realizedPnl: number): void {
  ensureToday();
  session.realizedPnl += realizedPnl;
  session.tradeCount += 1;
  session.lastTradeTime = Date.now();

  if (realizedPnl < 0) {
    session.consecutiveLosses += 1;
    session.lastLossTime = Date.now();
    logRisk.info(
      { pnl: realizedPnl, consecutive: session.consecutiveLosses, dailyPnl: session.realizedPnl },
      `Loss recorded: ${session.consecutiveLosses} consecutive`
    );
  } else {
    session.consecutiveLosses = 0;
    logRisk.info({ pnl: realizedPnl, dailyPnl: session.realizedPnl }, "Win recorded — consecutive loss counter reset");
  }
}

/**
 * Manually lock the trading session (prevent further trades).
 * @param reason Reason for lock
 */
export function lockSession(reason?: string): void {
  ensureToday();
  session.locked = true;
  session.lockReason = reason ?? "manual lock";
  logRisk.warn({ reason: session.lockReason }, "Session manually locked");
}

/**
 * Manually unlock the trading session.
 */
export function unlockSession(): void {
  ensureToday();
  session.locked = false;
  session.lockReason = null;
  logRisk.info({}, "Session unlocked");
}

/**
 * Reset session stats (PnL, trade count, etc) to zero.
 */
export function resetSession(): void {
  session = freshSession(getTodayET());
  logRisk.info({}, "Session state reset");
}

/**
 * Get current session metrics and limits.
 * @returns Session state object
 */
export function getSessionState(): SessionState & { limits: typeof SESSION_LIMITS } {
  ensureToday();
  return { ...session, limits: { ...SESSION_LIMITS } };
}

/**
 * Get all active risk limits (static + dynamic).
 * @returns Risk limits object
 */
export function getRiskLimits() {
  const effective = getEffectiveRiskConfig();
  return {
    ...LIMITS,
    ...SESSION_LIMITS,
    maxNotionalValue: Math.min(
      LIMITS.maxNotionalValue,
      ACCOUNT_EQUITY_BASE * Math.min(effective.max_position_pct, effective.max_concentration_pct) * effective.volatility_scalar
    ),
    maxDailyLoss: Math.min(SESSION_LIMITS.maxDailyLoss, ACCOUNT_EQUITY_BASE * effective.max_daily_loss_pct),
    riskConfig: effective,
  };
}

export const _testing = {
  getNowET,
  getTodayET,
  getSession: () => session,
  setSession: (s: SessionState) => { session = s; },
  freshSession,
};
