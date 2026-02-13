"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatTimestamp } from "@/lib/utils/formatters";
import { Plus } from "lucide-react";

interface JournalEntry {
  id: number;
  symbol: string | null;
  strategy_version: string | null;
  reasoning: string;
  tags: string | null;
  spy_price: number | null;
  vix_level: number | null;
  gap_pct: number | null;
  time_of_day: string | null;
  created_at: string;
}

export default function JournalPage() {
  const router = useRouter();
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchEntries();
  }, []);

  const fetchEntries = async () => {
    try {
      const res = await fetch("/api/journal?limit=100");
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const data = await res.json();
      setEntries(data.entries || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch journal entries");
    } finally {
      setIsLoading(false);
    }
  };

  const parseTags = (tagsJson: string | null): string[] => {
    if (!tagsJson) return [];
    try {
      return JSON.parse(tagsJson);
    } catch {
      return [];
    }
  };

  if (isLoading) {
    return (
      <div className="container mx-auto py-6">
        <p className="text-muted-foreground">Loading journal entries...</p>
      </div>
    );
  }

  return (
    <div className="container mx-auto py-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Trade Journal</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {entries.length} {entries.length === 1 ? "entry" : "entries"}
          </p>
        </div>
        <Link href="/journal/new">
          <Button>
            <Plus className="mr-2 h-4 w-4" />
            New Entry
          </Button>
        </Link>
      </div>

      {error && (
        <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive mb-4">
          {error}
        </div>
      )}

      {entries.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center">
            <p className="text-muted-foreground mb-4">No journal entries yet</p>
            <Link href="/journal/new">
              <Button>Create your first entry</Button>
            </Link>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {entries.map((entry) => {
            const tags = parseTags(entry.tags);
            return (
              <Card key={entry.id} className="bg-card hover:bg-muted/30 transition-colors">
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      {entry.symbol && (
                        <span className="font-mono text-lg font-bold">{entry.symbol}</span>
                      )}
                      {entry.strategy_version && (
                        <Badge variant="outline" className="text-xs">
                          {entry.strategy_version}
                        </Badge>
                      )}
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {formatTimestamp(entry.created_at)}
                    </span>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div>
                    <p className="text-sm whitespace-pre-wrap">{entry.reasoning}</p>
                  </div>

                  {tags.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {tags.map((tag) => (
                        <Badge key={tag} variant="secondary" className="text-xs">
                          {tag}
                        </Badge>
                      ))}
                    </div>
                  )}

                  {/* Market Context Summary */}
                  {(entry.spy_price !== null || entry.vix_level !== null || entry.gap_pct !== null) && (
                    <div className="flex items-center gap-4 text-xs text-muted-foreground pt-2 border-t border-border">
                      {entry.spy_price !== null && (
                        <span>SPY: ${entry.spy_price.toFixed(2)}</span>
                      )}
                      {entry.vix_level !== null && (
                        <span>VIX: {entry.vix_level.toFixed(2)}</span>
                      )}
                      {entry.gap_pct !== null && (
                        <span>
                          Gap: {entry.gap_pct >= 0 ? "+" : ""}
                          {entry.gap_pct.toFixed(2)}%
                        </span>
                      )}
                      {entry.time_of_day && <span>{entry.time_of_day}</span>}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
