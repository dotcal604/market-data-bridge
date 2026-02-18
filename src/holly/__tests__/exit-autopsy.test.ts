import { beforeEach, describe, expect, it, vi } from "vitest";

interface LeaderboardRow {
  strategy: string;
  total_trades: number;
  win_rate: number;
  avg_pnl: number;
  total_profit: number;
  avg_r_multiple: number | null;
  avg_hold_minutes: number;
  avg_giveback: number;
  avg_giveback_ratio: number;
  avg_time_to_mfe_min: number;
  max_win: number;
  max_loss: number;
}

const state: {
  overview: Record<string, unknown>;
  leaderboardRows: LeaderboardRow[];
  profitsByStrategy: Record<string, Array<{ actual_pnl: number; hold_minutes: number }>>;
  mfeProfiles: Array<Record<string, unknown>>;
  timeOfDay: Array<Record<string, unknown>>;
  segments: Array<Record<string, unknown>>;
} = {
  overview: {},
  leaderboardRows: [],
  profitsByStrategy: {},
  mfeProfiles: [],
  timeOfDay: [],
  segments: [],
};

const mockDb = {
  prepare: (sql: string) => ({
    get: () => {
      if (sql.includes("MIN(entry_time) as start_date")) {
        return state.overview;
      }
      return {};
    },
    all: (...args: unknown[]) => {
      if (sql.includes("GROUP BY strategy") && sql.includes("ORDER BY total_profit DESC")) {
        return state.leaderboardRows;
      }
      if (sql.includes("SELECT actual_pnl, hold_minutes FROM holly_trades")) {
        const strategy = args[0] as string;
        return state.profitsByStrategy[strategy] ?? [];
      }
      if (sql.includes("GROUP BY strategy, segment")) {
        return state.mfeProfiles;
      }
      if (sql.includes("GROUP BY hour")) {
        return state.timeOfDay;
      }
      if (sql.includes("COALESCE(segment, 'Unknown') as segment")) {
        return state.segments;
      }
      return [];
    },
  }),
};

vi.mock("../../db/database.js", () => ({
  getDb: () => mockDb,
}));

vi.mock("../trade-importer.js", () => ({
  ensureHollyTradesTable: vi.fn(),
}));

vi.mock("../../logging.js", () => ({
  logger: {
    child: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  },
}));

import { runExitAutopsy } from "../exit-autopsy.js";

function seedBaselineData(): void {
  state.overview = {
    total_trades: 14,
    start_date: "2025-01-01 09:30:00",
    end_date: "2025-01-15 15:50:00",
    unique_symbols: 10,
    unique_strategies: 2,
    win_rate: 0.57,
    avg_r: 0.42,
    total_profit: 1220,
    avg_giveback_ratio: 0.44,
  };

  state.leaderboardRows = [
    {
      strategy: "Holly Grail",
      total_trades: 8,
      win_rate: 0.625,
      avg_pnl: 120,
      total_profit: 960,
      avg_r_multiple: 0.7,
      avg_hold_minutes: 95,
      avg_giveback: 180,
      avg_giveback_ratio: 0.55,
      avg_time_to_mfe_min: 20,
      max_win: 320,
      max_loss: -140,
    },
    {
      strategy: "Holly Neo",
      total_trades: 6,
      win_rate: 0.5,
      avg_pnl: 43.33,
      total_profit: 260,
      avg_r_multiple: 0.2,
      avg_hold_minutes: 145,
      avg_giveback: 90,
      avg_giveback_ratio: 0.22,
      avg_time_to_mfe_min: 75,
      max_win: 210,
      max_loss: -80,
    },
  ];

  state.profitsByStrategy = {
    "Holly Grail": [
      { actual_pnl: 240, hold_minutes: 80 },
      { actual_pnl: 210, hold_minutes: 90 },
      { actual_pnl: 180, hold_minutes: 95 },
      { actual_pnl: 120, hold_minutes: 100 },
      { actual_pnl: 80, hold_minutes: 70 },
      { actual_pnl: 60, hold_minutes: 115 },
      { actual_pnl: -70, hold_minutes: 110 },
      { actual_pnl: -100, hold_minutes: 125 },
    ],
    "Holly Neo": [
      { actual_pnl: 200, hold_minutes: 160 },
      { actual_pnl: 150, hold_minutes: 180 },
      { actual_pnl: 120, hold_minutes: 170 },
      { actual_pnl: -40, hold_minutes: 140 },
      { actual_pnl: -70, hold_minutes: 130 },
      { actual_pnl: -100, hold_minutes: 120 },
    ],
  };

  state.mfeProfiles = [
    {
      strategy: "Holly Grail",
      segment: "Holly Grail",
      total_trades: 8,
      avg_mfe: 260,
      avg_mae: -90,
      avg_giveback: 180,
      avg_giveback_ratio: 0.55,
      avg_time_to_mfe_min: 20,
      avg_time_to_mae_min: 8,
      pct_peak_in_30min: 0.75,
      pct_held_over_2hr: 0.38,
      pct_peak_early_held_late: 0.25,
    },
    {
      strategy: "Holly Neo",
      segment: "Holly Neo",
      total_trades: 6,
      avg_mfe: 180,
      avg_mae: -60,
      avg_giveback: 90,
      avg_giveback_ratio: 0.22,
      avg_time_to_mfe_min: 75,
      avg_time_to_mae_min: 20,
      pct_peak_in_30min: 0.1,
      pct_held_over_2hr: 0.7,
      pct_peak_early_held_late: 0.05,
    },
  ];

  state.timeOfDay = [
    { hour: 9, total_trades: 6, win_rate: 0.667, avg_profit: 82.5, avg_r_multiple: 0.5, avg_giveback_ratio: 0.32 },
    { hour: 10, total_trades: 5, win_rate: 0.6, avg_profit: 70, avg_r_multiple: 0.41, avg_giveback_ratio: 0.4 },
    { hour: 14, total_trades: 3, win_rate: 0.333, avg_profit: -15, avg_r_multiple: -0.1, avg_giveback_ratio: 0.62 },
  ];

  state.segments = [
    {
      segment: "Holly Grail",
      total_trades: 8,
      win_rate: 0.625,
      avg_profit: 120,
      avg_r_multiple: 0.7,
      avg_giveback_ratio: 0.55,
      avg_hold_minutes: 95,
      total_profit: 960,
    },
    {
      segment: "Holly Neo",
      total_trades: 6,
      win_rate: 0.5,
      avg_profit: 43.33,
      avg_r_multiple: 0.2,
      avg_giveback_ratio: 0.22,
      avg_hold_minutes: 145,
      total_profit: 260,
    },
  ];
}

describe("exit-autopsy", () => {
  beforeEach(() => {
    seedBaselineData();
  });

  it("builds report overview fields", () => {
    const report = runExitAutopsy();

    expect(report.overview.total_trades).toBe(14);
    expect(report.overview.date_range.start).toBe("2025-01-01 09:30:00");
    expect(report.overview.unique_strategies).toBe(2);
  });

  it("produces a strategy leaderboard sorted by configured SQL order", () => {
    const report = runExitAutopsy();

    expect(report.strategy_leaderboard[0]?.strategy).toBe("Holly Grail");
    expect(report.strategy_leaderboard[0]?.expectancy).toBeGreaterThan(report.strategy_leaderboard[1]?.expectancy ?? 0);
  });

  it("computes profit factor from gross profits and losses", () => {
    const report = runExitAutopsy();
    const grail = report.strategy_leaderboard.find((s) => s.strategy === "Holly Grail");

    expect(grail?.profit_factor).toBe(5.24);
  });

  it("sets profit factor to 999 when there are no losses", () => {
    state.profitsByStrategy["Holly Neo"] = [
      { actual_pnl: 50, hold_minutes: 40 },
      { actual_pnl: 60, hold_minutes: 50 },
      { actual_pnl: 70, hold_minutes: 60 },
      { actual_pnl: 80, hold_minutes: 70 },
      { actual_pnl: 90, hold_minutes: 80 },
      { actual_pnl: 100, hold_minutes: 90 },
    ];

    const report = runExitAutopsy();
    const neo = report.strategy_leaderboard.find((s) => s.strategy === "Holly Neo");

    expect(neo?.profit_factor).toBe(999);
  });

  it("classifies early peaker and late grower recommendations", () => {
    const report = runExitAutopsy();
    const grail = report.exit_policy_recs.find((r) => r.strategy === "Holly Grail");
    const neo = report.exit_policy_recs.find((r) => r.strategy === "Holly Neo");

    expect(grail?.archetype).toBe("early_peaker");
    expect(neo?.archetype).toBe("late_grower");
  });

  it("builds MFE/MAE profiles for each strategy and segment", () => {
    const report = runExitAutopsy();

    expect(report.mfe_mae_profiles).toHaveLength(2);
    expect(report.mfe_mae_profiles[0]?.strategy).toBe("Holly Grail");
  });

  it("handles missing MFE/MAE and giveback values gracefully", () => {
    state.mfeProfiles = [
      {
        strategy: "Holly Grail",
        segment: "Holly Grail",
        total_trades: 8,
        avg_mfe: null,
        avg_mae: null,
        avg_giveback: null,
        avg_giveback_ratio: null,
        avg_time_to_mfe_min: null,
        avg_time_to_mae_min: null,
        pct_peak_in_30min: null,
        pct_held_over_2hr: null,
        pct_peak_early_held_late: null,
      },
    ];

    const report = runExitAutopsy();

    expect(report.mfe_mae_profiles[0]?.avg_mfe).toBe(0);
    expect(report.mfe_mae_profiles[0]?.avg_time_to_mfe_min).toBe(0);
    expect(report.mfe_mae_profiles[0]?.avg_giveback_ratio).toBe(0);
  });

  it("creates time-of-day labels from hour buckets", () => {
    const report = runExitAutopsy();

    expect(report.time_of_day[0]?.label).toBe("09:00-10:00");
    expect(report.time_of_day[2]?.label).toBe("14:00-15:00");
  });

  it("returns segment comparison for Holly Grail and Holly Neo", () => {
    const report = runExitAutopsy();
    const segments = report.segment_comparison.map((s) => s.segment);

    expect(segments).toEqual(["Holly Grail", "Holly Neo"]);
  });
});
