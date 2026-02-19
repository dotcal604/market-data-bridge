"use client";

import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { driftClient } from "../api/drift-client";
import { useWebSocket } from "./useWebSocket";

export function useDriftReport() {
  const queryClient = useQueryClient();
  const { data: wsData } = useWebSocket<unknown>("incidents");

  useEffect(() => {
    if (wsData) {
      queryClient.invalidateQueries({ queryKey: ["drift-report"] });
      queryClient.invalidateQueries({ queryKey: ["drift-alerts"] });
    }
  }, [wsData, queryClient]);

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
