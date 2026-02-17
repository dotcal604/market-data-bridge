/**
 * Quantitative Feature Engineering: Order Book Microstructure Metrics
 * 
 * Pure computation functions for Order Book Imbalance (OBI) and 
 * Volume Synchronized Probability of Informed Trading (VPIN).
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
 * 2. VPIN (Volume-Synchronized Probability of Informed Trading)
 *    Simplified flow toxicity metric based on volume bucket imbalance.
 *    Formula: VPIN ≈ Σ |V_buy - V_sell| / Σ (V_buy + V_sell)
 *    Over a sliding volume window (e.g., last 50 buckets).
 * 
 * 3. Trade Flow Toxicity
 *    Measures adverse selection risk from informed trading.
 *    Higher toxicity indicates greater probability of informed flow.
 */

export interface OrderBookLevel {
  price: number;
  size: number;
}

export interface TradeTick {
  price: number;
  size: number;
  timestamp: number;
}

/**
 * Calculates the Order Book Imbalance (OBI) at the top level (L1).
 * Formula: ρ = (V_b - V_a) / (V_b + V_a)
 * 
 * @param bids - Array of bid levels [price, size], sorted DESC by price
 * @param asks - Array of ask levels [price, size], sorted ASC by price
 * @returns Order book imbalance [-1, 1] where positive indicates buying pressure
 */
export function computeBookImbalance(
  bids: OrderBookLevel[],
  asks: OrderBookLevel[]
): number {
  if (bids.length === 0 || asks.length === 0) return 0;

  const bestBidVol = bids[0].size;
  const bestAskVol = asks[0].size;
  const totalVol = bestBidVol + bestAskVol;

  if (totalVol === 0) return 0;

  // ρ = (V_b - V_a) / (V_b + V_a)
  return (bestBidVol - bestAskVol) / totalVol;
}

/**
 * Calculates the Weighted Order Book Imbalance (WOBI) up to depth K.
 * Gives less weight to deeper levels as they are less likely to be executed.
 * Formula: WOBI = Σ (w_i * OBI_i) / Σ w_i
 * Weight w_i decays exponentially with depth: w_i = e^(-0.5 * i)
 * 
 * @param bids - Array of bid levels, sorted DESC by price
 * @param asks - Array of ask levels, sorted ASC by price
 * @param depth - Maximum depth to consider (default 5)
 * @returns Weighted order book imbalance [-1, 1]
 */
export function computeWeightedBookImbalance(
  bids: OrderBookLevel[],
  asks: OrderBookLevel[],
  depth: number = 5
): number {
  let weightedImbalanceSum = 0;
  let weightSum = 0;

  const maxDepth = Math.min(depth, bids.length, asks.length);
  if (maxDepth === 0) return 0;

  for (let i = 0; i < maxDepth; i++) {
    const bidVol = bids[i].size;
    const askVol = asks[i].size;
    const levelVol = bidVol + askVol;

    if (levelVol === 0) continue;

    const levelImbalance = (bidVol - askVol) / levelVol;
    const weight = Math.exp(-0.5 * i);

    weightedImbalanceSum += levelImbalance * weight;
    weightSum += weight;
  }

  return weightSum === 0 ? 0 : weightedImbalanceSum / weightSum;
}

/**
 * Estimates VPIN (toxicity) based on recent trade flow imbalance.
 * Requires a stream of classified buy/sell volumes.
 * Formula: VPIN = Σ |V_buy - V_sell| / Σ (V_buy + V_sell)
 * 
 * @param buyVolumes - Array of buy volumes per bucket
 * @param sellVolumes - Array of sell volumes per bucket
 * @returns VPIN estimate [0, 1] where higher values indicate informed trading
 */
export function computeVPIN(buyVolumes: number[], sellVolumes: number[]): number {
  if (buyVolumes.length === 0 || sellVolumes.length === 0) return 0;
  if (buyVolumes.length !== sellVolumes.length) return 0;

  let absoluteImbalanceSum = 0;
  let totalVolumeSum = 0;

  for (let i = 0; i < buyVolumes.length; i++) {
    const vBuy = buyVolumes[i];
    const vSell = sellVolumes[i];
    
    absoluteImbalanceSum += Math.abs(vBuy - vSell);
    totalVolumeSum += vBuy + vSell;
  }

  if (totalVolumeSum === 0) return 0;

  return absoluteImbalanceSum / totalVolumeSum;
}

/**
 * Classifies trades as buyer or seller initiated using tick rule.
 * Trade is buyer-initiated if price >= midpoint, seller-initiated otherwise.
 * 
 * @param trades - Array of trade ticks
 * @param midpoint - Current bid-ask midpoint
 * @returns Object with buy and sell volume arrays
 */
export function classifyTrades(
  trades: TradeTick[],
  midpoint: number
): { buyVolumes: number[]; sellVolumes: number[] } {
  if (trades.length === 0 || midpoint <= 0) {
    return { buyVolumes: [], sellVolumes: [] };
  }

  const buyVolumes: number[] = [];
  const sellVolumes: number[] = [];

  for (const trade of trades) {
    if (trade.price >= midpoint) {
      buyVolumes.push(trade.size);
      sellVolumes.push(0);
    } else {
      buyVolumes.push(0);
      sellVolumes.push(trade.size);
    }
  }

  return { buyVolumes, sellVolumes };
}

/**
 * Computes trade flow toxicity metric.
 * Combines VPIN with volume-weighted price impact.
 * Higher toxicity indicates greater adverse selection risk.
 * 
 * @param buyVolumes - Array of buy volumes
 * @param sellVolumes - Array of sell volumes
 * @returns Toxicity metric [0, 1]
 */
export function computeTradeFlowToxicity(
  buyVolumes: number[],
  sellVolumes: number[]
): number {
  // Trade flow toxicity is essentially VPIN with additional context
  // For this implementation, we use VPIN as the primary toxicity measure
  return computeVPIN(buyVolumes, sellVolumes);
}
