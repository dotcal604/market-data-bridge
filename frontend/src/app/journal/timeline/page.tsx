"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useJournalEntries } from "@/lib/hooks/use-journal";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { formatTimestamp } from "@/lib/utils/formatters";
import { Clock } from "lucide-react";
import type { JournalEntry } from "@/lib/api/types";

type DateRange = "7d" | "30d" | "90d" | "all";

function getOutcomeColor(outcomeTags: string[] | null): string {
  if (!outcomeTags || outcomeTags.length === 0) {
    return "text-muted-foreground";
  }
  
  if (outcomeTags.includes("win") || outcomeTags.includes("target_hit")) {
    return "text-emerald-400";
  }
  
  if (outcomeTags.includes("loss") || outcomeTags.includes("stopped_out")) {
    return "text-red-400";
  }
  
  return "text-muted-foreground";
}

function getOutcomeBgColor(outcomeTags: string[] | null): string {
  if (!outcomeTags || outcomeTags.length === 0) {
    return "border-border bg-card";
  }
  
  if (outcomeTags.includes("win") || outcomeTags.includes("target_hit")) {
    return "border-emerald-400/30 bg-emerald-400/5";
  }
  
  if (outcomeTags.includes("loss") || outcomeTags.includes("stopped_out")) {
    return "border-red-400/30 bg-red-400/5";
  }
  
  return "border-border bg-card";
}

function parseOutcomeTags(entry: JournalEntry): string[] | null {
  if (!entry.outcome_tags) return null;
  try {
    return JSON.parse(entry.outcome_tags) as string[];
  } catch {
    return null;
  }
}

function filterEntriesByDateRange(entries: JournalEntry[], range: DateRange): JournalEntry[] {
  if (range === "all") return entries;
  
  const now = Date.now();
  const msPerDay = 24 * 60 * 60 * 1000;
  const cutoffMs = {
    "7d": 7 * msPerDay,
    "30d": 30 * msPerDay,
    "90d": 90 * msPerDay,
  }[range];
  
  const cutoffDate = new Date(now - cutoffMs);
  
  return entries.filter((entry) => {
    const entryDate = new Date(entry.created_at);
    return entryDate >= cutoffDate;
  });
}

interface TimelineEntryProps {
  entry: JournalEntry;
  onClick: () => void;
}

function TimelineEntry({ entry, onClick }: TimelineEntryProps) {
  const outcomeTags = parseOutcomeTags(entry);
  const outcomeColor = getOutcomeColor(outcomeTags);
  const outcomeBgColor = getOutcomeBgColor(outcomeTags);
  
  // Truncate reasoning for snippet
  const reasoningSnippet = entry.reasoning.length > 120 
    ? entry.reasoning.slice(0, 120) + "..." 
    : entry.reasoning;
  
  // Parse pre-trade tags
  let preTradeTags: string[] = [];
  if (entry.tags) {
    try {
      preTradeTags = JSON.parse(entry.tags) as string[];
    } catch {
      // ignore
    }
  }

  return (
    <div className="flex gap-4">
      {/* Timeline marker */}
      <div className="flex flex-col items-center">
        <div className={`h-3 w-3 rounded-full border-2 ${outcomeColor.replace("text-", "border-")}`} />
        <div className="w-px flex-1 bg-border" />
      </div>

      {/* Content card */}
      <Card 
        className={`mb-6 flex-1 cursor-pointer border p-4 transition-all hover:shadow-md ${outcomeBgColor}`}
        onClick={onClick}
      >
        <div className="space-y-3">
          {/* Header: Symbol and Time */}
          <div className="flex items-start justify-between">
            <div>
              {entry.symbol && (
                <h3 className="font-mono text-lg font-semibold">
                  {entry.symbol}
                </h3>
              )}
              <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                <Clock className="h-3 w-3" />
                {formatTimestamp(entry.created_at)}
              </div>
            </div>
            {outcomeTags && outcomeTags.length > 0 && (
              <Badge variant="outline" className={`${outcomeColor} text-xs`}>
                {outcomeTags[0].replace("_", " ")}
              </Badge>
            )}
          </div>

          {/* Pre-trade tags */}
          {preTradeTags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {preTradeTags.slice(0, 3).map((tag, i) => (
                <Badge key={i} variant="outline" className="text-[10px]">
                  {tag}
                </Badge>
              ))}
              {preTradeTags.length > 3 && (
                <span className="text-xs text-muted-foreground">
                  +{preTradeTags.length - 3}
                </span>
              )}
            </div>
          )}

          {/* Reasoning snippet */}
          <p className="text-sm text-muted-foreground leading-relaxed">
            {reasoningSnippet}
          </p>

          {/* Post-trade notes indicator */}
          {entry.notes && (
            <div className="text-xs text-muted-foreground italic">
              + post-trade notes
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}

export default function JournalTimelinePage() {
  const router = useRouter();
  const [dateRange, setDateRange] = useState<DateRange>("30d");
  
  const { data: allEntries, isLoading, error } = useJournalEntries({
    limit: 100,
  });

  const filteredEntries = allEntries 
    ? filterEntriesByDateRange(allEntries, dateRange) 
    : [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Journal Timeline</h1>
        <p className="text-sm text-muted-foreground">
          Visual timeline of trade journal entries
        </p>
      </div>

      {/* Date Range Filter */}
      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground">Show:</span>
        {(["7d", "30d", "90d", "all"] as DateRange[]).map((range) => (
          <Button
            key={range}
            size="sm"
            variant={dateRange === range ? "default" : "outline"}
            onClick={() => setDateRange(range)}
            className="text-xs"
          >
            {range === "all" ? "All" : `Last ${range}`}
          </Button>
        ))}
      </div>

      {/* Timeline */}
      {isLoading ? (
        <div className="space-y-4">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="flex gap-4">
              <div className="w-3" />
              <Skeleton className="h-32 flex-1" />
            </div>
          ))}
        </div>
      ) : error ? (
        <Card className="border border-border bg-card p-8 text-center">
          <p className="text-sm text-destructive">
            Error loading journal entries: {error.message}
          </p>
        </Card>
      ) : filteredEntries.length === 0 ? (
        <Card className="border border-border bg-card p-8 text-center">
          <p className="text-sm text-muted-foreground">
            No journal entries found for the selected time range.
          </p>
        </Card>
      ) : (
        <div className="mt-6">
          {filteredEntries.map((entry) => (
            <TimelineEntry
              key={entry.id}
              entry={entry}
              onClick={() => router.push(`/journal/${entry.id}`)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
