# Action Parameter Schema Format

## Overview

The `actionsMeta` object in `src/rest/agent.ts` defines metadata for all agent actions, including parameter schemas that are used to generate the OpenAPI specification for ChatGPT Actions integration.

## Enhanced Schema Format

As of this update, `actionsMeta` supports detailed parameter schemas with full type information, validation, and documentation. The OpenAPI generator (`src/rest/openapi-gen.ts`) automatically generates proper OpenAPI 3.0 schemas from these definitions.

## Schema Structure

Each action in `actionsMeta` can define parameters in two formats:

### Legacy Format (Simple String Array)
```typescript
{
  description: "Action description",
  params: ["symbol", "price?"],  // ? suffix indicates optional
  requiresIBKR: true  // optional flag
}
```

### Enhanced Format (Detailed Schema Object)
```typescript
{
  description: "Action description",
  params: {
    symbol: {
      type: "string",
      description: "Stock ticker symbol (e.g., 'AAPL', 'TSLA')",
      required: true
    },
    orderType: {
      type: "string",
      description: "Order type",
      enum: ["MKT", "LMT", "STP", "STP LMT", "TRAIL", "TRAIL LIMIT"],
      required: true
    },
    lmtPrice: {
      type: "number",
      description: "Limit price (required for LMT orders)",
      required: false
    },
    count: {
      type: "number",
      description: "Number of results to return",
      default: 20
    }
  },
  requiresIBKR: true
}
```

## Parameter Schema Fields

Each parameter in the enhanced format can have:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | `"string" \| "number" \| "boolean" \| "object" \| "array"` | ✓ | Parameter data type |
| `description` | `string` | ✓ | Clear description with examples |
| `required` | `boolean` | | Whether the parameter is required (default: false) |
| `enum` | `string[] \| number[]` | | List of allowed values |
| `default` | `string \| number \| boolean` | | Default value if not provided |
| `items` | `{ type: string }` | | For array types, describes item type |

## Example: High-Priority Actions with Full Schemas

### place_order
```typescript
place_order: { 
  description: "Place a single order", 
  params: {
    symbol: { 
      type: "string", 
      description: "Stock ticker symbol (e.g., 'AAPL', 'TSLA')", 
      required: true 
    },
    action: { 
      type: "string", 
      description: "Order action", 
      enum: ["BUY", "SELL"], 
      required: true 
    },
    orderType: { 
      type: "string", 
      description: "Order type", 
      enum: ["MKT", "LMT", "STP", "STP LMT", "TRAIL", "TRAIL LIMIT", "REL", "MIT", "MOC", "LOC", "MIDPRICE"], 
      required: true 
    },
    totalQuantity: { 
      type: "number", 
      description: "Number of shares/contracts to trade", 
      required: true 
    },
    lmtPrice: { 
      type: "number", 
      description: "Limit price (required for LMT, STP LMT, TRAIL LIMIT, REL orders)" 
    },
    tif: { 
      type: "string", 
      description: "Time in force", 
      enum: ["DAY", "GTC", "IOC", "GTD", "OPG", "FOK", "DTC"], 
      default: "DAY" 
    },
  },
  requiresIBKR: true 
}
```

### get_historical_bars
```typescript
get_historical_bars: { 
  description: "Get historical price bars", 
  params: {
    symbol: { 
      type: "string", 
      description: "Stock ticker symbol (e.g., 'AAPL', 'TSLA')", 
      required: true 
    },
    period: { 
      type: "string", 
      description: "Historical period to fetch",
      enum: ["1d", "5d", "1mo", "3mo", "6mo", "1y", "2y", "5y", "10y", "ytd", "max"],
      default: "3mo",
    },
    interval: { 
      type: "string", 
      description: "Bar interval/timeframe",
      enum: ["1m", "2m", "5m", "15m", "30m", "60m", "90m", "1h", "1d", "5d", "1wk", "1mo", "3mo"],
      default: "1d",
    },
  },
}
```

### run_screener
```typescript
run_screener: { 
  description: "Run a stock screener", 
  params: {
    screener_id: { 
      type: "string", 
      description: "Screener to run",
      enum: [
        "day_gainers", 
        "day_losers", 
        "most_actives", 
        "small_cap_gainers", 
        "undervalued_large_caps", 
        "aggressive_small_caps", 
        "growth_technology_stocks"
      ],
      default: "day_gainers",
    },
    count: { 
      type: "number", 
      description: "Number of results to return (max 100)", 
      default: 20 
    },
  },
}
```

## Benefits

1. **Type Safety**: ChatGPT receives accurate type information for all parameters
2. **Validation**: Enum constraints prevent invalid values
3. **Auto-Complete**: Better IDE support and API client generation
4. **Documentation**: Clear examples and descriptions for each parameter
5. **Default Values**: Explicit defaults improve API usability
6. **Backward Compatible**: Legacy string array format still supported

## OpenAPI Generation

The enhanced schemas are automatically converted to OpenAPI 3.0 format by `src/rest/openapi-gen.ts`:

```typescript
function generateActionParamsSchema(actionName: string): OpenApiSchema {
  const meta = actionsMeta[actionName];
  
  // Handle both string[] (legacy) and Record<string, ParamSchema> (enhanced)
  if (Array.isArray(meta.params)) {
    // Legacy format: ["param1", "param2?"]
    // Converts to basic OpenAPI schema with string types
  } else {
    // Enhanced format: { param1: { type: "string", ... }, ... }
    // Converts to detailed OpenAPI schema with full validation
  }
}
```

## Testing

The action catalog tests in `src/rest/__tests__/agent-catalog.test.ts` verify:
- All actions have non-empty descriptions
- Parameter arrays don't contain empty strings
- Metadata is JSON-serializable
- IBKR actions are properly flagged with `requiresIBKR: true`

## Maintenance

When adding new actions:

1. Define the action handler in the `actions` object
2. Add metadata to `actionsMeta` with detailed parameter schemas
3. Include all enum values for constrained parameters
4. Provide clear descriptions with examples
5. Mark required parameters with `required: true`
6. Specify default values where applicable
7. Update tests if adding to the expected action list

## Complete Coverage

All 119+ actions now have complete parameter schemas:
- System actions (2)
- Market data (14 Yahoo Finance actions)
- IBKR market data (6 actions)
- IBKR news (4 actions)
- IBKR data wrappers (11 actions)
- Account operations (3 actions)
- Order management (11 actions)
- Portfolio analytics (3 actions)
- Risk/session management (7 actions)
- Evaluation system (6 actions)
- Flatten configuration (2 actions)
- Collaboration (4 actions)
- Inbox management (4 actions)
- Trade journal (7 actions)
- History queries (2 actions)
- Subscriptions (9 actions)
- Holly AI alerts (31 actions)
- Signals/auto-eval (6 actions)
- Multi-model orchestration (2 actions)
- Divoom display (3 actions)
- Ops/monitoring (6 actions)
