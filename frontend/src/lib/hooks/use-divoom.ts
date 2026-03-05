"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { divoomClient, type BgClearSettings } from "../api/divoom-client";
import type { CompositeSettings, ContentSettings, LayoutSettings } from "../api/types";

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

// ─── Config Store Hooks ──────────────────────────────

export function useDivoomComposite() {
  return useQuery({
    queryKey: ["divoom", "composite"],
    queryFn: () => divoomClient.getComposite(),
    refetchInterval: 30_000,
  });
}

export function useDivoomSetComposite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<CompositeSettings>) => divoomClient.setComposite(patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["divoom", "composite"] });
    },
  });
}

export function useDivoomContent() {
  return useQuery({
    queryKey: ["divoom", "content"],
    queryFn: () => divoomClient.getContent(),
    refetchInterval: 30_000,
  });
}

export function useDivoomSetContent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<ContentSettings>) => divoomClient.setContent(patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["divoom", "content"] });
    },
  });
}

export function useDivoomLayout() {
  return useQuery({
    queryKey: ["divoom", "layout"],
    queryFn: () => divoomClient.getLayout(),
    refetchInterval: 30_000,
  });
}

export function useDivoomSetLayout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<LayoutSettings>) => divoomClient.setLayout(patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["divoom", "layout"] });
    },
  });
}

export function useDivoomWidgets() {
  return useQuery({
    queryKey: ["divoom", "widgets"],
    queryFn: () => divoomClient.getWidgets(),
    staleTime: 60_000,
  });
}

export function useDivoomResetConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => divoomClient.resetConfig(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["divoom"] });
    },
  });
}
