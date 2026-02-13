"use client";

import { OrdersPanel } from "@/components/account/orders-panel";

export default function OrdersPage() {
  return (
    <div className="container mx-auto py-8 px-4">
      <div className="mb-6">
        <h1 className="text-3xl font-bold tracking-tight">Orders</h1>
        <p className="text-muted-foreground mt-2">
          Manage open orders and view completed orders
        </p>
      </div>
      <OrdersPanel />
    </div>
  );
}
