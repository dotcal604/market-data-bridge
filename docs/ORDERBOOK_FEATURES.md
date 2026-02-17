# Order Book Imbalance & VPIN Features

## Overview
This module provides real-time order book microstructure features using IBKR Level 2 market depth data.

## Features

### 1. Order Book Imbalance (OBI)
Measures buying vs selling pressure at the best bid/ask.
- Formula: `ρ = (V_bid - V_ask) / (V_bid + V_ask)`
- Range: [-1, 1]
- Positive values indicate buying pressure
- Negative values indicate selling pressure

### 2. Weighted Order Book Imbalance (WOBI)
Extends OBI across multiple depth levels with exponential decay weights.
- Uses up to 5-10 depth levels
- Deeper levels get lower weights
- More robust than single-level OBI

### 3. VPIN (Volume-Synchronized Probability of Informed Trading)
Estimates the probability of informed trading based on trade flow imbalance.
- Formula: `VPIN = Σ|V_buy - V_sell| / Σ(V_buy + V_sell)`
- Range: [0, 1]
- Higher values indicate more informed trading (toxic flow)

### 4. Trade Flow Toxicity
Measures adverse selection risk from order flow.
- Based on VPIN methodology
- Higher toxicity = greater risk of informed traders

## Usage

### Pure Functions (No IBKR Required)
```typescript
import {
  computeBookImbalance,
  computeWeightedBookImbalance,
  computeVPIN,
  classifyTrades,
  computeTradeFlowToxicity,
} from "./eval/features/order-book-imbalance.js";

// Example: Order book at best bid/ask
const bids = [{ price: 100.00, size: 500 }];
const asks = [{ price: 100.05, size: 300 }];
const imbalance = computeBookImbalance(bids, asks);
// Result: (500 - 300) / (500 + 300) = 0.25 (buying pressure)

// Example: VPIN from volume buckets
const buyVolumes = [100, 200, 150, 300];
const sellVolumes = [80, 120, 200, 100];
const vpin = computeVPIN(buyVolumes, sellVolumes);
// Higher VPIN = more informed trading
```

### Live Integration (Requires IBKR Connection + Level 2 Subscription)
```typescript
import {
  computeOrderBookFeatures,
  computeTradeFlowFeatures,
  computeAllOrderBookFeatures,
} from "./eval/features/orderbook-live.js";

// Get order book features from IBKR Level 2 data
const features = await computeOrderBookFeatures("AAPL", 10);
if (features) {
  console.log(`Book imbalance: ${features.book_imbalance}`);
  console.log(`Weighted imbalance (10 levels): ${features.weighted_book_imbalance}`);
  console.log(`Weighted imbalance (5 levels): ${features.book_imbalance_depth_5}`);
}

// Get trade flow features from tick data
const trades = [
  { price: 100.05, size: 100, timestamp: Date.now() },
  { price: 99.95, size: 150, timestamp: Date.now() },
  // ... more trades
];
const midpoint = 100.00;
const tradeFlow = computeTradeFlowFeatures(trades, midpoint, 10);
if (tradeFlow) {
  console.log(`VPIN: ${tradeFlow.vpin}`);
  console.log(`Toxicity: ${tradeFlow.trade_flow_toxicity}`);
  console.log(`Buy ratio: ${tradeFlow.buy_volume_ratio}`);
}
```

### REST API (via Agent Action)
```bash
POST /api/agent
{
  "action": "get_orderbook_features",
  "params": {
    "symbol": "AAPL",
    "depth": 10
  }
}
```

Response:
```json
{
  "action": "get_orderbook_features",
  "result": {
    "book_imbalance": 0.25,
    "weighted_book_imbalance": 0.18,
    "book_imbalance_depth_5": 0.22,
    "timestamp": "2026-02-17T10:30:00.000Z"
  }
}
```

## Requirements

### IBKR Level 2 Data
- Active TWS/Gateway connection
- Level 2 market data subscription for the symbol
- Not all symbols have Level 2 data available
- Additional fees may apply

### Data Subscriptions
Level 2 data requires:
1. Market Data Subscriptions in IBKR account
2. Real-time data for the exchange (e.g., NASDAQ Level II)
3. May require professional/non-professional designation

## Edge Cases Handled

1. **Empty order book**: Returns 0 or null
2. **Zero volume**: Returns 0
3. **Single-sided book**: Returns ±1
4. **Mismatched array lengths**: Returns 0 or null
5. **Division by zero**: Handled gracefully

## Testing

Run tests:
```bash
npm test src/eval/features/__tests__/order-book-imbalance.test.ts
```

Test coverage:
- 5 test suites
- 40+ test cases
- Edge cases: empty arrays, zero volume, division by zero
- Normal cases: balanced/imbalanced books, various depths
- Trade classification: buy/sell determination

## Mathematical Details

### Order Book Imbalance Formula
```
OBI = (BidVolume - AskVolume) / (BidVolume + AskVolume)

Where:
  BidVolume = size at best bid
  AskVolume = size at best ask
```

### Weighted OBI Formula
```
WOBI = Σ(w_i × OBI_i) / Σw_i

Where:
  w_i = e^(-0.5 × i)  (exponential decay)
  i = depth level (0, 1, 2, ...)
  OBI_i = imbalance at level i
```

### VPIN Formula
```
VPIN = Σ|BuyVol_i - SellVol_i| / Σ(BuyVol_i + SellVol_i)

Where:
  i = volume bucket index
  BuyVol_i = buy volume in bucket i
  SellVol_i = sell volume in bucket i
```

### Trade Classification (Tick Rule)
```
Trade is buy-initiated if:  price ≥ midpoint
Trade is sell-initiated if: price < midpoint

Where:
  midpoint = (bid + ask) / 2
```

## Performance Notes

- Pure functions have O(n) complexity where n = number of levels/buckets
- IBKR market depth subscription has ~5 second initial snapshot delay
- Subscriptions are cleaned up immediately after getting snapshot
- No persistent connections maintained

## References

1. Easley, D., López de Prado, M. M., & O'Hara, M. (2012). "Flow Toxicity and Liquidity in a High-frequency World"
2. Cont, R., Kukanov, A., & Stoikov, S. (2014). "The Price Impact of Order Book Events"
3. Hasbrouck, J. (2007). "Empirical Market Microstructure"
