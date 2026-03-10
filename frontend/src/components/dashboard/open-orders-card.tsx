"use client";

import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useOpenOrders } from "@/lib/hooks/use-orders";
import { ClipboardList, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";

export function OpenOrdersCard() {
  const { data, isLoading, error } = useOpenOrders(5_000);

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Open Orders
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-16 w-full" />
        </CardContent>
      </Card>
    );
  }

  const orders = data?.orders ?? [];
  const orderCount = orders.length;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          Open Orders
        </CardTitle>
        <ClipboardList className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-baseline justify-between">
          <span className="text-2xl font-bold font-mono">{orderCount}</span>
          <span className="text-xs text-muted-foreground">
            {orderCount === 1 ? "order" : "orders"} working
          </span>
        </div>

        {/* Show first few orders */}
        {orders.length > 0 && (
          <div className="space-y-1.5 border-t border-border pt-2">
            {orders.slice(0, 4).map((order) => (
              <div
                key={order.orderId}
                className="flex items-center justify-between text-xs"
              >
                <div className="flex items-center gap-1.5">
                  <span className="font-mono font-semibold">
                    {order.symbol}
                  </span>
                  <Badge
                    variant={order.action === "BUY" ? "default" : "destructive"}
                    className="text-[10px] px-1 py-0"
                  >
                    {order.action}
                  </Badge>
                </div>
                <span
                  className={cn(
                    "font-mono text-muted-foreground",
                  )}
                >
                  {order.orderType}{" "}
                  {order.lmtPrice ? `@${order.lmtPrice.toFixed(2)}` : ""}
                </span>
              </div>
            ))}
            {orders.length > 4 && (
              <p className="text-xs text-muted-foreground">
                +{orders.length - 4} more
              </p>
            )}
          </div>
        )}

        <Link
          href="/orders"
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors pt-1"
        >
          View all orders <ExternalLink className="h-3 w-3" />
        </Link>
      </CardContent>
    </Card>
  );
}
