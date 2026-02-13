"use client";

import { useEvalStats, useCalibrationData } from "@/lib/hooks/use-evals";
import { StatsSummary } from "@/components/model-stats/stats-summary";
import { ModelComparison } from "@/components/model-stats/model-comparison";
import { CalibrationCurve } from "@/components/charts/CalibrationCurve";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";

export default function ModelStatsPage() {
  const stats = useEvalStats();
  const calibrationData = useCalibrationData(500);

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

          {/* Calibration Curve Section */}
          <div>
            <h2 className="mb-4 text-xl font-semibold">Calibration Analysis</h2>
            {calibrationData.isLoading ? (
              <Skeleton className="h-[480px] rounded-lg" />
            ) : calibrationData.error ? (
              <Card className="bg-card">
                <CardContent className="py-8 text-center">
                  <p className="text-sm text-muted-foreground">
                    Failed to load calibration data: {(calibrationData.error as Error).message}
                  </p>
                </CardContent>
              </Card>
            ) : calibrationData.data && calibrationData.data.data.length > 0 ? (
              <CalibrationCurve data={calibrationData.data.data} />
            ) : (
              <Card className="bg-card">
                <CardContent className="py-12 text-center">
                  <p className="text-lg font-medium text-muted-foreground">
                    No outcomes recorded yet
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Record trade outcomes to see calibration analysis
                  </p>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
