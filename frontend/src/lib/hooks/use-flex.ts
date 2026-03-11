"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { flexClient } from "../api/flex-client";

export function useFlexStats() {
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
