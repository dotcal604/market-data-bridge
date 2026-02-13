"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { executionsClient } from "../api/executions-client";
import { useWebSocket } from "./useWebSocket";

export function useExecutions(
  symbol?: string,
  secType?: string,
  time?: string,
  refreshInterval = 30_000
) {
  const queryClient = useQueryClient();
  const [useWebSocketData, setUseWebSocketData] = useState(false);

  // Try WebSocket first
  const { data: wsData, connected } = useWebSocket<any>({
    channel: "executions",
    enabled: true,
    onData: (data) => {
      // When we receive WebSocket data, invalidate executions cache
      if (data) {
        setUseWebSocketData(true);
        queryClient.invalidateQueries({ queryKey: ["executions", symbol, secType, time] });
      }
    },
  });

  // Fallback to polling if WebSocket disconnects
  useEffect(() => {
    if (!connected && useWebSocketData) {
      setUseWebSocketData(false);
    }
  }, [connected, useWebSocketData]);

  return useQuery({
    queryKey: ["executions", symbol, secType, time],
    queryFn: () => executionsClient.getExecutions(symbol, secType, time),
    // Use longer interval when WebSocket is connected, faster when polling
    refetchInterval: connected && useWebSocketData ? 60_000 : refreshInterval,
  });
}
