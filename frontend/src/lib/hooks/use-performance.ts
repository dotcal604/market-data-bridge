"use client";

import { useQuery } from "@tanstack/react-query";
import { performanceClient } from "../api/performance-client";
import { autopsyClient } from "../api/autopsy-client";

export function useTrailingStopSummary(params?: {
  strategy?: string;
  segment?: string;
  since?: string;
  until?: string;
}) {
  return useQuery({
    queryKey: ["trailing-stop-summary", params],
    queryFn: () => performanceClient.getTrailingStopSummary(params),
    refetchInterval: 300_000, // 5 min — static historical data
  });
}

export function usePerStrategyOptimization(params?: {
  since?: string;
  until?: string;
  min_trades?: number;
}) {
  return useQuery({
    queryKey: ["per-strategy-optimization", params],
    queryFn: () => performanceClient.getPerStrategyOptimization(params),
    refetchInterval: 300_000, // 5 min
  });
}

export function useHollyTradeStats() {
  return useQuery({
    queryKey: ["holly-trade-stats"],
    queryFn: () => performanceClient.getTradeStats(),
    refetchInterval: 300_000, // 5 min
  });
}

export function useAutopsyForPerformance(since?: string, until?: string) {
  return useQuery({
    queryKey: ["autopsy-performance", since, until],
    queryFn: () => autopsyClient.getReport(since, until),
    refetchInterval: 300_000, // 5 min
  });
}
