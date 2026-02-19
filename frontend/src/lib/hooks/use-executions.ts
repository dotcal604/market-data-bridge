"use client";

import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { executionsClient } from "../api/executions-client";
import { useWebSocket } from "./useWebSocket";

export function useExecutions(
  symbol?: string,
  secType?: string,
  time?: string,
  refreshInterval = 30_000
) {
  const queryClient = useQueryClient();
  const { data: wsData } = useWebSocket<unknown>("executions");

  // Invalidate executions cache when WS delivers an execution event
  useEffect(() => {
    if (wsData) {
      queryClient.invalidateQueries({ queryKey: ["executions"] });
    }
  }, [wsData, queryClient]);

  return useQuery({
    queryKey: ["executions", symbol, secType, time],
    queryFn: () => executionsClient.getExecutions(symbol, secType, time),
    refetchInterval: refreshInterval,
  });
}
