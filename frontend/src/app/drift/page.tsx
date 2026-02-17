"use client";

import { useDriftReport, useDriftAlerts } from "@/lib/hooks/use-drift";
import { ModelHealthCards } from "@/components/drift/model-health-cards";
import { DriftAlertTable } from "@/components/drift/drift-alert-table";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, Activity } from "lucide-react";

export default function DriftPage() {
  const driftReport = useDriftReport();
  const driftAlerts = useDriftAlerts(50);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Drift Monitor</h1>
        <p className="text-sm text-muted-foreground">
          Model accuracy, calibration, and regime shift detection
        </p>
      </div>

      {/* Overall Status Banner */}
      {driftReport.data && (
        <Card className="border-l-4 border-l-emerald-400 bg-card">
          <CardContent className="py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Activity className="h-5 w-5 text-emerald-400" />
                <div>
                  <p className="text-sm font-medium">Overall Accuracy</p>
                  <p className="font-mono text-2xl font-bold">
                    {(driftReport.data.overall_accuracy * 100).toFixed(1)}%
                  </p>
                </div>
              </div>
              {driftReport.data.regime_shift_detected && (
                <Badge variant="destructive" className="gap-2">
                  <AlertTriangle className="h-4 w-4" />
                  Regime Shift Detected
                </Badge>
              )}
            </div>
            {driftReport.data.recommendation && (
              <p className="mt-3 text-sm text-muted-foreground">
                {driftReport.data.recommendation}
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Model Health Cards */}
      {driftReport.isLoading ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-80 rounded-lg" />
          ))}
        </div>
      ) : driftReport.error ? (
        <Card className="bg-card">
          <CardContent className="py-8 text-center">
            <p className="text-sm text-muted-foreground">
              Failed to load drift report: {(driftReport.error as Error).message}
            </p>
          </CardContent>
        </Card>
      ) : driftReport.data ? (
        <ModelHealthCards models={driftReport.data.by_model} />
      ) : null}

      {/* Drift Alerts Table */}
      {driftAlerts.isLoading ? (
        <Skeleton className="h-64 rounded-lg" />
      ) : driftAlerts.error ? (
        <Card className="bg-card">
          <CardContent className="py-8 text-center">
            <p className="text-sm text-muted-foreground">
              Failed to load drift alerts: {(driftAlerts.error as Error).message}
            </p>
          </CardContent>
        </Card>
      ) : driftAlerts.data ? (
        <DriftAlertTable alerts={driftAlerts.data.alerts} />
      ) : null}
    </div>
  );
}
