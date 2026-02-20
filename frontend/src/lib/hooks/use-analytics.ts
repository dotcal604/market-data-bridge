"use client";

import { useQuery } from "@tanstack/react-query";
import { analyticsClient } from "../api/analytics-client";
import { autopsyClient } from "../api/autopsy-client";
import { performanceClient } from "../api/performance-client";

export function useTraderSyncStats() {
  return useQuery({
    queryKey: ["tradersync-stats"],
    queryFn: () => analyticsClient.getTraderSyncStats(),
    refetchInterval: 300_000, // 5 min — historical data
  });
}

export function useTraderSyncTrades(params?: {
  symbol?: string;
  side?: "LONG" | "SHORT";
  status?: "WIN" | "LOSS";
  days?: number;
  limit?: number;
}) {
  return useQuery({
    queryKey: ["tradersync-trades", params],
    queryFn: () => analyticsClient.getTraderSyncTrades(params),
    refetchInterval: 300_000,
  });
}

export function useDailySummary(days?: number) {
  return useQuery({
    queryKey: ["daily-summary", days],
    queryFn: () => analyticsClient.getDailySummary({ days }),
    refetchInterval: 300_000,
  });
}

export function useAnalyticsSuite() {
  const tsStats = useTraderSyncStats();
  const tsTrades = useTraderSyncTrades({ limit: 2000 });
  const hollyStats = performanceClient.getTradeStats;
  const autopsy = useQuery({
    queryKey: ["autopsy-analytics"],
    queryFn: () => autopsyClient.getReport(),
    refetchInterval: 300_000,
  });

  return {
    tsStats,
    tsTrades,
    autopsy,
    isLoading: tsStats.isLoading || tsTrades.isLoading || autopsy.isLoading,
    hasData: !!(tsStats.data || tsTrades.data || autopsy.data),
  };
}
