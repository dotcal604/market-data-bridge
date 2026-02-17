/**
 * Quantitative Feature Engineering: Order Book Microstructure Metrics
 * 
 * This module implements Order Book Imbalance (OBI) and Volume Synchronized Probability of Informed Trading (VPIN).
 * 
 * Mathematical Foundations:
 * 
 * 1. Order Book Imbalance (OBI)
 *    Formula: ρ = (V_b - V_a) / (V_b + V_a)
 *    Where:
 *      V_b = Volume at Best Bid
 *      V_a = Volume at Best Ask
 *    Range: [-1, 1]
 *    Interpretation:
 *      ρ > 0 implies buying pressure (Bid volume > Ask volume)
 *      ρ < 0 implies selling pressure (Ask volume > Bid volume)
 *      ρ ≈ 0 implies equilibrium
 * 
 * 2. VPIN (Volume-Synchronized Probability of Informed Trading) approximation
 *    We use a simplified flow toxicity metric based on volume bucket imbalance.
 *    Formula: VPIN ≈ Σ |V_buy - V_sell| / Σ (V_buy + V_sell)
 *    Over a sliding volume window (e.g., last 50 buckets).
 */

export interface OrderBookState {
  symbol: string;
  bids: [price: number, size: number][]; // Sorted DESC by price
  asks: [price: number, size: number][]; // Sorted ASC by price
  timestamp: number;
}

export class OrderBookFeatures {
  /**
   * Calculates the Order Book Imbalance (OBI) at the top level (L1).
   * Complexity: O(1)
   */
  public static calculateOBI(book: OrderBookState): number {
    if (!book.bids.length || !book.asks.length) return 0;

    const bestBidVol = book.bids[0][1];
    const bestAskVol = book.asks[0][1];
    const totalVol = bestBidVol + bestAskVol;

    if (totalVol === 0) return 0;

    // ρ = (V_b - V_a) / (V_b + V_a)
    return (bestBidVol - bestAskVol) / totalVol;
  }

  /**
   * Calculates the Weighted Order Book Imbalance (WOBI) up to depth K.
   * Gives less weight to deeper levels as they are less likely to be executed against.
   * Formula: WOBI = Σ (w_i * OBI_i) / Σ w_i
   * Weight w_i decays exponentially with depth: w_i = e^(-0.5 * i)
   */
  public static calculateWOBI(book: OrderBookState, depth: number = 5): number {
    let weightedImbalanceSum = 0;
    let weightSum = 0;

    const maxDepth = Math.min(depth, book.bids.length, book.asks.length);

    for (let i = 0; i < maxDepth; i++) {
      const bidVol = book.bids[i][1];
      const askVol = book.asks[i][1];
      const levelVol = bidVol + askVol;

      if (levelVol === 0) continue;

      const levelImbalance = (bidVol - askVol) / levelVol;
      const weight = Math.exp(-0.5 * i); // Decay function

      weightedImbalanceSum += levelImbalance * weight;
      weightSum += weight;
    }

    return weightSum === 0 ? 0 : weightedImbalanceSum / weightSum;
  }

  /**
   * Estimates VPIN (toxicity) based on recent trade flow imbalance.
   * Requires a stream of classified buy/sell volumes.
   * 
   * @param buyVolumeWindow - Array of recent buy volumes per bucket
   * @param sellVolumeWindow - Array of recent sell volumes per bucket
   */
  public static calculateVPIN(buyVolumeWindow: number[], sellVolumeWindow: number[]): number {
    if (buyVolumeWindow.length !== sellVolumeWindow.length || buyVolumeWindow.length === 0) return 0;

    let absoluteImbalanceSum = 0;
    let totalVolumeSum = 0;

    for (let i = 0; i < buyVolumeWindow.length; i++) {
      const vBuy = buyVolumeWindow[i];
      const vSell = sellVolumeWindow[i];
      
      absoluteImbalanceSum += Math.abs(vBuy - vSell);
      totalVolumeSum += (vBuy + vSell);
    }

    if (totalVolumeSum === 0) return 0;

    return absoluteImbalanceSum / totalVolumeSum;
  }
}

/**
 * Adapter function to convert IBKR MarketDepthSnapshot to OrderBookState.
 * This bridges the gap between IBKR market data format and our feature computation format.
 */
export function marketDepthToOrderBook(snapshot: {
  symbol: string;
  bids: Array<{ price: number; size: number; marketMaker?: string }>;
  asks: Array<{ price: number; size: number; marketMaker?: string }>;
  timestamp: number;
}): OrderBookState {
  return {
    symbol: snapshot.symbol,
    bids: snapshot.bids.map((level) => [level.price, level.size] as [number, number]),
    asks: snapshot.asks.map((level) => [level.price, level.size] as [number, number]),
    timestamp: snapshot.timestamp,
  };
}

/**
 * Compute all order book features from a single snapshot.
 * Convenience function that calculates OBI, WOBI for a given book state.
 * Note: VPIN requires historical trade flow data and cannot be computed from a single snapshot.
 */
export function computeOrderBookFeatures(book: OrderBookState, depth: number = 5): {
  obi: number;
  wobi: number;
} {
  return {
    obi: OrderBookFeatures.calculateOBI(book),
    wobi: OrderBookFeatures.calculateWOBI(book, depth),
  };
}
