"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useTraderSyncStats, useTraderSyncImport } from "@/lib/hooks/use-tradersync";
import { useDropZone } from "@/lib/hooks/use-drop-zone";
import type { TraderSyncImportResult } from "@/lib/api/tradersync-client";
import { formatCurrency, formatPercent, formatRMultiple } from "@/lib/utils/formatters";
import { Upload, CheckCircle, AlertCircle, Loader2 } from "lucide-react";

/** Read a File as text — extracted for testability */
export async function readFileText(file: File): Promise<string> {
  return file.text();
}

export function TraderSyncImportCard({
  readFile = readFileText,
}: {
  readFile?: (file: File) => Promise<string>;
} = {}) {
  const { data: stats, isLoading } = useTraderSyncStats();
  const importMutation = useTraderSyncImport();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [lastResult, setLastResult] = useState<TraderSyncImportResult | null>(null);

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
        const csv = await readFile(file);
        const result = await importMutation.mutateAsync(csv);
        setLastResult(result);
      } catch {
        // error available via importMutation.error
      }
    },
    [readFile, importMutation],
  );

  const { isDragging, dropZoneProps } = useDropZone({
    accept: [".csv"],
    onDrop: handleFileDrop,
    disabled: importMutation.isPending,
  });

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) await handleFileDrop(file);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  return (
    <Card
      {...dropZoneProps}
      className={isDragging ? "ring-2 ring-primary ring-offset-2" : ""}
    >
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">TraderSync Import</CardTitle>
        <Upload className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent className="space-y-3">
        {isDragging ? (
          <div className="flex items-center justify-center rounded border-2 border-dashed border-primary/50 py-4">
            <p className="text-xs text-muted-foreground">
              Drop CSV file here
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
              <span>Win rate</span>
              <span className="font-medium text-foreground">
                {stats.win_rate != null ? formatPercent(stats.win_rate) : "N/A"} ({stats.wins}W / {stats.losses}L)
              </span>
            </div>
            <div className="flex justify-between">
              <span>Total P&L</span>
              <span
                className={`font-medium ${
                  (stats.total_pnl ?? 0) >= 0 ? "text-green-500" : "text-red-500"
                }`}
              >
                {formatCurrency(stats.total_pnl)}
              </span>
            </div>
            <div className="flex justify-between">
              <span>Avg R</span>
              <span
                className={`font-medium ${
                  (stats.avg_r ?? 0) >= 0 ? "text-green-500" : "text-red-500"
                }`}
              >
                {formatRMultiple(stats.avg_r)}
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
          accept=".csv"
          className="hidden"
          onChange={handleFileSelect}
        />

        <Button
          className="w-full"
          size="sm"
          onClick={() => fileInputRef.current?.click()}
          disabled={importMutation.isPending}
        >
          {importMutation.isPending ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Importing...
            </>
          ) : (
            <>
              <Upload className="mr-2 h-4 w-4" />
              Upload CSV
            </>
          )}
        </Button>

        {lastResult && (
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-xs">
              <CheckCircle className="h-3.5 w-3.5 shrink-0 text-green-500" />
              <span>
                Parsed {lastResult.total_parsed}, imported {lastResult.inserted}, skipped {lastResult.skipped}
              </span>
            </div>
            {lastResult.errors.length > 0 && (
              <p className="text-xs text-muted-foreground pl-5">
                {lastResult.errors.length} warning{lastResult.errors.length > 1 ? "s" : ""}
              </p>
            )}
          </div>
        )}

        {importMutation.error && (
          <div className="flex items-start gap-2 text-xs text-destructive">
            <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            <span className="line-clamp-3">
              {(importMutation.error as Error).message}
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
