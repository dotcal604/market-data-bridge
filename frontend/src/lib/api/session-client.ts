import { fetchJson } from "./fetch-json";

// --- Types ---

export interface SessionState {
  date: string;
  realizedPnl: number;
  tradeCount: number;
  consecutiveLosses: number;
  lastTradeTime: number;
  lastLossTime: number;
  locked: boolean;
  lockReason: string | null;
  limits: {
    maxDailyLoss: number;
    maxDailyTrades: number;
    consecutiveLossLimit: number;
    cooldownMinutes: number;
    lateDayLockoutMinutes: number;
    marketOpenHour: number;
    marketOpenMinute: number;
    marketCloseHour: number;
    marketCloseMinute: number;
  };
}

export interface EffectiveRiskConfig {
  max_position_pct: number;
  max_daily_loss_pct: number;
  max_concentration_pct: number;
  volatility_scalar: number;
}

export interface RiskConfigResponse {
  effective: EffectiveRiskConfig;
  floors: EffectiveRiskConfig;
  manual: EffectiveRiskConfig;
  rows: Array<{ param: string; value: number; updated_at: string }>;
}

export interface PositionSizeRequest {
  symbol: string;
  entryPrice: number;
  stopPrice: number;
  riskPercent?: number;
  riskAmount?: number;
  maxCapitalPercent?: number;
}

export interface PositionSizeResult {
  shares: number;
  dollarRisk: number;
  notionalValue: number;
  riskPerShare: number;
  accountEquity: number;
  pctOfAccount: number;
  riskPctUsed: number;
}

export interface TuneResult {
  suggestions: Array<{
    param: string;
    current: number;
    suggested: number;
    reason: string;
  }>;
}

// --- Client ---

export const sessionClient = {
  getSession() {
    return fetchJson<SessionState>("/api/session");
  },

  lockSession(reason?: string) {
    return fetchJson<{ locked: true; reason: string }>("/api/session/lock", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason }),
    });
  },

  unlockSession() {
    return fetchJson<{ locked: false }>("/api/session/unlock", {
      method: "POST",
    });
  },

  resetSession() {
    return fetchJson<{ reset: true }>("/api/session/reset", {
      method: "POST",
    });
  },

  getRiskConfig() {
    return fetchJson<RiskConfigResponse>("/api/risk/config");
  },

  updateRiskConfig(params: Partial<EffectiveRiskConfig>) {
    return fetchJson<{ updated: string[] }>("/api/risk/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    });
  },

  tuneRisk() {
    return fetchJson<TuneResult>("/api/risk/tune", {
      method: "POST",
    });
  },

  sizePosition(params: PositionSizeRequest) {
    return fetchJson<PositionSizeResult>("/api/risk/size-position", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    });
  },
};
