"use client";

import { SessionStatus } from "@/components/session/SessionStatus";
import { RiskConfig } from "@/components/session/RiskConfig";

export default function SessionPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Session Risk Gate</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Trading session state, risk limits, and controls
        </p>
      </div>

      <SessionStatus />

      <RiskConfig />
    </div>
  );
}
