"use client";

import { useHollyStats } from "@/lib/hooks/use-holly";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Activity, AlertCircle, TrendingUp } from "lucide-react";

export function HollyStats() {
  const { data, isLoading, error } = useHollyStats();

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Holly AI Statistics</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <AlertCircle className="h-4 w-4" />
            <span>Failed to load stats</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (isLoading) {
    return (
      <div className="grid grid-cols-3 gap-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-28 rounded-lg" />
        ))}
      </div>
    );
  }

  if (!data) {
    return null;
  }

  const cards = [
    {
      title: "Total Alerts",
      value: data.total_alerts.toLocaleString(),
      subtitle: `${data.import_batches} import batches`,
      icon: Activity,
    },
    {
      title: "Unique Symbols",
      value: data.unique_symbols.toLocaleString(),
      subtitle: `${data.unique_strategies} strategies`,
      icon: TrendingUp,
    },
    {
      title: "Days Active",
      value: data.days_with_alerts.toLocaleString(),
      subtitle: data.last_alert
        ? `Latest: ${new Date(data.last_alert).toLocaleDateString()}`
        : "No alerts yet",
      icon: AlertCircle,
    },
  ];

  return (
    <div className="grid grid-cols-3 gap-4">
      {cards.map((card) => (
        <Card key={card.title} className="bg-card">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {card.title}
            </CardTitle>
            <card.icon className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{card.value}</div>
            <p className="text-xs text-muted-foreground">{card.subtitle}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
