"use client";

import { useEvalStats, useEvalHistory } from "@/lib/hooks/use-evals";
import { useHollyStats } from "@/lib/hooks/use-holly";
import { StatsCards } from "@/components/dashboard/stats-cards";
import { RecentEvalsMini } from "@/components/dashboard/recent-evals-mini";
import { HollyStats } from "@/components/dashboard/holly-stats";
import { HollyAlerts } from "@/components/dashboard/holly-alerts";
import { Skeleton } from "@/components/ui/skeleton";

export default function DashboardPage() {
  const stats = useEvalStats();
  const history = useEvalHistory(10);
  const hollyStatsQuery = useHollyStats();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          3-model ensemble evaluation engine
        </p>
      </div>

      {stats.isLoading ? (
        <div className="grid grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-28 rounded-lg" />
          ))}
        </div>
      ) : stats.data ? (
        <StatsCards stats={stats.data} />
      ) : (
        <p className="text-sm text-muted-foreground">Failed to load stats</p>
      )}

      <div>
        <h2 className="mb-3 text-lg font-semibold">Recent Evaluations</h2>
        {history.isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-12 rounded-lg" />
            ))}
          </div>
        ) : history.data ? (
          <RecentEvalsMini evaluations={history.data.evaluations} />
        ) : (
          <p className="text-sm text-muted-foreground">No evaluations yet</p>
        )}
      </div>

      {/* Holly AI Alerts Section - Only show if data is available */}
      {hollyStatsQuery.data && hollyStatsQuery.data.total_alerts > 0 && (
        <>
          <div className="pt-4">
            <h2 className="mb-3 text-lg font-semibold">Holly AI Alerts</h2>
          </div>

          <HollyStats />

          <HollyAlerts limit={10} />
        </>
      )}
    </div>
  );
}
