"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { sessionClient } from "../api/session-client";
import type { EffectiveRiskConfig, PositionSizeRequest } from "../api/session-client";

export function useSession() {
  return useQuery({
    queryKey: ["session"],
    queryFn: () => sessionClient.getSession(),
    refetchInterval: 5_000,
  });
}

export function useRiskConfig() {
  return useQuery({
    queryKey: ["risk-config"],
    queryFn: () => sessionClient.getRiskConfig(),
  });
}

export function useLockSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (reason?: string) => sessionClient.lockSession(reason),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["session"] }),
  });
}

export function useUnlockSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => sessionClient.unlockSession(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["session"] }),
  });
}

export function useResetSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => sessionClient.resetSession(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["session"] }),
  });
}

export function useUpdateRiskConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: Partial<EffectiveRiskConfig>) =>
      sessionClient.updateRiskConfig(params),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["risk-config"] }),
  });
}

export function useTuneRisk() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => sessionClient.tuneRisk(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["risk-config"] }),
  });
}

export function useSizePosition() {
  return useMutation({
    mutationFn: (params: PositionSizeRequest) =>
      sessionClient.sizePosition(params),
  });
}
