"use client";

import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { hollyClient } from "../api/holly-client";
import { useWebSocket } from "./useWebSocket";

export function useHollyAlerts(params?: {
  symbol?: string;
  strategy?: string;
  since?: string;
  limit?: number;
}) {
  const queryClient = useQueryClient();
  const { data: wsData } = useWebSocket<unknown>("holly");

  useEffect(() => {
    if (wsData) {
      queryClient.invalidateQueries({ queryKey: ["holly-alerts"] });
      queryClient.invalidateQueries({ queryKey: ["holly-stats"] });
    }
  }, [wsData, queryClient]);

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
