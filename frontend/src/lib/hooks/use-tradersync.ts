"use client";

import { useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { tradersyncClient } from "../api/tradersync-client";
import { useWebSocket } from "./useWebSocket";

export function useTraderSyncStats() {
  const queryClient = useQueryClient();
  const { data: wsData } = useWebSocket<unknown>("tradersync");

  // Auto-refresh stats when WS broadcast arrives (e.g. other tab import)
  useEffect(() => {
    if (wsData) {
      queryClient.invalidateQueries({ queryKey: ["tradersync-stats"] });
    }
  }, [wsData, queryClient]);

  return useQuery({
    queryKey: ["tradersync-stats"],
    queryFn: () => tradersyncClient.getStats(),
    refetchInterval: 60_000,
  });
}

export function useTraderSyncImport() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (csv: string) => tradersyncClient.importCSV(csv),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tradersync-stats"] });
    },
  });
}
