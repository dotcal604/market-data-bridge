/**
 * Minimal OpenAPI spec for the ChatGPT Custom GPT agent endpoint.
 * Only 2 operations — bypasses the 30-op limit entirely.
 * Served at GET /openapi-agent.json (unauthenticated).
 *
 * IMPORTANT: ChatGPT Actions cannot handle freeform `additionalProperties: true`
 * objects — they throw `UnrecognizedKwargsError`. So we define the most common
 * parameters as explicit optional properties. The bridge dispatcher accepts
 * BOTH nested `{"action":"x","params":{...}}` and flat `{"action":"x","symbol":"Y"}`.
 */
export const openApiAgentSpec = {
  openapi: "3.1.0",
  info: {
    title: "Market Data Bridge — Agent",
    description:
      "Single-endpoint agent dispatcher for IBKR Market Data Bridge. Call getGptInstructions first, then use executeAction for all 140+ tools.",
    version: "1.1.0",
  },
  servers: [{ url: "https://api.klfh-dot-io.com" }],
  components: {
    schemas: {},
    securitySchemes: {
      ApiKeyAuth: {
        type: "apiKey",
        in: "header",
        name: "X-API-Key",
      },
    },
  },
  security: [{ ApiKeyAuth: [] as string[] }],
  paths: {
    "/api/gpt-instructions": {
      get: {
        operationId: "getGptInstructions",
        summary:
          "Get system instructions and full action catalog. Call this FIRST in every conversation.",
        responses: {
          "200": {
            description: "System instructions with complete action reference",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    role: { type: "string" },
                    instructions: { type: "string" },
                  },
                },
              },
            },
          },
        },
      },
    },
    "/api/agent": {
      post: {
        operationId: "executeAction",
        summary:
          "Execute any bridge action. Send action name plus parameters as flat keys. Call getGptInstructions first to see the full action catalog with per-action parameter lists.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["action"],
                properties: {
                  action: {
                    type: "string",
                    description:
                      "Action name (e.g. get_quote, place_order, get_positions). See getGptInstructions for full list.",
                  },
                  // Common parameters used across many actions — sent as flat top-level keys.
                  // The bridge accepts any additional keys as action params.
                  symbol: {
                    type: "string",
                    description: "Ticker symbol (e.g. AAPL, SPY, MSFT). Used by most market data and trading actions.",
                  },
                  // Market data params
                  period: { type: "string", description: "Time period (e.g. 1d, 5d, 1mo, 3mo, 6mo, 1y, ytd, max)" },
                  interval: { type: "string", description: "Bar interval (e.g. 1m, 5m, 15m, 1h, 1d)" },
                  query: { type: "string", description: "Search query for symbols or news" },
                  expiration: { type: "string", description: "Option expiration date (YYYYMMDD)" },
                  expiry: { type: "string", description: "Option expiry date (YYYYMMDD)" },
                  strike: { type: "string", description: "Option strike price" },
                  right: { type: "string", description: "Option type: C (call) or P (put)" },
                  screener_id: { type: "string", description: "Screener ID (e.g. day_gainers, day_losers, most_actives)" },
                  count: { type: "string", description: "Number of results to return" },
                  limit: { type: "string", description: "Maximum items to return" },
                  region: { type: "string", description: "Country/region code (e.g. US, GB, CA)" },
                  // Trading params
                  orderType: { type: "string", description: "Order type: MKT, LMT, STP, STP LMT, TRAIL" },
                  totalQuantity: { type: "string", description: "Number of shares" },
                  lmtPrice: { type: "string", description: "Limit price" },
                  auxPrice: { type: "string", description: "Stop/aux price" },
                  tif: { type: "string", description: "Time in force: DAY, GTC, IOC" },
                  entryType: { type: "string", description: "Entry order type: MKT or LMT" },
                  entryPrice: { type: "string", description: "Entry price for bracket orders" },
                  takeProfitPrice: { type: "string", description: "Take profit price" },
                  stopLossPrice: { type: "string", description: "Stop loss price" },
                  stopPrice: { type: "string", description: "Stop price for position sizing" },
                  orderId: { type: "string", description: "Order ID for modify/cancel" },
                  // Evaluation & analytics
                  evaluation_id: { type: "string", description: "Evaluation ID for outcomes/reasoning" },
                  days: { type: "string", description: "Lookback period in days" },
                  date: { type: "string", description: "Specific date (YYYY-MM-DD)" },
                  since: { type: "string", description: "ISO timestamp or date filter" },
                  hours: { type: "string", description: "Hours for time-windowed queries" },
                  // Ensemble weights
                  claude: { type: "string", description: "Weight for Claude model" },
                  gpt4o: { type: "string", description: "Weight for GPT-4o model" },
                  gemini: { type: "string", description: "Weight for Gemini model" },
                  // Risk & session
                  shockPercent: { type: "string", description: "Shock percentage for stress test" },
                  riskPercent: { type: "string", description: "Risk percentage of equity" },
                  enabled: { type: "string", description: "Boolean flag (true/false)" },
                  reason: { type: "string", description: "Reason for session lock" },
                  // Collab & inbox
                  content: { type: "string", description: "Message content for collab/post" },
                  author: { type: "string", description: "Message author: claude, chatgpt, user" },
                  tags: { type: "string", description: "Comma-separated tags" },
                  ids: { type: "string", description: "Comma-separated IDs" },
                  id: { type: "string", description: "Item ID" },
                  all: { type: "string", description: "Boolean flag for mark-all operations" },
                  // Journal
                  reasoning: { type: "string", description: "Trade reasoning for journal" },
                  strategy: { type: "string", description: "Strategy name or version" },
                  // Holly
                  csv: { type: "string", description: "CSV content for import" },
                  file_path: { type: "string", description: "File path on disk" },
                  segment: { type: "string", description: "Holly segment filter" },
                  until: { type: "string", description: "End date filter (ISO)" },
                  // Ops
                  scenario: { type: "string", description: "Runbook scenario name" },
                  // Misc
                  text: { type: "string", description: "Text content (e.g. for Divoom display)" },
                  direction: { type: "string", description: "Trade direction: long or short" },
                  type: { type: "string", description: "Filter type or tick type" },
                  secType: { type: "string", description: "Security type: STK, OPT, FUT" },
                  exchange: { type: "string", description: "Exchange: SMART, NYSE, etc." },
                  currency: { type: "string", description: "Currency: USD, CAD, EUR" },
                  account: { type: "string", description: "Account code" },
                  subscriptionId: { type: "string", description: "Subscription ID" },
                },
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Action result",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    action: { type: "string" },
                    result: { description: "Action-specific response data" },
                  },
                },
              },
            },
          },
          "400": {
            description: "Bad request — unknown action or missing params",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    error: { type: "string" },
                    available_actions: {
                      type: "array",
                      items: { type: "string" },
                    },
                  },
                },
              },
            },
          },
          "500": {
            description: "Action execution error",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    action: { type: "string" },
                    error: { type: "string" },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
};
