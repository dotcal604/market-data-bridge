"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { exitOptimizerClient } from "../api/exit-optimizer-client";

export function useOptimalExitSummary() {
  return useQuery({
    queryKey: ["optimal-exit-summary"],
    queryFn: () => exitOptimizerClient.getSummary(),
    refetchInterval: 300_000, // 5 min — data changes only when optimizer reruns
  });
}

export function useOptimalExitMeta() {
  return useQuery({
    queryKey: ["optimal-exit-meta"],
    queryFn: () => exitOptimizerClient.getMeta(),
    refetchInterval: 300_000,
  });
}

export function useSuggestExits(params: {
  symbol: string;
  direction: "long" | "short";
  entry_price: number;
  stop_price: number;
  total_shares?: number;
  strategy?: string;
} | null) {
  return useQuery({
    queryKey: ["suggest-exits", params],
    queryFn: () => exitOptimizerClient.suggestExits(params!),
    enabled: !!params && !!params.symbol && !!params.entry_price && !!params.stop_price,
    refetchInterval: 60_000, // 1 min — could change with live data
  });
}

export function useReloadOptimizer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => exitOptimizerClient.reload(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["optimal-exit-summary"] });
      queryClient.invalidateQueries({ queryKey: ["optimal-exit-meta"] });
      queryClient.invalidateQueries({ queryKey: ["suggest-exits"] });
    },
  });
}
