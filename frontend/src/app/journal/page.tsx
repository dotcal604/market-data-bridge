"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useJournalEntries } from "@/lib/hooks/use-journal";
import { JournalTable } from "@/components/journal/journal-table";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Plus } from "lucide-react";

const ITEMS_PER_PAGE = 25;

export default function JournalPage() {
  const [symbolFilter, setSymbolFilter] = useState("");
  const [debouncedSymbol, setDebouncedSymbol] = useState("");

  // Debounce symbol filter
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSymbol(symbolFilter);
    }, 300);
    return () => clearTimeout(timer);
  }, [symbolFilter]);

  const { data: entries, isLoading, error } = useJournalEntries({
    symbol: debouncedSymbol || undefined,
    limit: ITEMS_PER_PAGE,
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Journal</h1>
          <p className="text-sm text-muted-foreground">
            Trade journal entries and post-trade reflections
          </p>
        </div>
        <Link href="/journal/new">
          <Button>
            <Plus className="mr-2 h-4 w-4" />
            New Entry
          </Button>
        </Link>
      </div>

      {/* Search Filter */}
      <div className="flex items-end gap-4">
        <div className="w-64 space-y-2">
          <Label htmlFor="symbol" className="text-sm">
            Filter by Symbol
          </Label>
          <Input
            id="symbol"
            type="text"
            placeholder="e.g., AAPL"
            value={symbolFilter}
            onChange={(e) => setSymbolFilter(e.target.value.toUpperCase())}
            className="font-mono"
          />
        </div>
        {symbolFilter && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setSymbolFilter("")}
          >
            Clear
          </Button>
        )}
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : error ? (
        <div className="rounded-lg border border-border bg-card p-8 text-center">
          <p className="text-sm text-destructive">
            Error loading journal entries: {error.message}
          </p>
        </div>
      ) : entries ? (
        <>
          <JournalTable entries={entries} />

          {entries.length === 0 && !symbolFilter && (
            <div className="rounded-lg border border-border bg-card p-8 text-center">
              <p className="text-sm text-muted-foreground">
                No journal entries yet. Create your first entry to get started.
              </p>
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}
