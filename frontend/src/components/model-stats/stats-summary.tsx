"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { EvalStats } from "@/lib/api/types";
import { formatPercent, formatMs, formatRMultiple } from "@/lib/utils/formatters";
import { Activity, Target, TrendingUp, Shield } from "lucide-react";

interface Props {
  stats: EvalStats;
}

export function StatsSummary({ stats }: Props) {
  const cards = [
    {
      title: "Total Evaluations",
      value: stats.total_evaluations.toLocaleString(),
      subtitle: "Processed",
      icon: Activity,
    },
    {
      title: "Avg Ensemble Score",
      value: stats.avg_score?.toFixed(1) ?? "—",
      subtitle: "Out of 10",
      icon: Target,
    },
    {
      title: "Trade Rate",
      value: formatPercent(stats.trade_rate),
      subtitle: "Should trade = true",
      icon: TrendingUp,
    },
    {
      title: "Avg R-Multiple",
      value: formatRMultiple(stats.avg_r_multiple),
      subtitle: `${stats.outcomes_recorded} outcomes`,
      icon: Shield,
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
            <div className="text-2xl font-bold font-mono">{card.value}</div>
            <p className="text-xs text-muted-foreground">{card.subtitle}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
