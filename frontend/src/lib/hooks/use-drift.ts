"use client";

import { useQuery } from "@tanstack/react-query";
import { driftClient } from "../api/drift-client";

export function useDriftReport() {
  return useQuery({
    queryKey: ["drift-report"],
    queryFn: () => driftClient.getReport(),
    refetchInterval: 60_000,
  });
}

export function useDriftAlerts(limit = 50) {
  return useQuery({
    queryKey: ["drift-alerts", limit],
    queryFn: () => driftClient.getAlerts(limit),
    refetchInterval: 60_000,
  });
}
