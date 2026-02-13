"use client";

import Link from "next/link";
import type { Evaluation } from "@/lib/api/types";
import { ScoreBadge } from "@/components/shared/score-badge";
import { DirectionBadge } from "@/components/shared/direction-badge";
import { formatTimeAgo, formatMs, formatPrice } from "@/lib/utils/formatters";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowRight } from "lucide-react";

interface Props {
  evaluations: Evaluation[];
}

export function RecentEvalsMini({ evaluations }: Props) {
  if (evaluations.length === 0) {
    return (
      <Card className="flex items-center justify-center p-8 text-sm text-muted-foreground">
        No evaluations yet. Run one via the API to see data here.
      </Card>
    );
  }

  return (
    <div className="space-y-2">
      {evaluations.map((ev) => (
        <Link key={ev.id} href={`/evals/${ev.id}`}>
          <Card className="flex items-center gap-4 px-4 py-3 transition-colors hover:bg-accent/50">
            <div className="flex items-center gap-2 w-32">
              <span className="font-mono text-sm font-semibold">{ev.symbol}</span>
              <DirectionBadge direction={ev.direction} />
            </div>

            <ScoreBadge score={ev.ensemble_trade_score} />

            <span className="font-mono text-xs text-muted-foreground w-20">
              {formatPrice(ev.last_price)}
            </span>

            <Badge
              variant={ev.guardrail_allowed ? "default" : "destructive"}
              className="text-[10px]"
            >
              {ev.guardrail_allowed ? "ALLOWED" : "BLOCKED"}
            </Badge>

            <span className="font-mono text-xs text-muted-foreground">
              {formatMs(ev.total_latency_ms)}
            </span>

            <span className="ml-auto text-xs text-muted-foreground">
              {formatTimeAgo(ev.timestamp)}
            </span>

            <ArrowRight className="h-3 w-3 text-muted-foreground" />
          </Card>
        </Link>
      ))}
    </div>
  );
}
