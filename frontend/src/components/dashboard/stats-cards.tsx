"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { EvalStats } from "@/lib/api/types";
import { formatPercent, formatMs, formatRMultiple } from "@/lib/utils/formatters";
import { Activity, Target, Shield, TrendingUp } from "lucide-react";

interface Props {
  stats: EvalStats;
}

export function StatsCards({ stats }: Props) {
  const cards = [
    {
      title: "Total Evals",
      value: stats.total_evaluations.toLocaleString(),
      subtitle: `Avg score: ${stats.avg_score?.toFixed(1) ?? "—"}`,
      icon: Activity,
    },
    {
      title: "Trade Rate",
      value: formatPercent(stats.trade_rate),
      subtitle: `Guardrail block: ${formatPercent(stats.guardrail_block_rate)}`,
      icon: Target,
    },
    {
      title: "Avg Latency",
      value: formatMs(stats.avg_latency_ms),
      subtitle: "End-to-end pipeline",
      icon: Shield,
    },
    {
      title: "Avg R-Multiple",
      value: formatRMultiple(stats.avg_r_multiple),
      subtitle: `${stats.outcomes_recorded} outcomes recorded`,
      icon: TrendingUp,
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
