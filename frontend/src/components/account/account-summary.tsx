"use client";

import { useAccountSummary } from "@/lib/hooks/use-account";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { DollarSign, TrendingUp, Wallet, Shield } from "lucide-react";
import { formatCurrency } from "@/lib/utils/formatters";

export function AccountSummary() {
  const { data, isLoading, error } = useAccountSummary();

  if (isLoading) {
    return (
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {[...Array(4)].map((_, i) => (
          <Card key={i}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-4 w-4 rounded" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-8 w-32 mb-1" />
              <Skeleton className="h-3 w-24" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  if (error || data?.error) {
    return (
      <Card>
        <CardContent className="pt-6">
          <div className="text-sm text-red-400">
            {data?.error || (error as Error)?.message || "Failed to load account summary"}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!data?.summary) {
    return (
      <Card>
        <CardContent className="pt-6">
          <div className="text-sm text-muted-foreground">
            No account data available
          </div>
        </CardContent>
      </Card>
    );
  }

  const { summary } = data;

  const cards = [
    {
      title: "Net Liquidation",
      value: summary.netLiquidation,
      subtitle: `Account: ${summary.account}`,
      icon: DollarSign,
    },
    {
      title: "Buying Power",
      value: summary.buyingPower,
      subtitle: "Available to trade",
      icon: TrendingUp,
    },
    {
      title: "Cash",
      value: summary.totalCashValue,
      subtitle: `Settled: ${summary.settledCash !== null ? formatCurrency(summary.settledCash) : "—"}`,
      icon: Wallet,
    },
    {
      title: "Excess Liquidity",
      value: summary.excessLiquidity,
      subtitle: "Above margin req",
      icon: Shield,
    },
  ];

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      {cards.map((card) => {
        const Icon = card.icon;
        return (
          <Card key={card.title}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">{card.title}</CardTitle>
              <Icon className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold font-mono">
                {card.value !== null ? formatCurrency(card.value) : "—"}
              </div>
              <p className="text-xs text-muted-foreground">{card.subtitle}</p>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
