"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
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

export function useMultipleEvals(ids: string[]) {
  return useQuery({
    queryKey: ["eval-multiple", ids],
    queryFn: async () => {
      const results = await Promise.all(ids.map((id) => evalClient.getById(id)));
      return results;
    },
    enabled: ids.length > 0,
  });
}

export function useEvalOutcomes(limit = 500) {
  return useQuery({
    queryKey: ["eval-outcomes", limit],
    queryFn: () => evalClient.getOutcomes(limit),
    refetchInterval: 60_000,
  });
}

export function useCalibration() {
  return useQuery({
    queryKey: ["eval-calibration"],
    queryFn: () => evalClient.getCalibration(),
    refetchInterval: 60_000,
  });
}

export function useModelAgreement() {
  return useQuery({
    queryKey: ["model-agreement"],
    queryFn: () => evalClient.getModelAgreement(),
    refetchInterval: 60_000,
  });
}

export function useWeightHistory() {
  return useQuery({
    queryKey: ["weight-history"],
    queryFn: () => evalClient.getWeightHistory(),
  });
}

export function useUpdateWeights() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (weights: Record<string, number>) =>
      evalClient.updateWeights(weights),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ensemble-weights"] });
      qc.invalidateQueries({ queryKey: ["weight-history"] });
    },
  });
}

export function useSimulateWeights() {
  return useMutation({
    mutationFn: (params: {
      claude: number;
      gpt4o: number;
      gemini: number;
      k?: number;
      days?: number;
      symbol?: string;
    }) => evalClient.simulateWeights(params),
  });
}
