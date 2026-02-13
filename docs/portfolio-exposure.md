# Portfolio Exposure Endpoint

## Overview
The portfolio exposure endpoint provides comprehensive analytics on current portfolio positions including risk metrics, sector allocation, and beta-weighted exposure.

## Endpoint
`GET /api/portfolio/exposure`

## Requirements
- IBKR TWS or Gateway must be connected
- Active positions in the account (optional - returns zeros if no positions)

## Response Example

```json
{
  "grossExposure": 92000,
  "netExposure": 78000,
  "percentDeployed": 65.3,
  "largestPositionPercent": 18.5,
  "largestPosition": "AAPL",
  "sectorBreakdown": {
    "Technology": 55.2,
    "Consumer Cyclical": 25.0,
    "Healthcare": 19.8
  },
  "betaWeightedExposure": 85000,
  "portfolioHeat": 4500,
  "positionCount": 5,
  "netLiquidation": 141000
}
```

## Response Fields

| Field | Type | Description |
|-------|------|-------------|
| `grossExposure` | number | Sum of absolute values of all position market values |
| `netExposure` | number | Sum of signed market values (long positive, short negative) |
| `percentDeployed` | number | Gross exposure as percentage of net liquidation |
| `largestPositionPercent` | number | Largest single position as percentage of net liquidation |
| `largestPosition` | string\|null | Symbol of the largest position |
| `sectorBreakdown` | object | Sector allocations as percentage of gross exposure |
| `betaWeightedExposure` | number | Sum of (position value × beta), where beta is correlation with SPY over 20 days |
| `portfolioHeat` | number | Sum of (position size × 2×ATR) as estimated risk exposure |
| `positionCount` | number | Number of open positions |
| `netLiquidation` | number | Total account net liquidation value |

## Usage Examples

### REST API
```bash
curl -H "X-API-Key: your-api-key" \
  http://localhost:3000/api/portfolio/exposure
```

### MCP Tool (Claude Desktop)
```
Use the portfolio_exposure tool to get current portfolio analytics
```

## Implementation Details

### Beta Calculation
- Fetches 20 days of historical daily bars for each position and SPY
- Computes daily returns for both the stock and SPY
- Calculates beta as: Covariance(stock, SPY) / Variance(SPY)
- Defaults to 1.0 on error or insufficient data

### ATR Calculation (14-period)
- Uses standard True Range formula:
  - TR = max(high - low, |high - prev_close|, |low - prev_close|)
- Takes average of last 14 true ranges
- Used in portfolio heat calculation (2×ATR as estimated stop distance)

### Sector Classification
- Retrieved from IBKR contract details (category field)
- Cached for 24 hours to minimize API calls
- Falls back to "Unknown" if sector data unavailable

### Caching Strategy
- Contract details (sector info) cached for 24 hours
- Historical bars fetched fresh on each request
- Cache invalidation: time-based only (no manual invalidation)

## Error Handling

### IBKR Not Connected
```json
{
  "error": "IBKR not connected. Start TWS/Gateway for portfolio data."
}
```

### No Positions
Returns zeroed metrics with current net liquidation:
```json
{
  "grossExposure": 0,
  "netExposure": 0,
  "percentDeployed": 0,
  "largestPositionPercent": 0,
  "largestPosition": null,
  "sectorBreakdown": {},
  "betaWeightedExposure": 0,
  "portfolioHeat": 0,
  "positionCount": 0,
  "netLiquidation": 141000
}
```

## Performance Considerations

- **First request (cold cache)**: 5-10 seconds for portfolios with multiple positions
- **Subsequent requests (warm cache)**: 2-5 seconds (contract details cached for 24h)
- Each position requires:
  - 1 contract details lookup (cached after first call)
  - 1 current quote fetch (live Yahoo Finance)
  - 2 historical bar fetches (stock + SPY for beta, live data)
- Requests are processed in parallel for all positions
- Contract details cache significantly improves subsequent request times

## Use Cases

1. **Risk Monitoring**: Track overall portfolio heat and leverage
2. **Sector Rebalancing**: Identify over-concentrated sectors
3. **Market Exposure**: Measure beta-weighted exposure vs SPY
4. **Position Sizing**: Ensure no single position exceeds risk limits
5. **Portfolio Analytics**: Generate daily snapshots for tracking

## Related Endpoints

- `GET /api/account/summary` - Account balance and buying power
- `GET /api/account/positions` - Raw position data without analytics
- `GET /api/account/pnl` - Daily P&L metrics
