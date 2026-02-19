"use client";

import { usePortfolioExposure } from "@/lib/hooks/use-account";
import type { PortfolioExposure } from "@/lib/api/account-client";

function fmt(n: number, decimals = 1): string {
  return n.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function fmtDollar(n: number): string {
  return "$" + n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function MetricCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-semibold tabular-nums">{value}</p>
      {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}

export function PortfolioExposureCard() {
  const { data, isLoading, error } = usePortfolioExposure();

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-20 animate-pulse rounded-lg border border-border bg-card" />
        ))}
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
        Portfolio exposure unavailable {error ? `(${error.message})` : ""}
      </div>
    );
  }

  const heatColor =
    data.portfolioHeat > 3 ? "text-red-400" : data.portfolioHeat > 1.5 ? "text-yellow-400" : "text-emerald-400";

  return (
    <div className="space-y-3">
      <h2 className="text-sm font-medium text-muted-foreground">Portfolio Exposure</h2>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <MetricCard label="Gross Exposure" value={fmtDollar(data.grossExposure)} sub={`${fmt(data.percentDeployed)}% deployed`} />
        <MetricCard label="Net Exposure" value={fmtDollar(data.netExposure)} sub={`${data.positionCount} positions`} />
        <MetricCard label="Beta-Weighted" value={fmt(data.betaWeightedExposure, 2)} sub={`vs SPY`} />
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground">Portfolio Heat</p>
          <p className={`mt-1 text-lg font-semibold tabular-nums ${heatColor}`}>{fmt(data.portfolioHeat, 2)}</p>
          {data.largestPosition && (
            <p className="text-xs text-muted-foreground">Largest: {data.largestPosition} ({fmt(data.largestPositionPercent)}%)</p>
          )}
        </div>
      </div>

      {Object.keys(data.sectorBreakdown).length > 0 && (
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="mb-2 text-xs font-medium text-muted-foreground">Sector Breakdown</p>
          <div className="flex flex-wrap gap-2">
            {Object.entries(data.sectorBreakdown)
              .sort(([, a], [, b]) => b - a)
              .map(([sector, pct]) => (
                <span key={sector} className="inline-flex items-center rounded-md bg-muted px-2 py-1 text-xs">
                  {sector}: {fmt(pct)}%
                </span>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}
