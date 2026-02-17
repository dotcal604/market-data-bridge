"use client";

import { useQuery } from "@tanstack/react-query";
import { hollyClient } from "../api/holly-client";

/**
 * Fetch recent Holly alerts with optional filters
 * Auto-refreshes every 30 seconds
 */
export function useHollyAlerts(params?: {
  symbol?: string;
  strategy?: string;
  limit?: number;
  since?: string;
}) {
  return useQuery({
    queryKey: ["holly-alerts", params],
    queryFn: () => hollyClient.getAlerts(params),
    refetchInterval: 30_000,
  });
}

/**
 * Fetch Holly alert statistics
 * Auto-refreshes every 30 seconds
 */
export function useHollyStats() {
  return useQuery({
    queryKey: ["holly-stats"],
    queryFn: () => hollyClient.getStats(),
    refetchInterval: 30_000,
  });
}

/**
 * Fetch latest Holly symbols
 */
export function useHollySymbols(limit = 20) {
  return useQuery({
    queryKey: ["holly-symbols", limit],
    queryFn: () => hollyClient.getSymbols(limit),
  });
}
