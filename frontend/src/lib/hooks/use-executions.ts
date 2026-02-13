"use client";

import { useQuery } from "@tanstack/react-query";
import { executionsClient } from "../api/executions-client";

export function useExecutions(
  symbol?: string,
  secType?: string,
  time?: string,
  refreshInterval = 30_000
) {
  return useQuery({
    queryKey: ["executions", symbol, secType, time],
    queryFn: () => executionsClient.getExecutions(symbol, secType, time),
    refetchInterval: refreshInterval,
  });
}
