"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { usePlaceOrder, useQuote } from "@/lib/hooks/use-orders";
import type { PlaceOrderRequest } from "@/lib/api/types";
import { TrendingUp, TrendingDown, Loader2, AlertTriangle } from "lucide-react";

type OrderType = "MKT" | "LMT" | "STP" | "STP LMT" | "TRAIL" | "TRAIL LIMIT" | "REL" | "MIT" | "MOC" | "LOC";
type Action = "BUY" | "SELL";
type TIF = "DAY" | "GTC" | "IOC" | "GTD";
type TrailingMode = "amount" | "percent";

export function OrderEntryForm() {
  // Form state
  const [symbol, setSymbol] = useState("");
  const [action, setAction] = useState<Action>("BUY");
  const [orderType, setOrderType] = useState<OrderType>("MKT");
  const [quantity, setQuantity] = useState("");
  const [lmtPrice, setLmtPrice] = useState("");
  const [auxPrice, setAuxPrice] = useState("");
  const [trailingMode, setTrailingMode] = useState<TrailingMode>("amount");
  const [trailingAmount, setTrailingAmount] = useState("");
  const [trailingPercent, setTrailingPercent] = useState("");
  const [discretionaryAmt, setDiscretionaryAmt] = useState("");
  const [tif, setTif] = useState<TIF>("DAY");
  const [goodTillDate, setGoodTillDate] = useState("");
  const [outsideRth, setOutsideRth] = useState(false);

  // UI state
  const [error, setError] = useState<string | null>(null);
  const [confirmDialogOpen, setConfirmDialogOpen] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [debouncedSymbol, setDebouncedSymbol] = useState("");

  // Debounce symbol for quote lookup
  useEffect(() => {
    const timer = setTimeout(() => {
      if (symbol.length >= 1) {
        setDebouncedSymbol(symbol.toUpperCase());
      } else {
        setDebouncedSymbol("");
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [symbol]);

  // Fetch quote for price reference
  const { data: quoteData, isLoading: quoteLoading } = useQuote(
    debouncedSymbol,
    debouncedSymbol.length > 0
  );

  const placeMutation = usePlaceOrder();

  // Clear success message after 5 seconds
  useEffect(() => {
    if (successMessage) {
      const timer = setTimeout(() => setSuccessMessage(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [successMessage]);

  // Reset form
  const resetForm = () => {
    setSymbol("");
    setQuantity("");
    setLmtPrice("");
    setAuxPrice("");
    setTrailingAmount("");
    setTrailingPercent("");
    setDiscretionaryAmt("");
    setGoodTillDate("");
    setOutsideRth(false);
    setOrderType("MKT");
    setAction("BUY");
    setTif("DAY");
  };

  // Validate form
  const validateForm = (): string | null => {
    const sym = symbol.trim().toUpperCase();
    if (!sym || sym.length === 0) return "Symbol is required";
    if (!/^[A-Za-z0-9.\-^=%]{1,20}$/.test(sym)) return "Invalid symbol format";

    const qty = parseInt(quantity, 10);
    if (isNaN(qty) || qty <= 0) return "Quantity must be a positive number";

    // Order type specific validations
    if (orderType === "LMT" || orderType === "STP LMT" || orderType === "TRAIL LIMIT") {
      const lmt = parseFloat(lmtPrice);
      if (isNaN(lmt) || lmt <= 0) return `${orderType} requires a valid Limit Price`;
    }

    if (orderType === "STP" || orderType === "STP LMT") {
      const aux = parseFloat(auxPrice);
      if (isNaN(aux) || aux <= 0) return `${orderType} requires a valid Stop Price`;
    }

    if (orderType === "TRAIL" || orderType === "TRAIL LIMIT") {
      if (trailingMode === "amount") {
        const amt = parseFloat(trailingAmount);
        if (isNaN(amt) || amt <= 0) return "Trailing Amount must be a positive number";
      } else {
        const pct = parseFloat(trailingPercent);
        if (isNaN(pct) || pct <= 0 || pct > 100) return "Trailing Percent must be between 0 and 100";
      }
    }

    if (orderType === "REL") {
      const disc = parseFloat(discretionaryAmt);
      if (isNaN(disc) || disc <= 0) return "REL orders require a valid Discretionary Amount";
    }

    if (tif === "GTD") {
      if (!goodTillDate || goodTillDate.length === 0) return "GTD orders require a Good Till Date";
    }

    return null;
  };

  // Handle form submission
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const validationError = validateForm();
    if (validationError) {
      setError(validationError);
      return;
    }

    setConfirmDialogOpen(true);
  };

  // Confirm and place order
  const confirmPlaceOrder = () => {
    const orderRequest: PlaceOrderRequest = {
      symbol: symbol.trim().toUpperCase(),
      action,
      orderType,
      totalQuantity: parseInt(quantity, 10),
      tif,
      outsideRth,
    };

    // Add conditional fields based on order type
    if (orderType === "LMT" || orderType === "STP LMT" || orderType === "TRAIL LIMIT") {
      orderRequest.lmtPrice = parseFloat(lmtPrice);
    }

    if (orderType === "STP" || orderType === "STP LMT") {
      orderRequest.auxPrice = parseFloat(auxPrice);
    }

    if (orderType === "TRAIL" || orderType === "TRAIL LIMIT") {
      if (trailingMode === "amount") {
        orderRequest.auxPrice = parseFloat(trailingAmount);
      } else {
        orderRequest.trailingPercent = parseFloat(trailingPercent);
      }
    }

    if (orderType === "REL") {
      orderRequest.discretionaryAmt = parseFloat(discretionaryAmt);
    }

    if (tif === "GTD" && goodTillDate) {
      orderRequest.goodTillDate = goodTillDate;
    }

    placeMutation.mutate(orderRequest, {
      onSuccess: (data) => {
        setConfirmDialogOpen(false);
        setSuccessMessage(`Order ${data.orderId} placed successfully: ${data.status}`);
        resetForm();
        setError(null);
      },
      onError: (err: any) => {
        setConfirmDialogOpen(false);
        const errorMessage = err?.error || err?.message || "Failed to place order";
        setError(errorMessage);
      },
    });
  };

  // Helper to check if field should be shown
  const needsLimitPrice = orderType === "LMT" || orderType === "STP LMT" || orderType === "TRAIL LIMIT";
  const needsStopPrice = orderType === "STP" || orderType === "STP LMT";
  const needsTrailing = orderType === "TRAIL" || orderType === "TRAIL LIMIT";
  const needsDiscretionary = orderType === "REL";
  const needsGoodTillDate = tif === "GTD";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span>Place Order</span>
          {quoteData && (
            <Badge variant="outline" className="font-mono">
              {quoteData.symbol}: ${quoteData.last?.toFixed(2) ?? "—"}
              <span className="ml-1 text-xs text-muted-foreground">
                ({quoteData.source})
              </span>
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Symbol */}
          <div className="space-y-2">
            <Label htmlFor="symbol">
              Symbol <span className="text-destructive">*</span>
            </Label>
            <div className="relative">
              <Input
                id="symbol"
                value={symbol}
                onChange={(e) => setSymbol(e.target.value)}
                placeholder="AAPL"
                className="uppercase"
                required
              />
              {quoteLoading && (
                <div className="absolute right-3 top-1/2 -translate-y-1/2">
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                </div>
              )}
            </div>
            {quoteData && (
              <div className="text-xs text-muted-foreground space-y-0.5">
                <div className="flex gap-4">
                  <span>Bid: ${quoteData.bid?.toFixed(2) ?? "—"}</span>
                  <span>Ask: ${quoteData.ask?.toFixed(2) ?? "—"}</span>
                  <span>Last: ${quoteData.last?.toFixed(2) ?? "—"}</span>
                </div>
                {quoteData.prevClose && (
                  <div>Prev Close: ${quoteData.prevClose.toFixed(2)}</div>
                )}
              </div>
            )}
          </div>

          {/* Action (BUY/SELL) */}
          <div className="space-y-2">
            <Label>
              Action <span className="text-destructive">*</span>
            </Label>
            <div className="flex gap-2">
              <Button
                type="button"
                variant={action === "BUY" ? "default" : "outline"}
                className={action === "BUY" ? "bg-emerald-600 hover:bg-emerald-700" : ""}
                onClick={() => setAction("BUY")}
              >
                <TrendingUp className="h-4 w-4 mr-2" />
                BUY
              </Button>
              <Button
                type="button"
                variant={action === "SELL" ? "default" : "outline"}
                className={action === "SELL" ? "bg-red-600 hover:bg-red-700" : ""}
                onClick={() => setAction("SELL")}
              >
                <TrendingDown className="h-4 w-4 mr-2" />
                SELL
              </Button>
            </div>
          </div>

          {/* Order Type */}
          <div className="space-y-2">
            <Label htmlFor="orderType">
              Order Type <span className="text-destructive">*</span>
            </Label>
            <Select value={orderType} onValueChange={(val) => setOrderType(val as OrderType)}>
              <SelectTrigger id="orderType">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="MKT">Market (MKT)</SelectItem>
                <SelectItem value="LMT">Limit (LMT)</SelectItem>
                <SelectItem value="STP">Stop (STP)</SelectItem>
                <SelectItem value="STP LMT">Stop Limit (STP LMT)</SelectItem>
                <SelectItem value="TRAIL">Trailing Stop (TRAIL)</SelectItem>
                <SelectItem value="TRAIL LIMIT">Trailing Stop Limit (TRAIL LIMIT)</SelectItem>
                <SelectItem value="REL">Relative (REL)</SelectItem>
                <SelectItem value="MIT">Market If Touched (MIT)</SelectItem>
                <SelectItem value="MOC">Market On Close (MOC)</SelectItem>
                <SelectItem value="LOC">Limit On Close (LOC)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Quantity */}
          <div className="space-y-2">
            <Label htmlFor="quantity">
              Quantity <span className="text-destructive">*</span>
            </Label>
            <Input
              id="quantity"
              type="number"
              min="1"
              step="1"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              placeholder="100"
              required
            />
          </div>

          {/* Limit Price (conditional) */}
          {needsLimitPrice && (
            <div className="space-y-2">
              <Label htmlFor="lmtPrice">
                Limit Price <span className="text-destructive">*</span>
              </Label>
              <Input
                id="lmtPrice"
                type="number"
                min="0"
                step="0.01"
                value={lmtPrice}
                onChange={(e) => setLmtPrice(e.target.value)}
                placeholder="150.00"
                required
              />
            </div>
          )}

          {/* Stop Price (conditional) */}
          {needsStopPrice && (
            <div className="space-y-2">
              <Label htmlFor="auxPrice">
                Stop Price <span className="text-destructive">*</span>
              </Label>
              <Input
                id="auxPrice"
                type="number"
                min="0"
                step="0.01"
                value={auxPrice}
                onChange={(e) => setAuxPrice(e.target.value)}
                placeholder="145.00"
                required
              />
              <p className="text-xs text-muted-foreground">
                Order triggers when price reaches this level
              </p>
            </div>
          )}

          {/* Trailing Stop Options (conditional) */}
          {needsTrailing && (
            <div className="space-y-2">
              <Label>
                Trailing Stop <span className="text-destructive">*</span>
              </Label>
              <div className="flex gap-2 mb-2">
                <Button
                  type="button"
                  size="sm"
                  variant={trailingMode === "amount" ? "default" : "outline"}
                  onClick={() => setTrailingMode("amount")}
                >
                  Amount
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={trailingMode === "percent" ? "default" : "outline"}
                  onClick={() => setTrailingMode("percent")}
                >
                  Percent
                </Button>
              </div>
              {trailingMode === "amount" ? (
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={trailingAmount}
                  onChange={(e) => setTrailingAmount(e.target.value)}
                  placeholder="5.00"
                  required
                />
              ) : (
                <Input
                  type="number"
                  min="0"
                  max="100"
                  step="0.1"
                  value={trailingPercent}
                  onChange={(e) => setTrailingPercent(e.target.value)}
                  placeholder="5.0"
                  required
                />
              )}
              <p className="text-xs text-muted-foreground">
                {trailingMode === "amount"
                  ? "Dollar amount to trail behind market price"
                  : "Percentage to trail behind market price"}
              </p>
            </div>
          )}

          {/* Discretionary Amount (conditional) */}
          {needsDiscretionary && (
            <div className="space-y-2">
              <Label htmlFor="discretionaryAmt">
                Discretionary Amount <span className="text-destructive">*</span>
              </Label>
              <Input
                id="discretionaryAmt"
                type="number"
                min="0"
                step="0.01"
                value={discretionaryAmt}
                onChange={(e) => setDiscretionaryAmt(e.target.value)}
                placeholder="0.10"
                required
              />
              <p className="text-xs text-muted-foreground">
                Price range for market making discretion
              </p>
            </div>
          )}

          {/* Time In Force */}
          <div className="space-y-2">
            <Label htmlFor="tif">Time In Force</Label>
            <Select value={tif} onValueChange={(val) => setTif(val as TIF)}>
              <SelectTrigger id="tif">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="DAY">Day (DAY)</SelectItem>
                <SelectItem value="GTC">Good Till Canceled (GTC)</SelectItem>
                <SelectItem value="IOC">Immediate or Cancel (IOC)</SelectItem>
                <SelectItem value="GTD">Good Till Date (GTD)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Good Till Date (conditional) */}
          {needsGoodTillDate && (
            <div className="space-y-2">
              <Label htmlFor="goodTillDate">
                Good Till Date <span className="text-destructive">*</span>
              </Label>
              <Input
                id="goodTillDate"
                type="date"
                value={goodTillDate}
                onChange={(e) => setGoodTillDate(e.target.value)}
                required
              />
            </div>
          )}

          {/* Outside RTH */}
          <div className="flex items-center space-x-2">
            <Checkbox
              id="outsideRth"
              checked={outsideRth}
              onCheckedChange={(checked) => setOutsideRth(checked as boolean)}
            />
            <Label htmlFor="outsideRth" className="cursor-pointer">
              Allow trading outside regular hours
            </Label>
          </div>

          {/* Error Display */}
          {error && (
            <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Success Display */}
          {successMessage && (
            <div className="rounded-md bg-emerald-500/10 p-3 text-sm text-emerald-400">
              {successMessage}
            </div>
          )}

          {/* Submit Button */}
          <Button type="submit" className="w-full" disabled={placeMutation.isPending}>
            {placeMutation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Placing Order...
              </>
            ) : (
              "Review Order"
            )}
          </Button>
        </form>

        {/* Confirmation Dialog */}
        <Dialog open={confirmDialogOpen} onOpenChange={setConfirmDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Confirm Order</DialogTitle>
              <DialogDescription>
                Please review your order details before submitting.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2 py-4">
              <div className="grid grid-cols-2 gap-2 text-sm">
                <span className="text-muted-foreground">Symbol:</span>
                <span className="font-mono font-medium">{symbol.toUpperCase()}</span>
                
                <span className="text-muted-foreground">Action:</span>
                <Badge variant="outline" className={action === "BUY" ? "text-emerald-400" : "text-red-400"}>
                  {action}
                </Badge>
                
                <span className="text-muted-foreground">Order Type:</span>
                <span className="font-medium">{orderType}</span>
                
                <span className="text-muted-foreground">Quantity:</span>
                <span className="font-mono">{quantity}</span>
                
                {needsLimitPrice && (
                  <>
                    <span className="text-muted-foreground">Limit Price:</span>
                    <span className="font-mono">${lmtPrice}</span>
                  </>
                )}
                
                {needsStopPrice && (
                  <>
                    <span className="text-muted-foreground">Stop Price:</span>
                    <span className="font-mono">${auxPrice}</span>
                  </>
                )}
                
                {needsTrailing && (
                  <>
                    <span className="text-muted-foreground">Trailing:</span>
                    <span className="font-mono">
                      {trailingMode === "amount" ? `$${trailingAmount}` : `${trailingPercent}%`}
                    </span>
                  </>
                )}
                
                {needsDiscretionary && (
                  <>
                    <span className="text-muted-foreground">Discretionary:</span>
                    <span className="font-mono">${discretionaryAmt}</span>
                  </>
                )}
                
                <span className="text-muted-foreground">Time In Force:</span>
                <span>{tif}</span>
                
                {needsGoodTillDate && (
                  <>
                    <span className="text-muted-foreground">Good Till Date:</span>
                    <span className="font-mono">{goodTillDate}</span>
                  </>
                )}
                
                <span className="text-muted-foreground">Outside RTH:</span>
                <span>{outsideRth ? "Yes" : "No"}</span>
              </div>
              
              {quoteData && (
                <div className="mt-4 p-3 bg-muted/50 rounded-md text-xs">
                  <div className="font-medium mb-1">Current Market Data ({quoteData.source}):</div>
                  <div className="grid grid-cols-3 gap-2 font-mono">
                    <span>Bid: ${quoteData.bid?.toFixed(2) ?? "—"}</span>
                    <span>Ask: ${quoteData.ask?.toFixed(2) ?? "—"}</span>
                    <span>Last: ${quoteData.last?.toFixed(2) ?? "—"}</span>
                  </div>
                </div>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setConfirmDialogOpen(false)}>
                Cancel
              </Button>
              <Button
                onClick={confirmPlaceOrder}
                disabled={placeMutation.isPending}
              >
                {placeMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Submitting...
                  </>
                ) : (
                  "Confirm & Place Order"
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
