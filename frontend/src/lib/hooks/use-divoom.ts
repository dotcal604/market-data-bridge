"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { divoomClient, type BgClearSettings } from "../api/divoom-client";

export function useDivoomStatus(refetchInterval = 10_000) {
  return useQuery({
    queryKey: ["divoom", "status"],
    queryFn: divoomClient.getStatus,
    refetchInterval,
  });
}

export function useDivoomPreview(refetchInterval = 10_000) {
  return useQuery({
    queryKey: ["divoom", "preview"],
    queryFn: divoomClient.getPreview,
    refetchInterval,
  });
}

export function useDivoomBrightness() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (value: number) => divoomClient.setBrightness(value),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["divoom", "status"] });
    },
  });
}

export function useDivoomRefresh() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => divoomClient.refresh(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["divoom"] });
    },
  });
}

export function useDivoomBackground() {
  return useQuery({
    queryKey: ["divoom", "background"],
    queryFn: divoomClient.getBackground,
  });
}

export function useDivoomSetBackground() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<BgClearSettings>) => divoomClient.setBackground(patch),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["divoom", "background"] });
      queryClient.invalidateQueries({ queryKey: ["divoom", "preview"] });
    },
  });
}
