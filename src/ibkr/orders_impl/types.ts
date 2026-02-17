// ── Types for Order Operations ──────────────────────────────────────────

export interface OpenOrderData {
  orderId: number;
  symbol: string;
  secType: string;
  exchange: string;
  currency: string;
  action: string;
  orderType: string;
  totalQuantity: number;
  lmtPrice: number | null;
  auxPrice: number | null;
  status: string;
  remaining: number;
  tif: string;
  parentId: number;
  ocaGroup: string;
  account: string;
}

export interface CompletedOrderData {
  orderId: number;
  symbol: string;
  secType: string;
  exchange: string;
  currency: string;
  action: string;
  orderType: string;
  totalQuantity: number;
  lmtPrice: number | null;
  auxPrice: number | null;
  status: string;
  filledQuantity: number;
  avgFillPrice: number;
  tif: string;
  account: string;
  completedTime: string;
  completedStatus: string;
}

export interface ExecutionData {
  execId: string;
  orderId: number;
  symbol: string;
  secType: string;
  exchange: string;
  currency: string;
  side: string;
  shares: number;
  price: number;
  cumQty: number;
  avgPrice: number;
  time: string;
  account: string;
  commission: number | null;
  realizedPnL: number | null;
}

export interface PlaceOrderParams {
  symbol: string;
  secType?: string;
  exchange?: string;
  currency?: string;
  action: string; // "BUY" | "SELL"
  orderType: string; // Any IBKR order type: MKT, LMT, STP, STP LMT, TRAIL, TRAIL LIMIT, REL, MIT, MOC, LOC, etc.
  totalQuantity: number;
  lmtPrice?: number;
  auxPrice?: number; // stop price, or trailing amount for TRAIL
  tif?: string; // "DAY" | "GTC" | "IOC" | "GTD" | "OPG" | "FOK" | "DTC"
  transmit?: boolean;
  parentId?: number; // for bracket child orders
  ocaGroup?: string;
  ocaType?: number; // 1=Cancel with block, 2=Reduce with block, 3=Reduce non-block
  // Trailing order fields
  trailingPercent?: number; // trailing stop as percentage (alternative to auxPrice)
  trailStopPrice?: number; // initial stop price anchor for trailing orders
  // Advanced order fields
  goodAfterTime?: string; // "YYYYMMDD HH:MM:SS timezone"
  goodTillDate?: string; // "YYYYMMDD HH:MM:SS timezone"
  outsideRth?: boolean; // allow execution outside regular trading hours
  hidden?: boolean; // hidden order (iceberg)
  discretionaryAmt?: number; // discretionary amount for REL orders
  // Algo fields
  algoStrategy?: string; // "Adaptive", "ArrivalPx", "DarkIce", "PctVol", "Twap", "Vwap", etc.
  algoParams?: Array<{ tag: string; value: string }>; // algo-specific params
  // Account / hedge fields
  account?: string;
  hedgeType?: string; // "D" (delta), "B" (beta), "F" (FX), "P" (pair)
  hedgeParam?: string;
  // DB tracking fields
  strategy_version?: string;
  order_source?: string;
  ai_confidence?: number;
  journal_id?: number;
  eval_id?: string;
}

export interface OrderValidationResult {
  valid: boolean;
  errors: string[];
}

export interface PlaceOrderResult {
  orderId: number;
  symbol: string;
  action: string;
  orderType: string;
  totalQuantity: number;
  lmtPrice: number | null;
  auxPrice: number | null;
  status: string;
  correlation_id: string;
}

export interface BracketOrderParams {
  symbol: string;
  secType?: string;
  exchange?: string;
  currency?: string;
  action: string; // "BUY" | "SELL"
  totalQuantity: number;
  entryType: string; // "MKT" | "LMT"
  entryPrice?: number; // limit price for entry (required if entryType is LMT)
  takeProfitPrice: number;
  stopLossPrice: number;
  tif?: string;
  // DB tracking fields
  strategy_version?: string;
  order_source?: string;
  ai_confidence?: number;
  journal_id?: number;
  eval_id?: string;
}

export interface BracketOrderResult {
  parentOrderId: number;
  takeProfitOrderId: number;
  stopLossOrderId: number;
  symbol: string;
  action: string;
  totalQuantity: number;
  entryType: string;
  entryPrice: number | null;
  takeProfitPrice: number;
  stopLossPrice: number;
  status: string;
  correlation_id: string;
}

export interface AdvancedBracketParams {
  symbol: string;
  secType?: string;
  exchange?: string;
  currency?: string;
  action: string; // "BUY" | "SELL"
  quantity: number;
  entry: { type: string; price?: number };
  takeProfit: { type: string; price: number };
  stopLoss: {
    type: string; // "STP", "TRAIL", "TRAIL LIMIT", "STP LMT"
    price?: number;
    trailingAmount?: number;
    trailingPercent?: number;
    lmtPrice?: number; // for TRAIL LIMIT or STP LMT
  };
  tif?: string;
  outsideRth?: boolean;
  ocaType?: 1 | 2 | 3;
  // DB tracking
  strategy_version?: string;
  order_source?: string;
  ai_confidence?: number;
  journal_id?: number;
  eval_id?: string;
}

export interface AdvancedBracketResult {
  parentOrderId: number;
  takeProfitOrderId: number;
  stopLossOrderId: number;
  ocaGroup: string;
  symbol: string;
  action: string;
  quantity: number;
  entry: { type: string; price: number | null };
  takeProfit: { type: string; price: number };
  stopLoss: { type: string; price?: number; trailingAmount?: number; trailingPercent?: number };
  status: string;
  correlation_id: string;
}

export interface ModifyOrderParams {
  orderId: number;
  // Fields that can be modified on a live order:
  lmtPrice?: number;
  auxPrice?: number; // stop trigger price
  totalQuantity?: number;
  orderType?: string; // e.g. change STP → STP LMT
  tif?: string;
  // Trailing fields
  trailingPercent?: number;
  trailStopPrice?: number;
}

export interface ModifyOrderResult {
  orderId: number;
  symbol: string;
  action: string;
  orderType: string;
  totalQuantity: number;
  lmtPrice: number | null;
  auxPrice: number | null;
  status: string;
  modified: string[]; // list of fields that were changed
}

export interface FlattenResult {
  flattened: PlaceOrderResult[];
  cancelled: { status: string };
  skipped: string[];
  timestamp: string;
}
