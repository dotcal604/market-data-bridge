/**
 * Live order book feature integration.
 * Bridges IBKR Level 2 market depth data with orderbook feature computations.
 * 
 * These features are optional and only available when:
 * 1. IBKR is connected
 * 2. Symbol has Level 2 market data subscription
 * 3. Market depth data is being streamed
 */

import { subscribeMarketDepth, type MarketDepthSnapshot } from "../../ibkr/marketdata.js";
import {
  computeBookImbalance,
  computeWeightedBookImbalance,
  computeVPIN,
  classifyTrades,
  computeTradeFlowToxicity,
  type OrderBookLevel,
  type TradeTick,
} from "./order-book-imbalance.js";
import { logger } from "../../logging.js";

const log = logger.child({ module: "orderbook-live" });

export interface OrderBookFeatures {
  book_imbalance: number;
  weighted_book_imbalance: number;
  book_imbalance_depth_5: number;
  timestamp: string;
}

export interface TradeFlowFeatures {
  vpin: number;
  trade_flow_toxicity: number;
  buy_volume_ratio: number;
  timestamp: string;
}

/**
 * Computes order book imbalance features from IBKR market depth snapshot.
 * 
 * @param symbol - Stock symbol
 * @param depth - Market depth levels to consider (default 10)
 * @returns Order book features or null if unavailable
 */
export async function computeOrderBookFeatures(
  symbol: string,
  depth: number = 10
): Promise<OrderBookFeatures | null> {
  try {
    const { snapshot, unsubscribe } = await subscribeMarketDepth({
      symbol,
      numRows: depth,
      isSmartDepth: false,
    });

    // Clean up subscription immediately after getting snapshot
    unsubscribe();

    if (snapshot.bids.length === 0 || snapshot.asks.length === 0) {
      log.warn({ symbol }, "No market depth data available");
      return null;
    }

    // Convert market depth format to orderbook format
    const bids: OrderBookLevel[] = snapshot.bids.map((level) => ({
      price: level.price,
      size: level.size,
    }));
    const asks: OrderBookLevel[] = snapshot.asks.map((level) => ({
      price: level.price,
      size: level.size,
    }));

    const book_imbalance = computeBookImbalance(bids, asks);
    const weighted_book_imbalance = computeWeightedBookImbalance(bids, asks, 10);
    const book_imbalance_depth_5 = computeWeightedBookImbalance(bids, asks, 5);

    log.info(
      { symbol, book_imbalance, weighted_book_imbalance },
      "Computed orderbook features"
    );

    return {
      book_imbalance,
      weighted_book_imbalance,
      book_imbalance_depth_5,
      timestamp: snapshot.timestamp,
    };
  } catch (error) {
    log.error({ symbol, error }, "Failed to compute orderbook features");
    return null;
  }
}

/**
 * Computes trade flow features from historical trade ticks.
 * Requires recent trade data to classify as buy/sell and compute VPIN.
 * 
 * @param trades - Array of recent trade ticks
 * @param midpoint - Current bid-ask midpoint for trade classification
 * @param bucketSize - Number of trades per volume bucket (default 10)
 * @returns Trade flow features or null if insufficient data
 */
export function computeTradeFlowFeatures(
  trades: TradeTick[],
  midpoint: number,
  bucketSize: number = 10
): TradeFlowFeatures | null {
  if (trades.length < bucketSize) {
    log.warn({ tradeCount: trades.length, bucketSize }, "Insufficient trades for VPIN");
    return null;
  }

  const { buyVolumes, sellVolumes } = classifyTrades(trades, midpoint);

  // Create volume buckets
  const numBuckets = Math.floor(buyVolumes.length / bucketSize);
  if (numBuckets === 0) {
    return null;
  }

  const buyBuckets: number[] = [];
  const sellBuckets: number[] = [];

  for (let i = 0; i < numBuckets; i++) {
    const start = i * bucketSize;
    const end = start + bucketSize;
    
    const buyBucket = buyVolumes.slice(start, end).reduce((sum, v) => sum + v, 0);
    const sellBucket = sellVolumes.slice(start, end).reduce((sum, v) => sum + v, 0);
    
    buyBuckets.push(buyBucket);
    sellBuckets.push(sellBucket);
  }

  const vpin = computeVPIN(buyBuckets, sellBuckets);
  const trade_flow_toxicity = computeTradeFlowToxicity(buyBuckets, sellBuckets);

  const totalBuyVolume = buyVolumes.reduce((sum, v) => sum + v, 0);
  const totalSellVolume = sellVolumes.reduce((sum, v) => sum + v, 0);
  const totalVolume = totalBuyVolume + totalSellVolume;
  const buy_volume_ratio = totalVolume > 0 ? totalBuyVolume / totalVolume : 0.5;

  log.info(
    { vpin, trade_flow_toxicity, buy_volume_ratio, numBuckets },
    "Computed trade flow features"
  );

  return {
    vpin,
    trade_flow_toxicity,
    buy_volume_ratio,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Convenience function to compute all available orderbook and trade flow features.
 * Returns partial results if some features are unavailable.
 * 
 * @param symbol - Stock symbol
 * @param trades - Optional array of recent trade ticks
 * @param midpoint - Optional bid-ask midpoint for trade classification
 * @returns Combined features object
 */
export async function computeAllOrderBookFeatures(
  symbol: string,
  trades?: TradeTick[],
  midpoint?: number
): Promise<{
  orderbook: OrderBookFeatures | null;
  tradeFlow: TradeFlowFeatures | null;
}> {
  const orderbook = await computeOrderBookFeatures(symbol);

  let tradeFlow: TradeFlowFeatures | null = null;
  if (trades && midpoint) {
    tradeFlow = computeTradeFlowFeatures(trades, midpoint);
  }

  return { orderbook, tradeFlow };
}
