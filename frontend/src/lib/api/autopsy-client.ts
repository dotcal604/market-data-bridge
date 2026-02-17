import { fetchJson } from "./fetch-json";

const API_BASE = "/api";

export interface StrategyLeaderboard {
  strategy: string;
  total_trades: number;
  win_rate: number;
  avg_closed_profit: number;
  total_profit: number;
  avg_r_multiple: number | null;
  avg_hold_minutes: number;
  avg_giveback: number;
  avg_giveback_ratio: number;
  avg_time_to_mfe_min: number;
  median_hold_minutes: number;
  sharpe: number;
  profit_factor: number;
  max_win: number;
  max_loss: number;
  expectancy: number;
}

export interface MFEMAEProfile {
  strategy: string;
  segment: string | null;
  total_trades: number;
  avg_mfe: number;
  avg_mae: number;
  avg_giveback: number;
  avg_giveback_ratio: number;
  median_giveback_ratio: number;
  avg_time_to_mfe_min: number;
  avg_time_to_mae_min: number;
  pct_peak_in_30min: number;
  pct_held_over_2hr: number;
  pct_peak_early_held_late: number;
}

export interface ExitPolicyRec {
  strategy: string;
  archetype: "early_peaker" | "late_grower" | "bleeder" | "mixed";
  recommendation: string;
  supporting_data: {
    avg_time_to_mfe_min: number;
    avg_giveback_ratio: number;
    avg_hold_minutes: number;
    pct_peak_early_held_late: number;
  };
}

export interface TimeOfDayBucket {
  hour: number;
  label: string;
  total_trades: number;
  win_rate: number;
  avg_profit: number;
  avg_r_multiple: number | null;
  avg_giveback_ratio: number;
}

export interface SegmentComparison {
  segment: string;
  total_trades: number;
  win_rate: number;
  avg_profit: number;
  avg_r_multiple: number | null;
  avg_giveback_ratio: number;
  avg_hold_minutes: number;
  total_profit: number;
}

export interface ExitAutopsyReport {
  overview: {
    total_trades: number;
    date_range: { start: string; end: string };
    unique_symbols: number;
    unique_strategies: number;
    overall_win_rate: number;
    overall_avg_r: number | null;
    overall_total_profit: number;
    overall_avg_giveback_ratio: number;
  };
  strategy_leaderboard: StrategyLeaderboard[];
  mfe_mae_profiles: MFEMAEProfile[];
  exit_policy_recs: ExitPolicyRec[];
  time_of_day: TimeOfDayBucket[];
  segment_comparison: SegmentComparison[];
}

interface AgentResponse<T> {
  action: string;
  result: T;
}

export const autopsyClient = {
  async getReport(since?: string, until?: string): Promise<ExitAutopsyReport> {
    const response = await fetchJson<AgentResponse<ExitAutopsyReport>>(
      `${API_BASE}/agent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "holly_exit_autopsy",
          params: { since, until },
        }),
      }
    );
    return response.result;
  },
};
