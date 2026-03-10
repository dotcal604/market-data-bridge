"use client";

import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useJournalEntries } from "@/lib/hooks/use-journal";
import { BookOpen, ExternalLink } from "lucide-react";
import type { JournalEntry } from "@/lib/api/types";

export function JournalSummaryCard() {
  const { data, isLoading, error } = useJournalEntries({ limit: 20 });

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Journal
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-20 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (error || !data) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Journal
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Unable to load journal</p>
        </CardContent>
      </Card>
    );
  }

  const entries = data as JournalEntry[];
  const today = new Date().toISOString().split("T")[0];

  // Filter today's entries
  const todayEntries = entries.filter(
    (e) => e.created_at.split("T")[0] === today
  );

  // Open setups = entries without outcome_tags
  const openSetups = entries.filter(
    (e) => !e.outcome_tags || e.outcome_tags.trim() === ""
  );

  // Latest entry snippet
  const latestEntry = todayEntries.length > 0 ? todayEntries[0] : entries[0];
  const snippet = latestEntry
    ? latestEntry.reasoning.length > 120
      ? latestEntry.reasoning.slice(0, 120) + "..."
      : latestEntry.reasoning
    : null;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          Journal
        </CardTitle>
        <BookOpen className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Counts */}
        <div className="flex items-baseline justify-between">
          <span className="text-xs text-muted-foreground">Today</span>
          <span className="text-sm font-mono font-semibold">
            {todayEntries.length} {todayEntries.length === 1 ? "entry" : "entries"}
          </span>
        </div>

        <div className="flex items-baseline justify-between">
          <span className="text-xs text-muted-foreground">Open Setups</span>
          <span className="text-sm font-mono font-semibold text-yellow-400">
            {openSetups.length}
          </span>
        </div>

        {/* Latest snippet */}
        {snippet && (
          <div className="border-t border-border pt-2">
            <p className="text-xs text-muted-foreground mb-1">Latest:</p>
            <p className="text-xs leading-relaxed">
              {latestEntry?.symbol && (
                <span className="font-mono font-semibold text-foreground mr-1">
                  {latestEntry.symbol}
                </span>
              )}
              {snippet}
            </p>
          </div>
        )}

        {/* Link to journal */}
        <Link
          href="/journal"
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors pt-1"
        >
          Open journal <ExternalLink className="h-3 w-3" />
        </Link>
      </CardContent>
    </Card>
  );
}
