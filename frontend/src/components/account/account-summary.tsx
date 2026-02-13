"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useStatus, useAccountSummary, usePnL } from "@/lib/hooks/use-account";
import { formatCurrency } from "@/lib/utils/formatters";
import { pnlColor } from "@/lib/utils/colors";
import { Wallet, TrendingUp, DollarSign, Activity, AlertCircle } from "lucide-react";

interface AccountSummaryProps {
  refreshInterval?: number;
}

export function AccountSummary({ refreshInterval = 10000 }: AccountSummaryProps) {
  const status = useStatus(refreshInterval);
  const summary = useAccountSummary(refreshInterval);
  const pnl = usePnL(refreshInterval);

  const isConnected = status.data?.ibkr?.connected ?? false;
  const isLoading = status.isLoading || summary.isLoading || pnl.isLoading;

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-48" />
        <div className="grid grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-32 rounded-lg" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header with connection status */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Account Summary</h1>
          <p className="text-sm text-muted-foreground">
            IBKR account overview and P&amp;L
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div
            className={`h-2 w-2 rounded-full ${
              isConnected ? "bg-emerald-400" : "bg-red-400"
            }`}
          />
          <span className="text-sm font-medium">
            {isConnected ? "Connected" : "Disconnected"}
          </span>
        </div>
      </div>

      {/* Not connected warning */}
      {!isConnected && (
        <Card className="border-orange-500/50 bg-orange-500/10">
          <CardContent className="flex items-center gap-3 py-4">
            <AlertCircle className="h-5 w-5 text-orange-400" />
            <div>
              <p className="text-sm font-medium text-orange-400">IBKR Not Connected</p>
              <p className="text-xs text-orange-400/80">
                Start TWS/Gateway to view account data
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Stat cards */}
      <div className="grid grid-cols-4 gap-4">
        {/* Net Liquidation */}
        <Card className="bg-card">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Net Liquidation
            </CardTitle>
            <Wallet className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono">
              {isConnected && summary.data
                ? formatCurrency(summary.data.netLiquidation)
                : "—"}
            </div>
            <p className="text-xs text-muted-foreground">
              {summary.data?.currency ?? "USD"}
            </p>
          </CardContent>
        </Card>

        {/* Buying Power */}
        <Card className="bg-card">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Buying Power
            </CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono">
              {isConnected && summary.data
                ? formatCurrency(summary.data.buyingPower)
                : "—"}
            </div>
            <p className="text-xs text-muted-foreground">Available</p>
          </CardContent>
        </Card>

        {/* Daily P&L */}
        <Card className="bg-card">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Daily P&amp;L
            </CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div
              className={`text-2xl font-bold font-mono ${
                isConnected && pnl.data
                  ? pnlColor(pnl.data.dailyPnL)
                  : "text-muted-foreground"
              }`}
            >
              {isConnected && pnl.data
                ? formatCurrency(pnl.data.dailyPnL)
                : "—"}
            </div>
            <p className="text-xs text-muted-foreground">Today</p>
          </CardContent>
        </Card>

        {/* Unrealized P&L */}
        <Card className="bg-card">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Unrealized P&amp;L
            </CardTitle>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div
              className={`text-2xl font-bold font-mono ${
                isConnected && pnl.data
                  ? pnlColor(pnl.data.unrealizedPnL)
                  : "text-muted-foreground"
              }`}
            >
              {isConnected && pnl.data
                ? formatCurrency(pnl.data.unrealizedPnL)
                : "—"}
            </div>
            <p className="text-xs text-muted-foreground">Open positions</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
