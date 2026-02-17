# Order Book Features Documentation

## Overview

The Market Data Bridge now includes order book microstructure features for advanced market analysis:

1. **OBI (Order Book Imbalance)** - Level 1 bid/ask volume imbalance
2. **WOBI (Weighted Order Book Imbalance)** - Multi-level depth-weighted imbalance
3. **VPIN (Volume-Synchronized Probability of Informed Trading)** - Flow toxicity metric

## Files

- `order-book-imbalance.ts` - Pure computation functions for order book metrics
- `orderbook-integration.ts` - Integration helpers for IBKR Level 2 data
- `__tests__/order-book-imbalance.test.ts` - Comprehensive test suite (40+ cases)

## Mathematical Foundations

### Order Book Imbalance (OBI)

Formula: `ρ = (V_b - V_a) / (V_b + V_a)`

Where:
- `V_b` = Volume at Best Bid
- `V_a` = Volume at Best Ask

Range: `[-1, 1]`

Interpretation:
- `ρ > 0` → buying pressure (bid volume > ask volume)
- `ρ < 0` → selling pressure (ask volume > bid volume)
- `ρ ≈ 0` → equilibrium

### Weighted Order Book Imbalance (WOBI)

Formula: `WOBI = Σ (w_i * OBI_i) / Σ w_i`

Where:
- `w_i = e^(-0.5 * i)` - Exponential decay weight for depth level i
- `OBI_i` - Imbalance at depth level i

Gives more weight to top levels (closer to best bid/ask).

### VPIN (Volume-Synchronized Probability of Informed Trading)

Simplified flow toxicity metric:

Formula: `VPIN ≈ Σ |V_buy - V_sell| / Σ (V_buy + V_sell)`

Over a sliding volume window (e.g., last 50 buckets).

**Note**: VPIN requires historical trade flow classification (buy vs. sell volume), not just a snapshot.

## Requirements

### IBKR Level 2 Market Data

Order book features require:
1. **IBKR TWS/Gateway connection** (running and connected)
2. **Level 2 market data subscription** (additional fees from IBKR)
3. **Real-time data permissions** for the symbols you want to analyze

### Limitations

- **Not available with Yahoo Finance** - Yahoo doesn't provide order book depth
- **Adds latency** - Market depth snapshot takes 5-10 seconds to collect
- **Real-time data** - Requires active IBKR connection, not historical data
- **VPIN requires streaming** - Cannot compute from a single snapshot (needs trade flow tracking)

## Usage

### Basic Usage

```typescript
import { getMarketDepth } from "../../ibkr/marketdata.js";
import {
  marketDepthToOrderBook,
  computeOrderBookFeatures,
} from "./order-book-imbalance.js";

// Fetch Level 2 market depth from IBKR
const snapshot = await getMarketDepth("AAPL", 10, 5000);

// Convert to order book format
const book = marketDepthToOrderBook(snapshot);

// Compute features
const { obi, wobi } = computeOrderBookFeatures(book, 10);

console.log(`OBI: ${obi.toFixed(3)}, WOBI: ${wobi.toFixed(3)}`);
```

### Integration with Evaluation Pipeline

```typescript
import { computeFeatures } from "./features/compute.js";
import { fetchOrderBookFeatures } from "./features/orderbook-integration.js";

// Standard feature computation (always available)
const { features } = await computeFeatures("AAPL", "long");

// Optional: Add order book features if IBKR is connected
const obFeatures = await fetchOrderBookFeatures("AAPL");
if (obFeatures) {
  console.log(`Order Book Imbalance: ${obFeatures.obi.toFixed(3)}`);
  console.log(`Weighted Imbalance: ${obFeatures.wobi.toFixed(3)}`);
  
  // Add to evaluation notes for model context
  const notes = `OBI: ${obFeatures.obi.toFixed(3)}, WOBI: ${obFeatures.wobi.toFixed(3)}`;
}
```

### VPIN Usage (Trade Flow Tracking)

VPIN requires a stream of classified buy/sell volumes:

```typescript
import { OrderBookFeatures } from "./order-book-imbalance.js";

// Example: Track buy/sell volumes over 50 buckets
const buyVolumeWindow = [1500, 2000, 1800, ...]; // 50 buckets
const sellVolumeWindow = [1200, 1800, 2200, ...]; // 50 buckets

const vpin = OrderBookFeatures.calculateVPIN(buyVolumeWindow, sellVolumeWindow);

console.log(`VPIN (Flow Toxicity): ${vpin.toFixed(3)}`);
// High VPIN (>0.5) suggests informed trading, potential adverse selection
```

## API Reference

### `OrderBookFeatures` Class

Static methods for pure computation:

#### `calculateOBI(book: OrderBookState): number`

Calculate Order Book Imbalance at Level 1 (best bid/ask).

#### `calculateWOBI(book: OrderBookState, depth: number = 5): number`

Calculate Weighted Order Book Imbalance up to specified depth.

#### `calculateVPIN(buyVolumeWindow: number[], sellVolumeWindow: number[]): number`

Calculate VPIN from historical buy/sell volume windows.

### Helper Functions

#### `marketDepthToOrderBook(snapshot: MarketDepthSnapshot): OrderBookState`

Convert IBKR market depth format to order book state.

#### `computeOrderBookFeatures(book: OrderBookState, depth?: number): { obi: number; wobi: number }`

Compute both OBI and WOBI from a single order book snapshot.

#### `fetchOrderBookFeatures(symbol: string, depth?: number): Promise<{...} | null>`

Fetch order book features from IBKR (returns null if not connected).

## Testing

Comprehensive test suite with 40+ test cases covering:

- Edge cases (empty arrays, zero volumes, division by zero)
- Balanced and imbalanced order books
- Fractional volumes and high-precision calculations
- Large volume windows and alternating pressure patterns
- Adapter function correctness

Run tests:

```bash
npm test -- src/eval/features/__tests__/order-book-imbalance.test.ts
```

## Integration Philosophy

Order book features are **optional enhancements**, not core features:

1. **Main pipeline uses Yahoo Finance** - always available, no IBKR required
2. **Order book features are add-ons** - computed separately when IBKR is connected
3. **Graceful degradation** - if IBKR unavailable, evaluation proceeds with base features
4. **No breaking changes** - existing evaluation pipeline unchanged

This design ensures:
- ✅ System works without IBKR connection
- ✅ No added latency when IBKR not available
- ✅ Optional enhancement for users with Level 2 data
- ✅ Clear separation between core and optional features

## Future Enhancements

Potential improvements:

1. **Streaming VPIN** - Real-time trade flow tracking for continuous VPIN
2. **Order book depth visualization** - Dashboard component for L2 data
3. **Historical order book snapshots** - Store depth for backtesting
4. **Additional microstructure metrics** - Spread dynamics, depth imbalance at multiple levels
5. **Feature vector integration** - Add OBI/WOBI as optional fields in FeatureVector type

## References

- Easley, D., López de Prado, M., & O'Hara, M. (2012). "Flow Toxicity and Liquidity in a High-Frequency World." *Review of Financial Studies*.
- Cont, R., Kukanov, A., & Stoikov, S. (2014). "The Price Impact of Order Book Events." *Journal of Financial Econometrics*.
