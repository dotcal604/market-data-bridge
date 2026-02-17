"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { signalClient } from "../api/signal-client";

export function useSignals(params?: {
  symbol?: string;
  direction?: string;
  since?: string;
  limit?: number;
}) {
  return useQuery({
    queryKey: ["signals", params],
    queryFn: () => signalClient.getSignals(params),
    refetchInterval: 10_000,
  });
}

export function useSignalStats() {
  return useQuery({
    queryKey: ["signal-stats"],
    queryFn: () => signalClient.getStats(),
    refetchInterval: 10_000,
  });
}

export function useAutoEvalStatus() {
  return useQuery({
    queryKey: ["auto-eval-status"],
    queryFn: () => signalClient.getAutoEvalStatus(),
    refetchInterval: 5_000,
  });
}

export function useToggleAutoEval() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (enabled: boolean) => signalClient.toggleAutoEval(enabled),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["auto-eval-status"] });
    },
  });
}
