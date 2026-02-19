"use client";

import { useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { signalClient } from "../api/signal-client";
import { useWebSocket } from "./useWebSocket";

export function useSignals(params?: {
  symbol?: string;
  direction?: string;
  since?: string;
  limit?: number;
}) {
  const queryClient = useQueryClient();
  const { data: wsData } = useWebSocket<unknown>("signals");

  useEffect(() => {
    if (wsData) {
      queryClient.invalidateQueries({ queryKey: ["signals"] });
      queryClient.invalidateQueries({ queryKey: ["signal-stats"] });
    }
  }, [wsData, queryClient]);

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
