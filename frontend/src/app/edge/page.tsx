"use client";

import { useEdgeReport } from "@/lib/hooks/use-edge";
import { EdgeScoreCard } from "@/components/edge/edge-score-card";
import { EquityCurveChart } from "@/components/edge/equity-curve-chart";
import { RollingMetricsChart } from "@/components/edge/rolling-metrics-chart";
import { FeatureAttributionTable } from "@/components/edge/feature-attribution-table";
import { WalkForwardPanel } from "@/components/edge/walk-forward-panel";

export default function EdgePage() {
  const { data: report, isLoading } = useEdgeReport(90);

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-xl font-semibold">Edge Analytics</h1>
        <p className="text-sm text-muted-foreground">
          Validates whether ensemble scoring produces real edge or just noise. Sharpe, Sortino, walk-forward validation, and feature attribution.
        </p>
      </div>

      {isLoading ? (
        <div className="rounded-lg border border-border bg-card p-8 text-center text-muted-foreground">
          Computing edge analytics...
        </div>
      ) : (
        <>
          <EdgeScoreCard stats={report?.current} />

          <div className="grid gap-4 lg:grid-cols-2">
            <EquityCurveChart data={report?.rolling_metrics ?? []} />
            <RollingMetricsChart data={report?.rolling_metrics ?? []} />
          </div>

          <div>
            <h2 className="mb-3 text-sm font-medium text-muted-foreground">
              Feature Attribution
            </h2>
            <p className="mb-2 text-xs text-muted-foreground">
              Which features predict winners? Splits trades on each feature's median and compares win rates. SIG = statistically significant lift.
            </p>
            <FeatureAttributionTable features={report?.feature_attribution ?? []} />
          </div>

          <div>
            <h2 className="mb-3 text-sm font-medium text-muted-foreground">
              Walk-Forward Validation
            </h2>
            <p className="mb-2 text-xs text-muted-foreground">
              Optimizes weights on training window, tests on out-of-sample window. Proves edge isn't overfit.
            </p>
            <WalkForwardPanel result={report?.walk_forward} />
          </div>
        </>
      )}
    </div>
  );
}
