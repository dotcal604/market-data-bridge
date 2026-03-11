"use client";

import { useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { flexClient } from "../api/flex-client";
import { useWebSocket } from "./useWebSocket";

export function useFlexStats() {
  const queryClient = useQueryClient();
  const { data: wsData } = useWebSocket<unknown>("flex");

  // Auto-refresh stats when WS broadcast arrives (e.g. scheduled import, other tab)
  useEffect(() => {
    if (wsData) {
      queryClient.invalidateQueries({ queryKey: ["flex-stats"] });
    }
  }, [wsData, queryClient]);

  return useQuery({
    queryKey: ["flex-stats"],
    queryFn: () => flexClient.getStats(),
    refetchInterval: 60_000,
  });
}

export function useFlexFetch() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => flexClient.fetchAndImport(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["flex-stats"] });
    },
  });
}

export function useFlexImportContent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (content: string) => flexClient.importContent(content),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["flex-stats"] });
    },
  });
}
