"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useStatus,
  useAccountSummary,
  usePnL,
} from "@/lib/hooks/use-account";
import { useSession } from "@/lib/hooks/use-session";
import { formatCurrency } from "@/lib/utils/formatters";
import { pnlColor } from "@/lib/utils/colors";
import {
  Wallet,
  TrendingUp,
  DollarSign,
  ShieldCheck,
  Lock,
} from "lucide-react";
import { cn } from "@/lib/utils";

export function DeskKPICards() {
  const status = useStatus(10_000);
  const summary = useAccountSummary(10_000);
  const pnl = usePnL(10_000);
  const session = useSession();

  const isConnected = status.data?.ibkr?.connected ?? false;
  const isLoading =
    status.isLoading || summary.isLoading || pnl.isLoading || session.isLoading;

  if (isLoading) {
    return (
      <div className="grid grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-32 rounded-lg" />
        ))}
      </div>
    );
  }

  // Portfolio value and daily change %
  const netLiq = isConnected ? summary.data?.netLiquidation : null;
  const dailyPnl = isConnected ? pnl.data?.dailyPnL : null;
  const unrealizedPnl = isConnected ? pnl.data?.unrealizedPnL : null;
  const buyingPower = isConnected ? summary.data?.buyingPower : null;
  const cashValue = isConnected ? summary.data?.totalCashValue : null;

  // Daily change % relative to previous close equity (netLiq - dailyPnl)
  const dailyChangePct =
    netLiq != null && dailyPnl != null && netLiq - dailyPnl !== 0
      ? (dailyPnl / (netLiq - dailyPnl)) * 100
      : null;

  // Session state
  const sessionData = session.data;
  const tradeCount = sessionData?.tradeCount ?? 0;
  const maxTrades = sessionData?.limits?.maxDailyTrades ?? 0;
  const isLocked = sessionData?.locked ?? false;

  return (
    <div className="grid grid-cols-4 gap-4">
      {/* Portfolio Value */}
      <Card className="bg-card">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Portfolio Value
          </CardTitle>
          <Wallet className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold font-mono">
            {netLiq != null ? formatCurrency(netLiq) : "---"}
          </div>
          <p
            className={cn(
              "text-xs font-mono",
              dailyChangePct != null
                ? dailyChangePct >= 0
                  ? "text-emerald-400"
                  : "text-red-400"
                : "text-muted-foreground"
            )}
          >
            {dailyChangePct != null
              ? `${dailyChangePct >= 0 ? "+" : ""}${dailyChangePct.toFixed(2)}% today`
              : "---"}
          </p>
        </CardContent>
      </Card>

      {/* Day P&L */}
      <Card className="bg-card">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Day P&L
          </CardTitle>
          <TrendingUp className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div
            className={cn(
              "text-2xl font-bold font-mono",
              dailyPnl != null
                ? pnlColor(dailyPnl)
                : "text-muted-foreground"
            )}
          >
            {dailyPnl != null ? formatCurrency(dailyPnl) : "---"}
          </div>
          <p
            className={cn(
              "text-xs font-mono",
              unrealizedPnl != null
                ? pnlColor(unrealizedPnl)
                : "text-muted-foreground"
            )}
          >
            {unrealizedPnl != null
              ? `${formatCurrency(unrealizedPnl)} unrealized`
              : "---"}
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
            {buyingPower != null ? formatCurrency(buyingPower) : "---"}
          </div>
          <p className="text-xs text-muted-foreground font-mono">
            {cashValue != null ? `${formatCurrency(cashValue)} cash` : "---"}
          </p>
        </CardContent>
      </Card>

      {/* Session State */}
      <Card
        className={cn(
          "bg-card",
          isLocked && "border-orange-500/50"
        )}
      >
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Session
          </CardTitle>
          {isLocked ? (
            <Lock className="h-4 w-4 text-orange-400" />
          ) : (
            <ShieldCheck className="h-4 w-4 text-muted-foreground" />
          )}
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold font-mono">
            {tradeCount} / {maxTrades}
          </div>
          <p
            className={cn(
              "text-xs",
              isLocked ? "text-orange-400 font-medium" : "text-muted-foreground"
            )}
          >
            {isLocked
              ? `Locked: ${sessionData?.lockReason ?? "manual"}`
              : "trades today"}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
