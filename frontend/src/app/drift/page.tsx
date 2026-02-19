"use client";

import { useDriftReport, useDriftAlerts } from "@/lib/hooks/use-drift";
import { ModelHealthCards } from "@/components/drift/model-health-cards";
import { DriftAlertTable } from "@/components/drift/drift-alert-table";

export default function DriftPage() {
  const { data: report, isLoading: reportLoading } = useDriftReport();
  const { data: alertsData, isLoading: alertsLoading } = useDriftAlerts();

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-xl font-semibold">Drift Monitor</h1>
        <p className="text-sm text-muted-foreground">
          Rolling model accuracy, calibration error, and regime-shift detection
        </p>
      </div>

      {reportLoading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-28 animate-pulse rounded-lg border border-border bg-card" />
          ))}
        </div>
      ) : (
        <ModelHealthCards report={report} />
      )}

      <div>
        <h2 className="mb-3 text-sm font-medium text-muted-foreground">Drift Alerts</h2>
        {alertsLoading ? (
          <div className="rounded-lg border border-border bg-card p-8 text-center text-muted-foreground">
            Loading alerts...
          </div>
        ) : (
          <DriftAlertTable alerts={alertsData?.alerts ?? []} />
        )}
      </div>
    </div>
  );
}
