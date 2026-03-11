"use client";

import { useState, useEffect, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useFlexStats, useFlexFetch } from "@/lib/hooks/use-flex";
import type { FlexImportResult } from "@/lib/api/flex-client";
import { Download, CheckCircle, AlertCircle, Loader2 } from "lucide-react";

function formatCurrency(val: number | null): string {
  if (val == null) return "$0";
  return val.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

function useElapsedSeconds(running: boolean): number {
  const [elapsed, setElapsed] = useState(0);
  const startRef = useRef(0);

  useEffect(() => {
    if (!running) {
      setElapsed(0);
      return;
    }
    startRef.current = Date.now();
    const id = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startRef.current) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [running]);

  return elapsed;
}

export function FlexImportCard() {
  const { data: stats, isLoading } = useFlexStats();
  const flexFetch = useFlexFetch();
  const elapsed = useElapsedSeconds(flexFetch.isPending);
  const [lastResult, setLastResult] = useState<FlexImportResult | null>(null);

  // Auto-clear success after 15 seconds
  useEffect(() => {
    if (!lastResult) return;
    const id = setTimeout(() => setLastResult(null), 15_000);
    return () => clearTimeout(id);
  }, [lastResult]);

  const handleFetch = async () => {
    setLastResult(null);
    try {
      const result = await flexFetch.mutateAsync();
      setLastResult(result);
    } catch {
      // error available via flexFetch.error
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
          <Skeleton className="h-16 w-full rounded" />
        ) : stats && stats.total_trades > 0 ? (
          <div className="text-xs text-muted-foreground space-y-1">
            <div className="flex justify-between">
              <span>Trades</span>
              <span className="font-medium text-foreground">
                {stats.total_trades.toLocaleString()} ({stats.unique_symbols} symbols)
              </span>
            </div>
            <div className="flex justify-between">
              <span>Realized P&L</span>
              <span
                className={`font-medium ${
                  (stats.total_realized_pnl ?? 0) >= 0
                    ? "text-green-500"
                    : "text-red-500"
                }`}
              >
                {formatCurrency(stats.total_realized_pnl)}
              </span>
            </div>
            <div className="flex justify-between">
              <span>Commissions</span>
              <span className="font-medium text-foreground">
                {formatCurrency(stats.total_commission)}
              </span>
            </div>
            <div className="flex justify-between">
              <span>Date range</span>
              <span className="font-medium text-foreground">
                {stats.first_trade && stats.last_trade
                  ? `${stats.first_trade} \u2013 ${stats.last_trade}`
                  : "N/A"}
              </span>
            </div>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">No trades imported yet</p>
        )}

        <Button
          className="w-full"
          size="sm"
          onClick={handleFetch}
          disabled={flexFetch.isPending}
        >
          {flexFetch.isPending ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Fetching... {elapsed > 0 && `(${elapsed}s)`}
            </>
          ) : (
            <>
              <Download className="mr-2 h-4 w-4" />
              Update IBKR Trades
            </>
          )}
        </Button>

        {lastResult && (
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-xs">
              <CheckCircle className="h-3.5 w-3.5 shrink-0 text-green-500" />
              <span>
                Imported {lastResult.inserted}, skipped {lastResult.skipped}
              </span>
            </div>
            {lastResult.from_date && lastResult.to_date && (
              <p className="text-xs text-muted-foreground pl-5">
                {lastResult.from_date} &ndash; {lastResult.to_date}
              </p>
            )}
          </div>
        )}

        {flexFetch.error && (
          <div className="flex items-start gap-2 text-xs text-destructive">
            <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            <span className="line-clamp-3">
              {(flexFetch.error as Error).message}
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
