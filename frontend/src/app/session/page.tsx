"use client";

import { SessionStateCard } from "@/components/session/session-state-card";
import { RiskConfigCard } from "@/components/session/risk-config-card";
import { PositionSizer } from "@/components/session/position-sizer";
import { SessionEdgeCard } from "@/components/session/session-edge-card";

export default function SessionPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Session Risk Gate</h1>
        <p className="text-sm text-muted-foreground">
          Live session state, risk parameters, and position sizing
        </p>
      </div>

      <SessionStateCard />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <RiskConfigCard />
        <PositionSizer />
        <SessionEdgeCard />
      </div>
    </div>
  );
}
