"use client";

import { useQuery } from "@tanstack/react-query";
import { marketClient } from "../api/market-client";

export function useHistoricalBars(symbol: string, period: string, interval: string) {
  return useQuery({
    queryKey: ["historical-bars", symbol, period, interval],
    queryFn: () => marketClient.getHistoricalBars(symbol, period, interval),
    enabled: !!symbol,
    staleTime: 60_000, // Consider data fresh for 1 minute
    refetchInterval: 120_000, // Refetch every 2 minutes
  });
}
