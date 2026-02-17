"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { sessionClient } from "../api/session-client";

export function useSessionState(refetchInterval = 10_000) {
  return useQuery({
    queryKey: ["session-state"],
    queryFn: () => sessionClient.getSessionState(),
    refetchInterval,
  });
}

export function useRiskConfig(refetchInterval = 30_000) {
  return useQuery({
    queryKey: ["risk-config"],
    queryFn: () => sessionClient.getRiskConfig(),
    refetchInterval,
  });
}

export function useLockSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (reason?: string) => sessionClient.lockSession(reason),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["session-state"] });
    },
  });
}

export function useUnlockSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => sessionClient.unlockSession(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["session-state"] });
    },
  });
}

export function useResetSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => sessionClient.resetSession(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["session-state"] });
    },
  });
}

export function useRecordTrade() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (realizedPnl: number) => sessionClient.recordTrade(realizedPnl),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["session-state"] });
    },
  });
}
