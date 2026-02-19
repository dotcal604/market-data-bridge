"use client";

import { AccountSummary } from "@/components/account/account-summary";
import { PositionsTable } from "@/components/account/positions-table";
import { FlattenControls } from "@/components/account/flatten-controls";
import { PortfolioExposureCard } from "@/components/account/portfolio-exposure";

export default function AccountPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Account</h1>
        <p className="text-sm text-muted-foreground mt-1">
          IBKR account summary and open positions
        </p>
      </div>

      <AccountSummary />

      <PortfolioExposureCard />

      <FlattenControls />

      <PositionsTable />
    </div>
  );
}
