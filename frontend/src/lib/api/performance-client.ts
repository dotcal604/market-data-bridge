import { fetchJson } from "./fetch-json";

const API_BASE = "/api";

export interface TrailingStopSummary {
  name: string;
  type: string;
  total_pnl_original: number;
  total_pnl_simulated: number;
  pnl_improvement: number;
  pnl_improvement_pct: number;
  win_rate_original: number;
  win_rate_simulated: number;
  sharpe_original: number;
  sharpe_simulated: number;
  giveback_reduction: number;
}

export interface StrategyOptimization {
  holly_strategy: string;
  total_trades: number;
  best_trailing: {
    params: {
      name: string;
      type: string;
      trail_pct?: number;
      atr_mult?: number;
      initial_target_pct?: number;
      decay_per_min?: number;
      mfe_trigger_pct?: number;
      tight_trail_pct?: number;
      be_trigger_r?: number;
      post_be_trail_pct?: number;
    };
    total_trades: number;
    original: {
      total_pnl: number;
      win_rate: number;
      avg_pnl: number;
      sharpe: number;
      avg_giveback_ratio: number;
    };
    simulated: {
      total_pnl: number;
      win_rate: number;
      avg_pnl: number;
      sharpe: number;
      avg_giveback_ratio: number;
    };
    pnl_improvement: number;
    pnl_improvement_pct: number;
    win_rate_delta: number;
    sharpe_delta: number;
    giveback_reduction: number;
  };
  all_results: Array<{
    params: {
      name: string;
      type: string;
    };
    total_trades: number;
    pnl_improvement: number;
    pnl_improvement_pct: number;
  }>;
}

export interface HollyTradeStats {
  total_trades: number;
  unique_symbols: number;
  unique_strategies: number;
  first_trade: string | null;
  last_trade: string | null;
  total_pnl: number;
  total_pnl_long: number;
  total_pnl_short: number;
  avg_pnl: number;
  median_pnl: number;
  win_rate: number;
  avg_winner: number;
  avg_loser: number;
  profit_factor: number;
  sharpe_ratio: number;
  avg_r_multiple: number | null;
  avg_hold_minutes: number;
  median_hold_minutes: number;
  avg_mfe: number;
  avg_mae: number;
  avg_giveback: number;
  avg_giveback_ratio: number;
}

interface AgentResponse<T> {
  action: string;
  result: T;
}

export const performanceClient = {
  async getTrailingStopSummary(params: {
    strategy?: string;
    segment?: string;
    since?: string;
    until?: string;
  } = {}): Promise<TrailingStopSummary[]> {
    const response = await fetchJson<AgentResponse<TrailingStopSummary[]>>(
      `${API_BASE}/agent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "trailing_stop_summary",
          params,
        }),
      }
    );
    return response.result;
  },

  async getPerStrategyOptimization(params: {
    since?: string;
    until?: string;
    min_trades?: number;
  } = {}): Promise<StrategyOptimization[]> {
    const response = await fetchJson<AgentResponse<StrategyOptimization[]>>(
      `${API_BASE}/agent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "trailing_stop_per_strategy",
          params,
        }),
      }
    );
    return response.result;
  },

  async getTradeStats(): Promise<HollyTradeStats> {
    const response = await fetchJson<AgentResponse<HollyTradeStats>>(
      `${API_BASE}/agent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "holly_trade_stats",
        }),
      }
    );
    return response.result;
  },
};
