"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useFlexStats, useFlexFetch, useFlexImportContent } from "@/lib/hooks/use-flex";
import { useDropZone } from "@/lib/hooks/use-drop-zone";
import type { FlexImportResult } from "@/lib/api/flex-client";
import { formatCurrency } from "@/lib/utils/formatters";
import { Download, Upload, CheckCircle, AlertCircle, Loader2 } from "lucide-react";

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

/** Read a File as text — extracted for testability */
export async function readFileText(file: File): Promise<string> {
  return file.text();
}

export function FlexImportCard({
  readFile = readFileText,
}: {
  readFile?: (file: File) => Promise<string>;
} = {}) {
  const { data: stats, isLoading } = useFlexStats();
  const flexFetch = useFlexFetch();
  const flexImport = useFlexImportContent();
  const isBusy = flexFetch.isPending || flexImport.isPending;
  const elapsed = useElapsedSeconds(flexFetch.isPending);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [lastResult, setLastResult] = useState<FlexImportResult | null>(null);

  // Auto-clear success after 15 seconds
  useEffect(() => {
    if (!lastResult) return;
    const id = setTimeout(() => setLastResult(null), 15_000);
    return () => clearTimeout(id);
  }, [lastResult]);

  const handleFileDrop = useCallback(
    async (file: File) => {
      setLastResult(null);
      try {
        const content = await readFile(file);
        const result = await flexImport.mutateAsync(content);
        setLastResult(result);
      } catch {
        // error available via flexImport.error
      }
    },
    [readFile, flexImport],
  );

  const { isDragging, dropZoneProps } = useDropZone({
    accept: [".xml", ".csv"],
    onDrop: handleFileDrop,
    disabled: isBusy,
  });

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) await handleFileDrop(file);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleFetch = async () => {
    setLastResult(null);
    try {
      const result = await flexFetch.mutateAsync();
      setLastResult(result);
    } catch {
      // error available via flexFetch.error
    }
  };

  const error = flexFetch.error || flexImport.error;

  return (
    <Card
      {...dropZoneProps}
      className={isDragging ? "ring-2 ring-primary ring-offset-2" : ""}
    >
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">IBKR Flex Import</CardTitle>
        <Download className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent className="space-y-3">
        {isDragging ? (
          <div className="flex items-center justify-center rounded border-2 border-dashed border-primary/50 py-4">
            <p className="text-xs text-muted-foreground">
              Drop XML or CSV file here
            </p>
          </div>
        ) : isLoading ? (
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

        <input
          ref={fileInputRef}
          type="file"
          accept=".xml,.csv"
          className="hidden"
          onChange={handleFileSelect}
        />

        <div className="flex gap-2">
          <Button
            className="flex-1"
            size="sm"
            onClick={handleFetch}
            disabled={isBusy}
          >
            {flexFetch.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Fetching... {elapsed > 0 && `(${elapsed}s)`}
              </>
            ) : (
              <>
                <Download className="mr-2 h-4 w-4" />
                Fetch from IBKR
              </>
            )}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
            disabled={isBusy}
          >
            {flexImport.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Upload className="h-4 w-4" />
            )}
          </Button>
        </div>

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

        {error && (
          <div className="flex items-start gap-2 text-xs text-destructive">
            <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            <span className="line-clamp-3">
              {(error as Error).message}
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
