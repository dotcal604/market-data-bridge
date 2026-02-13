"use client";

import { useQuery } from "@tanstack/react-query";
import { journalClient } from "../api/journal-client";

export function useJournalEntries(params?: {
  symbol?: string;
  strategy?: string;
  limit?: number;
  offset?: number;
}) {
  return useQuery({
    queryKey: ["journal-entries", params],
    queryFn: () => journalClient.getEntries(params),
  });
}

export function useJournalEntry(id: number | null) {
  return useQuery({
    queryKey: ["journal-entry", id],
    queryFn: () => journalClient.getById(id!),
    enabled: id !== null,
  });
}
