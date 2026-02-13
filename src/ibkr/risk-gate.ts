import { logRisk } from "../logging.js";

// ── Per-Order Limits ────────────────────────────────────────────────────────

const LIMITS = {
  maxOrderSize: parseInt(process.env.RISK_MAX_ORDER_SIZE ?? "1000", 10),
  maxNotionalValue: parseFloat(process.env.RISK_MAX_NOTIONAL ?? "50000"),
  maxOrdersPerMinute: parseInt(process.env.RISK_MAX_ORDERS_PER_MIN ?? "5", 10),
  minSharePrice: parseFloat(process.env.RISK_MIN_PRICE ?? "1"),
};

// ── Session Limits (the ones that actually change PnL) ──────────────────────

const SESSION_LIMITS = {
  maxDailyLoss: parseFloat(process.env.RISK_MAX_DAILY_LOSS ?? "500"),         // $ — stop trading after this much realized loss
  maxDailyTrades: parseInt(process.env.RISK_MAX_DAILY_TRADES ?? "20", 10),    // count — prevent overtrading
  consecutiveLossLimit: parseInt(process.env.RISK_CONSEC_LOSS_LIMIT ?? "3", 10), // after N consecutive losses...
  cooldownMinutes: parseInt(process.env.RISK_COOLDOWN_MINUTES ?? "15", 10),   // ...wait this many minutes
  lateDayLockoutMinutes: parseInt(process.env.RISK_LATE_LOCKOUT_MIN ?? "15", 10), // no new entries within N min of close (16:00 ET)
  marketOpenHour: 9,   // ET
  marketOpenMinute: 30, // ET
  marketCloseHour: 16,  // ET
  marketCloseMinute: 0, // ET
};

// ── Session State (in-memory, resets daily) ─────────────────────────────────

interface SessionState {
  date: string;           // YYYY-MM-DD in ET
  realizedPnl: number;
  tradeCount: number;
  consecutiveLosses: number;
  lastTradeTime: number;  // Date.now() timestamp
  lastLossTime: number;   // timestamp of most recent loss
  locked: boolean;        // manual override: session locked
  lockReason: string | null;
}

function getTodayET(): string {
  // Get current date in US Eastern
  const now = new Date();
  const et = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  return et; // "YYYY-MM-DD"
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
  ensureToday();

  // ── Session-level checks (behavioral guardrails) ──────────────────────

  // S1. Manual lock
  if (session.locked) {
    const reason = `Session locked: ${session.lockReason ?? "manual override"}`;
    logRisk.warn({ ...params }, reason);
    return { allowed: false, reason };
  }

  // S2. Daily loss limit
  if (session.realizedPnl <= -SESSION_LIMITS.maxDailyLoss) {
    const reason = `Daily loss limit hit: $${session.realizedPnl.toFixed(2)} realized (max -$${SESSION_LIMITS.maxDailyLoss})`;
    logRisk.warn({ ...params, pnl: session.realizedPnl }, reason);
    return { allowed: false, reason };
  }

  // S3. Max daily trades
  if (session.tradeCount >= SESSION_LIMITS.maxDailyTrades) {
    const reason = `Daily trade limit hit: ${session.tradeCount}/${SESSION_LIMITS.maxDailyTrades} trades`;
    logRisk.warn({ ...params, count: session.tradeCount }, reason);
    return { allowed: false, reason };
  }

  // S4. Consecutive loss cooldown
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

  // S5. Late-day lockout
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

  // S6. Pre-market / after-hours block (only allow during RTH)
  if (minutesSinceOpen < 0 || minutesBeforeClose < 0) {
    const reason = `Outside regular trading hours (${et.hours}:${String(et.minutes).padStart(2, "0")} ET)`;
    logRisk.warn({ ...params, time: `${et.hours}:${et.minutes}` }, reason);
    return { allowed: false, reason };
  }

  // ── Per-order checks ──────────────────────────────────────────────────

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
  while (recentOrderTimestamps.length > 0 && recentOrderTimestamps[0] < oneMinuteAgo) {
    recentOrderTimestamps.shift();
  }
  if (recentOrderTimestamps.length >= LIMITS.maxOrdersPerMinute) {
    const reason = `Order frequency ${recentOrderTimestamps.length}/${LIMITS.maxOrdersPerMinute} per minute exceeded`;
    logRisk.warn({ ...params, recent: recentOrderTimestamps.length, limit: LIMITS.maxOrdersPerMinute }, reason);
    return { allowed: false, reason };
  }

  // 4. Penny stock / minimum price check
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

// ── Session State Management ────────────────────────────────────────────────

/**
 * Call this after a trade completes to update session state.
 * realizedPnl: the P&L of this individual trade (positive = win, negative = loss)
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
    logRisk.info(
      { pnl: realizedPnl, dailyPnl: session.realizedPnl },
      "Win recorded — consecutive loss counter reset"
    );
  }
}

/** Lock the session manually (e.g., "I'm tilting, stop me"). */
export function lockSession(reason?: string): void {
  ensureToday();
  session.locked = true;
  session.lockReason = reason ?? "manual lock";
  logRisk.warn({ reason: session.lockReason }, "Session manually locked");
}

/** Unlock the session. */
export function unlockSession(): void {
  ensureToday();
  session.locked = false;
  session.lockReason = null;
  logRisk.info({}, "Session unlocked");
}

/** Reset session state (new day or manual reset). */
export function resetSession(): void {
  session = freshSession(getTodayET());
  logRisk.info({}, "Session state reset");
}

/** Get current session state for display. */
export function getSessionState(): SessionState & { limits: typeof SESSION_LIMITS } {
  ensureToday();
  return { ...session, limits: { ...SESSION_LIMITS } };
}

export function getRiskLimits() {
  return { ...LIMITS, ...SESSION_LIMITS };
}

// For testing: allow injecting time functions
export const _testing = {
  getNowET,
  getTodayET,
  getSession: () => session,
  setSession: (s: SessionState) => { session = s; },
  freshSession,
};
