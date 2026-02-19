"use client";

import { useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { CollabMessage, CollabStats, PostMessageInput } from "../api/types";
import { getMessages, getStats, postMessage, clearMessages } from "../api/collab-client";
import { useWebSocket } from "./useWebSocket";

export function useCollabMessages(limit = 50) {
  const queryClient = useQueryClient();
  const { data: wsData } = useWebSocket<unknown>("inbox");

  useEffect(() => {
    if (wsData) {
      queryClient.invalidateQueries({ queryKey: ["collab-messages"] });
      queryClient.invalidateQueries({ queryKey: ["collab-stats"] });
    }
  }, [wsData, queryClient]);

  return useQuery({
    queryKey: ["collab-messages", limit],
    queryFn: () => getMessages(limit),
    refetchInterval: 10000,
  });
}

export function useCollabStats() {
  return useQuery({
    queryKey: ["collab-stats"],
    queryFn: getStats,
    refetchInterval: 10000,
  });
}

export function usePostMessage() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: postMessage,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["collab-messages"] });
      queryClient.invalidateQueries({ queryKey: ["collab-stats"] });
    },
  });
}

export function useClearMessages() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: clearMessages,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["collab-messages"] });
      queryClient.invalidateQueries({ queryKey: ["collab-stats"] });
    },
  });
}
