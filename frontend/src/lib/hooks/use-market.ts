"use client";

import { useQuery } from "@tanstack/react-query";
import { marketClient } from "../api/market-client";
import { useState, useEffect } from "react";

export function useSymbolSearch(query: string, debouncedMs = 300) {
  const [debouncedQuery, setDebouncedQuery] = useState(query);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedQuery(query);
    }, debouncedMs);

    return () => {
      clearTimeout(handler);
    };
  }, [query, debouncedMs]);

  return useQuery({
    queryKey: ["symbol-search", debouncedQuery],
    queryFn: () => marketClient.searchSymbols(debouncedQuery),
    enabled: debouncedQuery.length > 0,
    staleTime: 60_000, // Cache results for 1 minute
  });
}

export function useQuote(symbol: string | null, refetchInterval = 5_000) {
  return useQuery({
    queryKey: ["quote", symbol],
    queryFn: () => marketClient.getQuote(symbol!),
    enabled: !!symbol,
    refetchInterval,
  });
}

export function useStockDetails(symbol: string | null) {
  return useQuery({
    queryKey: ["stock-details", symbol],
    queryFn: () => marketClient.getStockDetails(symbol!),
    enabled: !!symbol,
    staleTime: 300_000, // Cache for 5 minutes
  });
}

export function useFinancials(symbol: string | null) {
  return useQuery({
    queryKey: ["financials", symbol],
    queryFn: () => marketClient.getFinancials(symbol!),
    enabled: !!symbol,
    staleTime: 300_000, // Cache for 5 minutes
  });
}

export function useHistoricalBars(
  symbol: string | null,
  period: string = "3mo",
  interval: string = "1d"
) {
  return useQuery({
    queryKey: ["historical-bars", symbol, period, interval],
    queryFn: () => marketClient.getHistoricalBars(symbol!, period, interval),
    enabled: !!symbol,
    staleTime: 60_000, // Cache for 1 minute
  });
}

export function useNews(symbol: string | null) {
  return useQuery({
    queryKey: ["news", symbol],
    queryFn: () => marketClient.getNews(symbol!),
    enabled: !!symbol,
    staleTime: 300_000, // Cache for 5 minutes
  });
}

export function useEarnings(symbol: string | null) {
  return useQuery({
    queryKey: ["earnings", symbol],
    queryFn: () => marketClient.getEarnings(symbol!),
    enabled: !!symbol,
    staleTime: 300_000, // Cache for 5 minutes
  });
}
