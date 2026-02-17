"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useHollyStats } from "@/lib/hooks/use-holly";
import { Activity, Target, TrendingUp, Calendar } from "lucide-react";
import { formatTimeAgo } from "@/lib/utils/formatters";

export function HollyStats() {
  const { data, isLoading, error } = useHollyStats();

  if (isLoading) {
    return (
      <div className="grid grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => (
          <Card key={i} className="bg-card animate-pulse">
            <CardHeader className="pb-2">
              <div className="h-4 w-24 bg-muted rounded" />
            </CardHeader>
            <CardContent>
              <div className="h-8 w-16 bg-muted rounded mb-1" />
              <div className="h-3 w-32 bg-muted rounded" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  if (error || !data) {
    return (
      <Card className="bg-card">
        <CardContent className="flex items-center justify-center p-8 text-sm text-muted-foreground">
          {error ? `Error: ${error.message}` : "No Holly stats available"}
        </CardContent>
      </Card>
    );
  }

  const cards = [
    {
      title: "Total Alerts",
      value: data.total_alerts.toLocaleString(),
      subtitle: `${data.unique_symbols} unique symbols`,
      icon: Activity,
    },
    {
      title: "Strategies",
      value: data.unique_strategies.toLocaleString(),
      subtitle: `${data.days_with_alerts} days with alerts`,
      icon: Target,
    },
    {
      title: "Import Batches",
      value: data.import_batches.toLocaleString(),
      subtitle: "Total imports",
      icon: TrendingUp,
    },
    {
      title: "Latest Alert",
      value: data.last_alert ? formatTimeAgo(data.last_alert) : "—",
      subtitle: data.first_alert ? `First: ${formatTimeAgo(data.first_alert)}` : "—",
      icon: Calendar,
    },
  ];

  return (
    <div className="grid grid-cols-4 gap-4">
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
