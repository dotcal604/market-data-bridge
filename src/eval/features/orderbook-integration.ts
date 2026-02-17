/**
 * Order Book Features Integration Example
 * 
 * This module demonstrates how to integrate order book imbalance and VPIN features
 * into the evaluation pipeline when IBKR Level 2 market data is available.
 * 
 * IMPORTANT LIMITATIONS:
 * 1. Requires IBKR connection (not available with Yahoo Finance)
 * 2. Requires Level 2 market data subscription (additional IBKR fees)
 * 3. Adds latency to feature computation (5-10 seconds for depth snapshot)
 * 4. VPIN requires historical trade flow tracking (not just a snapshot)
 * 
 * USAGE PATTERN:
 * - Order book features are OPTIONAL enhancements
 * - Main feature pipeline uses Yahoo Finance (always available)
 * - Order book features can be computed separately when IBKR is connected
 * - Results can be added to evaluation metadata/notes for model context
 */

import { getMarketDepth } from "../../ibkr/marketdata.js";
import { isConnected } from "../../ibkr/connection.js";
import {
  marketDepthToOrderBook,
  computeOrderBookFeatures,
} from "./order-book-imbalance.js";
import { logger } from "../../logging.js";

const log = logger.child({ subsystem: "orderbook-integration" });

/**
 * Fetch order book features for a symbol (when IBKR is connected).
 * Returns null if IBKR is not connected or request fails.
 * 
 * @param symbol - Stock symbol
 * @param depth - Number of depth levels (default 10)
 * @returns Order book features or null
 */
export async function fetchOrderBookFeatures(
  symbol: string,
  depth: number = 10,
): Promise<{ obi: number; wobi: number; timestamp: number } | null> {
  if (!isConnected()) {
    log.warn({ symbol }, "IBKR not connected, skipping order book features");
    return null;
  }

  try {
    const snapshot = await getMarketDepth(symbol, depth, 5000);
    const book = marketDepthToOrderBook(snapshot);
    const features = computeOrderBookFeatures(book, depth);

    log.info(
      { symbol, obi: features.obi, wobi: features.wobi },
      "Order book features computed",
    );

    return {
      obi: features.obi,
      wobi: features.wobi,
      timestamp: snapshot.timestamp,
    };
  } catch (err) {
    log.error({ symbol, error: (err as Error).message }, "Failed to fetch order book features");
    return null;
  }
}

/**
 * Example: Augment evaluation with order book features.
 * 
 * This shows how to optionally enhance an evaluation with order book data
 * without breaking the main feature pipeline.
 */
export async function augmentEvaluationWithOrderBook(
  symbol: string,
  baseFeatures: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const obFeatures = await fetchOrderBookFeatures(symbol);

  if (!obFeatures) {
    // IBKR not available, return base features only
    return baseFeatures;
  }

  // Add order book features as optional enhancements
  return {
    ...baseFeatures,
    order_book_imbalance: obFeatures.obi,
    order_book_weighted_imbalance: obFeatures.wobi,
    order_book_timestamp: obFeatures.timestamp,
  };
}

/**
 * Usage Example in Evaluation Pipeline:
 * 
 * ```typescript
 * import { computeFeatures } from "./features/compute.js";
 * import { fetchOrderBookFeatures } from "./features/orderbook-integration.js";
 * 
 * // Standard feature computation (always available)
 * const { features } = await computeFeatures(symbol, direction);
 * 
 * // Optional: Add order book features if IBKR is connected
 * const obFeatures = await fetchOrderBookFeatures(symbol);
 * if (obFeatures) {
 *   console.log(`OBI: ${obFeatures.obi}, WOBI: ${obFeatures.wobi}`);
 *   // Add to evaluation notes or metadata
 *   notes = `OBI: ${obFeatures.obi.toFixed(3)}, WOBI: ${obFeatures.wobi.toFixed(3)}`;
 * }
 * ```
 */
