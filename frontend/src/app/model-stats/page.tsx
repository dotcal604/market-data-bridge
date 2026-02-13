"use client";

import { useEvalStats } from "@/lib/hooks/use-evals";
import { StatsSummary } from "@/components/model-stats/stats-summary";
import { ModelComparison } from "@/components/model-stats/model-comparison";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";

export default function ModelStatsPage() {
  const stats = useEvalStats();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Model Statistics</h1>
        <p className="text-sm text-muted-foreground">
          Per-model performance, compliance rates, and comparison metrics
        </p>
      </div>

      {stats.isLoading ? (
        <>
          <div className="grid grid-cols-4 gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-28 rounded-lg" />
            ))}
          </div>
          <Skeleton className="h-64 rounded-lg" />
        </>
      ) : stats.error ? (
        <Card className="bg-card">
          <CardContent className="py-8 text-center">
            <p className="text-sm text-muted-foreground">
              Failed to load stats: {(stats.error as Error).message}
            </p>
          </CardContent>
        </Card>
      ) : !stats.data || stats.data.total_evaluations === 0 ? (
        <Card className="bg-card">
          <CardContent className="py-12 text-center">
            <p className="text-lg font-medium text-muted-foreground">No evaluations yet</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Run your first evaluation to see model statistics
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          <StatsSummary stats={stats.data} />
          <ModelComparison stats={stats.data} />
        </div>
      )}
    </div>
  );
}
