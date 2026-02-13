"use client";

import { useQuery } from "@tanstack/react-query";
import { evalClient } from "../api/eval-client";

export function useEvalHistory(limit = 50, symbol?: string) {
  return useQuery({
    queryKey: ["eval-history", limit, symbol],
    queryFn: () => evalClient.getHistory(limit, symbol),
    refetchInterval: 30_000,
  });
}

export function useEvalDetail(id: string) {
  return useQuery({
    queryKey: ["eval-detail", id],
    queryFn: () => evalClient.getById(id),
    enabled: !!id,
  });
}

export function useEvalStats() {
  return useQuery({
    queryKey: ["eval-stats"],
    queryFn: () => evalClient.getStats(),
    refetchInterval: 30_000,
  });
}

export function useEnsembleWeights() {
  return useQuery({
    queryKey: ["ensemble-weights"],
    queryFn: () => evalClient.getWeights(),
  });
}
