"use client";

import { OrdersPanel } from "@/components/account/orders-panel";
import { OrderEntryForm } from "@/components/orders/OrderEntryForm";

export default function OrdersPage() {
  return (
    <div className="container mx-auto py-8 px-4">
      <div className="mb-6">
        <h1 className="text-3xl font-bold tracking-tight">Orders</h1>
        <p className="text-muted-foreground mt-2">
          Place new orders and manage existing orders
        </p>
      </div>
      
      <div className="space-y-6">
        {/* Order Entry Form */}
        <OrderEntryForm />
        
        {/* Open and Completed Orders */}
        <OrdersPanel />
      </div>
    </div>
  );
}
