"use client";

import { useQuery } from "@tanstack/react-query";
import { hollyClient } from "../api/holly-client";

export function useHollyAlerts(params?: {
  symbol?: string;
  strategy?: string;
  since?: string;
  limit?: number;
}) {
  return useQuery({
    queryKey: ["holly-alerts", params],
    queryFn: () => hollyClient.getAlerts(params),
    refetchInterval: 30_000,
  });
}

export function useHollyStats() {
  return useQuery({
    queryKey: ["holly-stats"],
    queryFn: () => hollyClient.getStats(),
    refetchInterval: 30_000,
  });
}
