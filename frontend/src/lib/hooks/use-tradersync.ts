"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { tradersyncClient } from "../api/tradersync-client";

export function useTraderSyncStats() {
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
