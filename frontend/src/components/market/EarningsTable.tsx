"use client";

import { useState, useEffect } from "react";
import { TrendingUp } from "lucide-react";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { marketClient } from "@/lib/api/market-client";
import type { EarningsData } from "@/lib/api/types";
import { cn } from "@/lib/utils";

interface EarningsTableProps {
  symbol: string;
}

export function EarningsTable({ symbol }: EarningsTableProps) {
  const [earnings, setEarnings] = useState<EarningsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!symbol) {
      setEarnings(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    marketClient
      .getEarnings(symbol)
      .then((data) => {
        setEarnings(data);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message || "Failed to load earnings");
        setLoading(false);
      });
  }, [symbol]);

  const calculateSurprise = (actual: number | null, estimate: number | null) => {
    if (actual === null || estimate === null || estimate === 0) return null;
    return ((actual - estimate) / Math.abs(estimate)) * 100;
  };

  if (loading) {
    return (
      <Card className="p-6">
        <div className="flex items-center gap-2 mb-4">
          <TrendingUp className="h-5 w-5 text-emerald-400" />
          <h2 className="text-lg font-semibold">Earnings History</h2>
        </div>
        <div className="space-y-2">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="animate-pulse flex gap-4">
              <div className="h-4 bg-muted rounded w-20"></div>
              <div className="h-4 bg-muted rounded w-20"></div>
              <div className="h-4 bg-muted rounded w-20"></div>
              <div className="h-4 bg-muted rounded w-20"></div>
            </div>
          ))}
        </div>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="p-6">
        <div className="flex items-center gap-2 mb-4">
          <TrendingUp className="h-5 w-5 text-emerald-400" />
          <h2 className="text-lg font-semibold">Earnings History</h2>
        </div>
        <div className="text-sm text-red-400">{error}</div>
      </Card>
    );
  }

  if (!earnings || earnings.earningsChart.length === 0) {
    return (
      <Card className="p-6">
        <div className="flex items-center gap-2 mb-4">
          <TrendingUp className="h-5 w-5 text-emerald-400" />
          <h2 className="text-lg font-semibold">Earnings History</h2>
        </div>
        <div className="text-sm text-muted-foreground">
          No earnings data available for {symbol}
        </div>
      </Card>
    );
  }

  // Reverse to show most recent first
  const sortedEarnings = [...earnings.earningsChart].reverse();

  return (
    <Card className="p-6">
      <div className="flex items-center gap-2 mb-4">
        <TrendingUp className="h-5 w-5 text-emerald-400" />
        <h2 className="text-lg font-semibold">Earnings History</h2>
        <span className="text-sm text-muted-foreground ml-auto">
          {sortedEarnings.length} quarters
        </span>
      </div>

      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="font-mono">Quarter</TableHead>
              <TableHead className="text-right font-mono">Estimate</TableHead>
              <TableHead className="text-right font-mono">Actual</TableHead>
              <TableHead className="text-right font-mono">Surprise</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sortedEarnings.map((quarter, index) => {
              const surprise = calculateSurprise(quarter.actual, quarter.estimate);
              const hasBeat = surprise !== null && surprise > 0;
              const hasMiss = surprise !== null && surprise < 0;

              return (
                <TableRow key={index}>
                  <TableCell className="font-mono text-sm">
                    {quarter.quarter}
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm">
                    {quarter.estimate !== null ? `$${quarter.estimate.toFixed(2)}` : "—"}
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm">
                    {quarter.actual !== null ? `$${quarter.actual.toFixed(2)}` : "—"}
                  </TableCell>
                  <TableCell
                    className={cn(
                      "text-right font-mono text-sm font-medium",
                      hasBeat && "text-emerald-400",
                      hasMiss && "text-red-400",
                      !hasBeat && !hasMiss && "text-muted-foreground"
                    )}
                  >
                    {surprise !== null
                      ? `${surprise > 0 ? "+" : ""}${surprise.toFixed(1)}%`
                      : "—"}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </Card>
  );
}
