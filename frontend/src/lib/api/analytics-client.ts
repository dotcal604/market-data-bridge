import { fetchJson } from "./fetch-json";

const API_BASE = "/api";

interface AgentResponse<T> {
  action: string;
  result: T;
}

// ── TraderSync types ──────────────────────────────────────────────────

export interface TraderSyncStats {
  total_trades: number;
  unique_symbols: number;
  win_rate: number;
  avg_r_multiple: number;
  total_pnl: number;
  total_commissions: number;
  date_range: { start: string | null; end: string | null };
}

export interface TraderSyncTrade {
  id: number;
  symbol: string;
  side: "LONG" | "SHORT";
  status: "WIN" | "LOSS";
  return_dollars: number;
  r_multiple: number | null;
  commission: number;
  open_date: string;
  open_time: string;
  close_date: string | null;
  close_time: string | null;
  holdtime: string | null;
  setups: string | null;
  mistakes: string | null;
}

// ── Daily summary types ──────────────────────────────────────────────

export interface DailySession {
  date: string;
  total_pnl: number;
  trade_count: number;
  win_count: number;
  loss_count: number;
  win_rate: number;
  avg_r: number;
  best_r: number;
  worst_r: number;
}

export interface DailySummary {
  sessions: DailySession[];
  rolling: {
    total_pnl: number;
    total_trades: number;
    overall_win_rate: number;
    overall_avg_r: number;
  };
}

// ── Composite analytics shape ────────────────────────────────────────

export interface MonthlyPnL {
  month: string; // "2024-11", "2024-12", etc.
  pnl: number;
  trades: number;
  winRate: number;
  commissions: number;
}

export interface HourlyPerformance {
  hour: number;
  label: string;
  pnl: number;
  trades: number;
  winRate: number;
  avgR: number;
}

export interface SidePerformance {
  side: "LONG" | "SHORT";
  pnl: number;
  trades: number;
  winRate: number;
  avgR: number;
  commissions: number;
  avgWinner: number;
  avgLoser: number;
}

export const analyticsClient = {
  async getTraderSyncStats(): Promise<TraderSyncStats> {
    const response = await fetchJson<AgentResponse<TraderSyncStats>>(
      `${API_BASE}/agent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "tradersync_stats" }),
      }
    );
    return response.result;
  },

  async getTraderSyncTrades(params: {
    symbol?: string;
    side?: "LONG" | "SHORT";
    status?: "WIN" | "LOSS";
    days?: number;
    limit?: number;
  } = {}): Promise<TraderSyncTrade[]> {
    const response = await fetchJson<AgentResponse<TraderSyncTrade[]>>(
      `${API_BASE}/agent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "tradersync_trades",
          params: { limit: params.limit ?? 2000, ...params },
        }),
      }
    );
    return response.result;
  },

  async getDailySummary(params: {
    days?: number;
    date?: string;
  } = {}): Promise<DailySummary> {
    const response = await fetchJson<AgentResponse<DailySummary>>(
      `${API_BASE}/agent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "daily_summary",
          params,
        }),
      }
    );
    return response.result;
  },
};
