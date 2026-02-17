"use client";

import { useQuery } from "@tanstack/react-query";
import { driftClient } from "../api/drift-client";

export function useDriftReport() {
  return useQuery({
    queryKey: ["drift-report"],
    queryFn: () => driftClient.getDriftReport(),
    refetchInterval: 60_000, // 60 seconds
  });
}

export function useDriftAlerts(limit = 50) {
  return useQuery({
    queryKey: ["drift-alerts", limit],
    queryFn: () => driftClient.getDriftAlerts(limit),
    refetchInterval: 60_000, // 60 seconds
  });
}
