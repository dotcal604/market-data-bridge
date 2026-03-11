"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useFlexStats, useFlexFetch } from "@/lib/hooks/use-flex";
import { Download, CheckCircle, AlertCircle, Loader2 } from "lucide-react";

export function FlexImportCard() {
  const { data: stats, isLoading } = useFlexStats();
  const flexFetch = useFlexFetch();
  const [lastResult, setLastResult] = useState<{
    inserted: number;
    skipped: number;
    errors: string[];
  } | null>(null);

  const handleFetch = async () => {
    setLastResult(null);
    try {
      const result = await flexFetch.mutateAsync();
      setLastResult({
        inserted: result.inserted,
        skipped: result.skipped,
        errors: result.errors,
      });
    } catch {
      // error is available via flexFetch.error
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">IBKR Flex Import</CardTitle>
        <Download className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading ? (
          <Skeleton className="h-10 w-full rounded" />
        ) : stats ? (
          <div className="text-xs text-muted-foreground space-y-1">
            <div className="flex justify-between">
              <span>Trades</span>
              <span className="font-medium text-foreground">
                {stats.total_trades.toLocaleString()}
              </span>
            </div>
            <div className="flex justify-between">
              <span>Symbols</span>
              <span className="font-medium text-foreground">
                {stats.unique_symbols.toLocaleString()}
              </span>
            </div>
            <div className="flex justify-between">
              <span>Last import</span>
              <span className="font-medium text-foreground">
                {stats.last_import
                  ? new Date(stats.last_import).toLocaleDateString()
                  : "Never"}
              </span>
            </div>
          </div>
        ) : null}

        <Button
          className="w-full"
          size="sm"
          onClick={handleFetch}
          disabled={flexFetch.isPending}
        >
          {flexFetch.isPending ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Fetching...
            </>
          ) : (
            <>
              <Download className="mr-2 h-4 w-4" />
              Update IBKR Trades
            </>
          )}
        </Button>

        {lastResult && (
          <div className="flex items-center gap-2 text-xs">
            <CheckCircle className="h-3.5 w-3.5 text-green-500" />
            <span>
              Imported {lastResult.inserted}, skipped {lastResult.skipped}
            </span>
          </div>
        )}

        {flexFetch.error && (
          <div className="flex items-center gap-2 text-xs text-destructive">
            <AlertCircle className="h-3.5 w-3.5" />
            <span>{(flexFetch.error as Error).message}</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
