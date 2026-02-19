import { logOrder } from "../../logging.js";
import type { PlaceOrderParams, OrderValidationResult } from "./types.js";

const KNOWN_ORDER_TYPES = new Set([
  "MKT", "LMT", "STP", "STP LMT",
  "TRAIL", "TRAIL LIMIT",
  "REL", "MIT", "MOC", "LOC",
  "MKT PRT", "LIT", "PEG MID", "PEG MKT",
  "SNAP MID", "SNAP MKT", "SNAP PRIM",
  "MKT IF TOUCHED", "MKT ON CLOSE", "LMT ON CLOSE",
  "PASSV REL", "PEG BENCH",
]);

/**
 * Perform pre-submission validation on order parameters.
 * @param params Order parameters
 * @returns Validation result (valid: boolean, errors: string[])
 */
export function validateOrder(params: PlaceOrderParams): OrderValidationResult {
  const errors: string[] = [];

  // Basic required fields
  if (!params.symbol) errors.push("symbol is required");
  if (!["BUY", "SELL"].includes(params.action)) errors.push("action must be BUY or SELL");
  if (!params.orderType) errors.push("orderType is required");
  if (!params.totalQuantity || params.totalQuantity <= 0) errors.push("totalQuantity must be positive");

  const ot = params.orderType;

  // Warn on unknown types (don't reject — IBKR may support more than we track)
  if (!KNOWN_ORDER_TYPES.has(ot)) {
    logOrder.warn({ orderType: ot }, "Unknown order type — passing through to IBKR");
  }

  // LMT requires lmtPrice
  if ((ot === "LMT" || ot === "STP LMT" || ot === "TRAIL LIMIT") && !params.lmtPrice) {
    errors.push(`${ot} requires lmtPrice`);
  }

  // STP / STP LMT requires auxPrice
  if ((ot === "STP" || ot === "STP LMT") && !params.auxPrice) {
    errors.push(`${ot} requires auxPrice (stop trigger price)`);
  }

  // TRAIL requires either auxPrice (trailing amount) or trailingPercent
  if (ot === "TRAIL" || ot === "TRAIL LIMIT") {
    if (!params.auxPrice && !params.trailingPercent) {
      errors.push(`${ot} requires auxPrice (trailing amount) or trailingPercent`);
    }
    if (params.auxPrice && params.trailingPercent) {
      errors.push(`${ot}: specify auxPrice OR trailingPercent, not both`);
    }
  }

  // OCA validation
  if (params.ocaType !== undefined && ![1, 2, 3].includes(params.ocaType)) {
    errors.push("ocaType must be 1 (cancel w/ block), 2 (reduce w/ block), or 3 (reduce non-block)");
  }

  // REL discretionary
  if (params.discretionaryAmt !== undefined && ot !== "REL") {
    errors.push("discretionaryAmt is only valid for REL orders");
  }

  return { valid: errors.length === 0, errors };
}
