"use client";

import { useState } from "react";
import { Trash2, AlertTriangle } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  useOpenOrders,
  useCompletedOrders,
  useCancelOrder,
  useCancelAllOrders,
} from "@/lib/hooks/use-orders";

interface OrdersPanelProps {
  refreshInterval?: number;
}

export function OrdersPanel({ refreshInterval = 5000 }: OrdersPanelProps) {
  const openRefresh = refreshInterval;
  const completedRefresh = refreshInterval * 6; // 30s if default is 5s

  const { data: openData, isLoading: openLoading } = useOpenOrders(openRefresh);
  const { data: completedData, isLoading: completedLoading } = useCompletedOrders(completedRefresh);
  const cancelMutation = useCancelOrder();
  const cancelAllMutation = useCancelAllOrders();

  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [cancelAllDialogOpen, setCancelAllDialogOpen] = useState(false);
  const [orderIdToCancel, setOrderIdToCancel] = useState<number | null>(null);
  const [cancelAllText, setCancelAllText] = useState("");

  const handleCancelOrder = (orderId: number) => {
    setOrderIdToCancel(orderId);
    setCancelDialogOpen(true);
  };

  const confirmCancelOrder = () => {
    if (orderIdToCancel !== null) {
      cancelMutation.mutate(orderIdToCancel, {
        onSuccess: () => {
          setCancelDialogOpen(false);
          setOrderIdToCancel(null);
        },
      });
    }
  };

  const handleCancelAll = () => {
    setCancelAllDialogOpen(true);
    setCancelAllText("");
  };

  const confirmCancelAll = () => {
    if (cancelAllText === "CANCEL ALL") {
      cancelAllMutation.mutate(undefined, {
        onSuccess: () => {
          setCancelAllDialogOpen(false);
          setCancelAllText("");
        },
      });
    }
  };

  const formatPrice = (price: number | null) => {
    if (price === null) return "—";
    if (price === 0) return "$0.00"; // Valid price, show explicitly
    // Handle negative prices (shouldn't occur for limit/stop prices, but handle defensively)
    const absPrice = Math.abs(price);
    const sign = price < 0 ? "-" : "";
    return `${sign}$${absPrice.toFixed(2)}`;
  };

  const formatTimestamp = (timestamp: string) => {
    if (!timestamp) return "—";
    try {
      const date = new Date(timestamp);
      return date.toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return timestamp;
    }
  };

  const getSideBadge = (action: "BUY" | "SELL") => {
    const isBuy = action === "BUY";
    return (
      <Badge
        className={
          isBuy
            ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30"
            : "bg-red-500/20 text-red-400 border-red-500/30"
        }
      >
        {action}
      </Badge>
    );
  };

  return (
    <>
      <Tabs defaultValue="open" className="w-full">
        <div className="flex items-center justify-between mb-4">
          <TabsList>
            <TabsTrigger value="open">
              Open Orders {openData && `(${openData.count})`}
            </TabsTrigger>
            <TabsTrigger value="completed">
              Completed Orders {completedData && `(${completedData.count})`}
            </TabsTrigger>
          </TabsList>
          {openData && openData.count > 0 && (
            <Button
              variant="destructive"
              size="sm"
              onClick={handleCancelAll}
              disabled={cancelAllMutation.isPending}
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Cancel All Orders
            </Button>
          )}
        </div>

        <TabsContent value="open">
          <Card>
            <CardContent className="p-0">
              {openLoading ? (
                <div className="p-6 space-y-3">
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                </div>
              ) : openData && openData.orders.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Order ID</TableHead>
                      <TableHead>Symbol</TableHead>
                      <TableHead>Side</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead className="text-right">Qty</TableHead>
                      <TableHead className="text-right">Limit</TableHead>
                      <TableHead className="text-right">Stop</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>TIF</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {openData.orders.map((order) => (
                      <TableRow key={order.orderId}>
                        <TableCell className="font-mono">
                          {order.orderId}
                        </TableCell>
                        <TableCell className="font-semibold">
                          {order.symbol}
                        </TableCell>
                        <TableCell>{getSideBadge(order.action)}</TableCell>
                        <TableCell className="text-muted-foreground">
                          {order.orderType}
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {order.totalQuantity}
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {formatPrice(order.lmtPrice)}
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {formatPrice(order.auxPrice)}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">{order.status}</Badge>
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {order.tif || "—"}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleCancelOrder(order.orderId)}
                            disabled={cancelMutation.isPending}
                          >
                            <Trash2 className="h-4 w-4 text-red-400" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <div className="p-12 text-center text-muted-foreground">
                  No open orders
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="completed">
          <Card>
            <CardContent className="p-0">
              {completedLoading ? (
                <div className="p-6 space-y-3">
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                </div>
              ) : completedData && completedData.orders.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Order ID</TableHead>
                      <TableHead>Symbol</TableHead>
                      <TableHead>Side</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead className="text-right">Filled Qty</TableHead>
                      <TableHead className="text-right">Avg Fill Price</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Time</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {completedData.orders.map((order) => (
                      <TableRow key={order.orderId}>
                        <TableCell className="font-mono">
                          {order.orderId}
                        </TableCell>
                        <TableCell className="font-semibold">
                          {order.symbol}
                        </TableCell>
                        <TableCell>{getSideBadge(order.action)}</TableCell>
                        <TableCell className="text-muted-foreground">
                          {order.orderType}
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {order.filledQuantity}
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {formatPrice(order.avgFillPrice)}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">{order.status}</Badge>
                        </TableCell>
                        <TableCell className="text-muted-foreground text-sm">
                          {formatTimestamp(order.completedTime)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <div className="p-12 text-center text-muted-foreground">
                  No completed orders
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Cancel Single Order Dialog */}
      <Dialog open={cancelDialogOpen} onOpenChange={setCancelDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancel Order</DialogTitle>
            <DialogDescription>
              Are you sure you want to cancel order #{orderIdToCancel}? This
              action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setCancelDialogOpen(false)}
              disabled={cancelMutation.isPending}
            >
              No, Keep Order
            </Button>
            <Button
              variant="destructive"
              onClick={confirmCancelOrder}
              disabled={cancelMutation.isPending}
            >
              Yes, Cancel Order
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Cancel All Orders Dialog */}
      <Dialog open={cancelAllDialogOpen} onOpenChange={setCancelAllDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-400">
              <AlertTriangle className="h-5 w-5" />
              Cancel All Orders
            </DialogTitle>
            <DialogDescription>
              This will cancel ALL open orders. Type{" "}
              <span className="font-mono font-semibold text-foreground">
                CANCEL ALL
              </span>{" "}
              to confirm.
            </DialogDescription>
          </DialogHeader>
          <Input
            value={cancelAllText}
            onChange={(e) => setCancelAllText(e.target.value)}
            placeholder="Type CANCEL ALL"
            className="font-mono"
          />
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setCancelAllDialogOpen(false);
                setCancelAllText("");
              }}
              disabled={cancelAllMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={confirmCancelAll}
              disabled={
                cancelAllText !== "CANCEL ALL" || cancelAllMutation.isPending
              }
            >
              Confirm Cancel All
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
