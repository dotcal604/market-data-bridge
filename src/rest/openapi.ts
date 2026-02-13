export const openApiSpec = {
  openapi: "3.1.0",
  info: {
    title: "Market Data Bridge",
    description:
      "Market data API powered by Yahoo Finance (always available) + IBKR account data (when TWS/Gateway is running). Provides real-time quotes, historical bars, options chains, financials, earnings, news, screeners, and brokerage account info.",
    version: "3.0.0",
  },
  servers: [{ url: "https://api.klfh-dot-io.com" }],
  components: {
    schemas: {
      CollabMessage: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid", description: "Unique message ID" },
          author: { type: "string", enum: ["claude", "chatgpt", "user"] },
          content: { type: "string", maxLength: 8000 },
          timestamp: { type: "string", format: "date-time" },
          replyTo: { type: "string", description: "ID of message being replied to" },
          tags: { type: "array", items: { type: "string" } },
        },
        required: ["id", "author", "content", "timestamp"],
      },
    },
    securitySchemes: {
      ApiKeyAuth: {
        type: "apiKey",
        in: "header",
        name: "X-API-Key",
      },
    },
  },
  security: [{ ApiKeyAuth: [] }],
  paths: {
    "/api/gpt-instructions": {
      get: {
        operationId: "getGptInstructions",
        summary: "Get the latest GPT system instructions. Call this at the START of every conversation to stay in sync with the bridge's current capabilities.",
        responses: {
          "200": {
            description: "Current GPT system prompt",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    role: { type: "string", description: "Always 'system'" },
                    instructions: { type: "string", description: "Full system prompt text — follow these instructions for the rest of the conversation" },
                  },
                },
              },
            },
          },
        },
      },
    },
    "/api/status": {
      get: {
        operationId: "getStatus",
        summary: "Get bridge status — market data availability and IBKR connection state",
        responses: {
          "200": {
            description: "Bridge status",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    status: { type: "string" },
                    easternTime: { type: "string", description: "Current Eastern Time formatted string" },
                    marketSession: { type: "string", enum: ["pre-market", "regular", "after-hours", "closed"], description: "Current U.S. market session" },
                    marketData: { type: "string" },
                    screener: { type: "string" },
                    ibkr: {
                      type: "object",
                      properties: {
                        connected: { type: "boolean" },
                        host: { type: "string" },
                        port: { type: "integer" },
                        clientId: { type: "integer" },
                        note: { type: "string" },
                      },
                    },
                    timestamp: { type: "string" },
                  },
                },
              },
            },
          },
        },
      },
    },
    "/api/quote/{symbol}": {
      get: {
        operationId: "getQuote",
        summary: "Smart quote: tries IBKR real-time first, falls back to Yahoo. Returns source field indicating which was used.",
        parameters: [
          { name: "symbol", in: "path", required: true, schema: { type: "string" }, description: "Ticker symbol, e.g. AAPL, MSFT, SPY" },
        ],
        responses: {
          "200": {
            description: "Quote data with source indicator",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    symbol: { type: "string" },
                    source: { type: "string", enum: ["ibkr", "yahoo"], description: "Data source: ibkr (real-time) or yahoo (delayed)" },
                    bid: { type: "number", nullable: true },
                    ask: { type: "number", nullable: true },
                    last: { type: "number", nullable: true },
                    open: { type: "number", nullable: true },
                    high: { type: "number", nullable: true },
                    low: { type: "number", nullable: true },
                    close: { type: "number", nullable: true },
                    volume: { type: "number", nullable: true },
                    change: { type: "number", nullable: true },
                    changePercent: { type: "number", nullable: true },
                    marketCap: { type: "number", nullable: true },
                    timestamp: { type: "string" },
                  },
                },
              },
            },
          },
        },
      },
    },
    "/api/history/{symbol}": {
      get: {
        operationId: "getHistoricalBars",
        summary: "Get historical OHLCV bars for a stock",
        parameters: [
          { name: "symbol", in: "path", required: true, schema: { type: "string" }, description: "Ticker symbol" },
          {
            name: "period",
            in: "query",
            schema: { type: "string", default: "3mo" },
            description: 'Time period: "1d","5d","1mo","3mo","6mo","1y","2y","5y","10y","ytd","max"',
          },
          {
            name: "interval",
            in: "query",
            schema: { type: "string", default: "1d" },
            description: 'Bar interval: "1m","5m","15m","1h","1d","1wk","1mo"',
          },
        ],
        responses: {
          "200": {
            description: "Historical bars",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    symbol: { type: "string" },
                    count: { type: "integer" },
                    bars: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          time: { type: "string" },
                          open: { type: "number" },
                          high: { type: "number" },
                          low: { type: "number" },
                          close: { type: "number" },
                          volume: { type: "number" },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    "/api/details/{symbol}": {
      get: {
        operationId: "getStockDetails",
        summary: "Get detailed company info: sector, industry, description, market cap, PE ratio, 52-week range",
        parameters: [
          { name: "symbol", in: "path", required: true, schema: { type: "string" }, description: "Ticker symbol" },
        ],
        responses: {
          "200": {
            description: "Stock details",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    symbol: { type: "string" },
                    longName: { type: "string", nullable: true },
                    shortName: { type: "string", nullable: true },
                    exchange: { type: "string", nullable: true },
                    currency: { type: "string", nullable: true },
                    quoteType: { type: "string", nullable: true },
                    sector: { type: "string", nullable: true },
                    industry: { type: "string", nullable: true },
                    website: { type: "string", nullable: true },
                    longBusinessSummary: { type: "string", nullable: true },
                    fullTimeEmployees: { type: "integer", nullable: true },
                    marketCap: { type: "number", nullable: true },
                    trailingPE: { type: "number", nullable: true },
                    forwardPE: { type: "number", nullable: true },
                    dividendYield: { type: "number", nullable: true },
                    fiftyTwoWeekHigh: { type: "number", nullable: true },
                    fiftyTwoWeekLow: { type: "number", nullable: true },
                  },
                },
              },
            },
          },
        },
      },
    },
    "/api/options/{symbol}": {
      get: {
        operationId: "getOptionsChain",
        summary: "Get option expirations, strikes, and full chain data (calls + puts with bid/ask/IV/OI)",
        parameters: [
          { name: "symbol", in: "path", required: true, schema: { type: "string" }, description: "Underlying stock symbol" },
          { name: "expiration", in: "query", schema: { type: "string" }, description: "Filter to specific expiration in YYYYMMDD format" },
        ],
        responses: {
          "200": {
            description: "Options chain",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    symbol: { type: "string" },
                    expirations: { type: "array", items: { type: "string" } },
                    strikes: { type: "array", items: { type: "number" } },
                    calls: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          contractSymbol: { type: "string" },
                          strike: { type: "number" },
                          expiration: { type: "string" },
                          type: { type: "string", enum: ["C", "P"] },
                          lastPrice: { type: "number", nullable: true },
                          bid: { type: "number", nullable: true },
                          ask: { type: "number", nullable: true },
                          volume: { type: "integer", nullable: true },
                          openInterest: { type: "integer", nullable: true },
                          impliedVolatility: { type: "number", nullable: true },
                          inTheMoney: { type: "boolean" },
                        },
                      },
                    },
                    puts: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          contractSymbol: { type: "string" },
                          strike: { type: "number" },
                          expiration: { type: "string" },
                          type: { type: "string", enum: ["C", "P"] },
                          lastPrice: { type: "number", nullable: true },
                          bid: { type: "number", nullable: true },
                          ask: { type: "number", nullable: true },
                          volume: { type: "integer", nullable: true },
                          openInterest: { type: "integer", nullable: true },
                          impliedVolatility: { type: "number", nullable: true },
                          inTheMoney: { type: "boolean" },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    "/api/options/{symbol}/quote": {
      get: {
        operationId: "getOptionQuote",
        summary: "Get quote for a specific option contract",
        parameters: [
          { name: "symbol", in: "path", required: true, schema: { type: "string" }, description: "Underlying stock symbol" },
          { name: "expiry", in: "query", required: true, schema: { type: "string" }, description: "Expiration date YYYYMMDD" },
          { name: "strike", in: "query", required: true, schema: { type: "number" }, description: "Strike price" },
          { name: "right", in: "query", required: true, schema: { type: "string", enum: ["C", "P"] }, description: "C=Call, P=Put" },
        ],
        responses: {
          "200": {
            description: "Option quote",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    symbol: { type: "string" },
                    bid: { type: "number", nullable: true },
                    ask: { type: "number", nullable: true },
                    last: { type: "number", nullable: true },
                    volume: { type: "number", nullable: true },
                    timestamp: { type: "string" },
                  },
                },
              },
            },
          },
        },
      },
    },
    "/api/search": {
      get: {
        operationId: "searchSymbols",
        summary: "Search for stocks, ETFs, indices by name or partial symbol",
        parameters: [
          { name: "q", in: "query", required: true, schema: { type: "string" }, description: "Search query — partial symbol or company name" },
        ],
        responses: {
          "200": {
            description: "Search results",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    count: { type: "integer" },
                    results: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          symbol: { type: "string" },
                          shortName: { type: "string", nullable: true },
                          longName: { type: "string", nullable: true },
                          exchange: { type: "string", nullable: true },
                          quoteType: { type: "string", nullable: true },
                          sector: { type: "string", nullable: true },
                          industry: { type: "string", nullable: true },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    "/api/news/{query}": {
      get: {
        operationId: "getNews",
        summary: "Get recent news articles for a stock ticker or search query",
        parameters: [
          { name: "query", in: "path", required: true, schema: { type: "string" }, description: "Ticker symbol or search query" },
        ],
        responses: {
          "200": {
            description: "News articles",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    count: { type: "integer" },
                    articles: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          title: { type: "string" },
                          publisher: { type: "string", nullable: true },
                          link: { type: "string" },
                          publishedAt: { type: "string" },
                          relatedTickers: { type: "array", items: { type: "string" } },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    "/api/financials/{symbol}": {
      get: {
        operationId: "getFinancials",
        summary: "Get financial data: revenue, margins, debt, analyst targets, recommendation",
        parameters: [
          { name: "symbol", in: "path", required: true, schema: { type: "string" }, description: "Ticker symbol" },
        ],
        responses: {
          "200": {
            description: "Financial data",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    symbol: { type: "string" },
                    currentPrice: { type: "number", nullable: true },
                    targetMeanPrice: { type: "number", nullable: true },
                    targetHighPrice: { type: "number", nullable: true },
                    targetLowPrice: { type: "number", nullable: true },
                    recommendationKey: { type: "string", nullable: true },
                    recommendationMean: { type: "number", nullable: true },
                    numberOfAnalysts: { type: "integer", nullable: true },
                    totalRevenue: { type: "number", nullable: true },
                    revenuePerShare: { type: "number", nullable: true },
                    revenueGrowth: { type: "number", nullable: true },
                    grossMargins: { type: "number", nullable: true },
                    operatingMargins: { type: "number", nullable: true },
                    profitMargins: { type: "number", nullable: true },
                    ebitda: { type: "number", nullable: true },
                    returnOnEquity: { type: "number", nullable: true },
                    returnOnAssets: { type: "number", nullable: true },
                    debtToEquity: { type: "number", nullable: true },
                    freeCashflow: { type: "number", nullable: true },
                    earningsGrowth: { type: "number", nullable: true },
                    totalCash: { type: "number", nullable: true },
                    totalDebt: { type: "number", nullable: true },
                  },
                },
              },
            },
          },
        },
      },
    },
    "/api/earnings/{symbol}": {
      get: {
        operationId: "getEarnings",
        summary: "Get earnings history (actual vs estimate) and annual/quarterly financial charts",
        parameters: [
          { name: "symbol", in: "path", required: true, schema: { type: "string" }, description: "Ticker symbol" },
        ],
        responses: {
          "200": {
            description: "Earnings data",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    symbol: { type: "string" },
                    earningsChart: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          quarter: { type: "string" },
                          actual: { type: "number", nullable: true },
                          estimate: { type: "number", nullable: true },
                        },
                      },
                    },
                    financialsChart: {
                      type: "object",
                      nullable: true,
                      properties: {
                        yearly: {
                          type: "array",
                          items: {
                            type: "object",
                            properties: {
                              date: { type: "integer" },
                              revenue: { type: "number" },
                              earnings: { type: "number" },
                            },
                          },
                        },
                        quarterly: {
                          type: "array",
                          items: {
                            type: "object",
                            properties: {
                              date: { type: "string" },
                              revenue: { type: "number" },
                              earnings: { type: "number" },
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    "/api/trending": {
      get: {
        operationId: "getTrending",
        summary: "Get currently trending stock symbols",
        parameters: [
          { name: "region", in: "query", schema: { type: "string", default: "US" }, description: 'Country code: "US" (default), "GB", "JP", "CA", etc.' },
        ],
        responses: {
          "200": {
            description: "Trending symbols",
            content: {
              "application/json": {
                schema: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      symbol: { type: "string" },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    "/api/screener/filters": {
      get: {
        operationId: "getScreenerFilters",
        summary: "Get available stock screener IDs and their descriptions",
        responses: {
          "200": {
            description: "Screener ID map",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    day_gainers: { type: "string" },
                    day_losers: { type: "string" },
                    most_actives: { type: "string" },
                    small_cap_gainers: { type: "string" },
                    undervalued_large_caps: { type: "string" },
                    aggressive_small_caps: { type: "string" },
                    growth_technology_stocks: { type: "string" },
                  },
                },
              },
            },
          },
        },
      },
    },
    "/api/screener/run": {
      post: {
        operationId: "runScreener",
        summary: "Run a stock screener. Returns ranked list of stocks matching criteria.",
        requestBody: {
          required: false,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  screener_id: {
                    type: "string",
                    default: "day_gainers",
                    description:
                      'Screener: "day_gainers" (default), "day_losers", "most_actives", "small_cap_gainers", "undervalued_large_caps", "aggressive_small_caps", "growth_technology_stocks"',
                  },
                  count: { type: "integer", default: 20, description: "Number of results" },
                },
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Screener results",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    count: { type: "integer" },
                    results: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          rank: { type: "integer" },
                          symbol: { type: "string" },
                          longName: { type: "string", nullable: true },
                          last: { type: "number", nullable: true },
                          change: { type: "number", nullable: true },
                          changePercent: { type: "number", nullable: true },
                          volume: { type: "number", nullable: true },
                          marketCap: { type: "number", nullable: true },
                          exchange: { type: "string", nullable: true },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    "/api/screener/run-with-quotes": {
      post: {
        operationId: "runScreenerWithQuotes",
        summary: "Run a stock screener with full quote data (bid/ask/OHLC/sector/industry/PE)",
        requestBody: {
          required: false,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  screener_id: {
                    type: "string",
                    default: "day_gainers",
                    description:
                      'Screener: "day_gainers" (default), "day_losers", "most_actives", "small_cap_gainers", "undervalued_large_caps", "aggressive_small_caps", "growth_technology_stocks"',
                  },
                  count: { type: "integer", default: 20, description: "Number of results" },
                },
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Screener results with full quotes",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    count: { type: "integer" },
                    results: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          rank: { type: "integer" },
                          symbol: { type: "string" },
                          longName: { type: "string", nullable: true },
                          last: { type: "number", nullable: true },
                          change: { type: "number", nullable: true },
                          changePercent: { type: "number", nullable: true },
                          volume: { type: "number", nullable: true },
                          marketCap: { type: "number", nullable: true },
                          exchange: { type: "string", nullable: true },
                          bid: { type: "number", nullable: true },
                          ask: { type: "number", nullable: true },
                          open: { type: "number", nullable: true },
                          high: { type: "number", nullable: true },
                          low: { type: "number", nullable: true },
                          close: { type: "number", nullable: true },
                          sector: { type: "string", nullable: true },
                          industry: { type: "string", nullable: true },
                          trailingPE: { type: "number", nullable: true },
                          averageVolume: { type: "number", nullable: true },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    "/api/account/summary": {
      get: {
        operationId: "getAccountSummary",
        summary: "Get IBKR account summary: net liquidation, cash, buying power, margin. Requires TWS/Gateway.",
        responses: {
          "200": {
            description: "Account summary (or error if IBKR not connected)",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    account: { type: "string" },
                    netLiquidation: { type: "number", nullable: true },
                    totalCashValue: { type: "number", nullable: true },
                    settledCash: { type: "number", nullable: true },
                    buyingPower: { type: "number", nullable: true },
                    grossPositionValue: { type: "number", nullable: true },
                    maintMarginReq: { type: "number", nullable: true },
                    excessLiquidity: { type: "number", nullable: true },
                    availableFunds: { type: "number", nullable: true },
                    currency: { type: "string" },
                    timestamp: { type: "string" },
                  },
                },
              },
            },
          },
        },
      },
    },
    "/api/account/positions": {
      get: {
        operationId: "getPositions",
        summary: "Get all current IBKR positions with symbol, quantity, and average cost. Requires TWS/Gateway.",
        responses: {
          "200": {
            description: "Positions list (or error if IBKR not connected)",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    count: { type: "integer" },
                    positions: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          account: { type: "string" },
                          symbol: { type: "string" },
                          secType: { type: "string" },
                          exchange: { type: "string" },
                          currency: { type: "string" },
                          position: { type: "number" },
                          avgCost: { type: "number" },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    "/api/portfolio/stress-test": {
      post: {
        operationId: "runPortfolioStressTest",
        summary: "Run portfolio stress scenario using current IBKR positions and account net liquidation.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  shockPercent: { type: "number", description: "Shock percentage applied to each position (e.g. -5 for a 5% down move)" },
                  betaAdjusted: { type: "boolean", default: true, description: "If true, scales position shock by beta vs SPY" },
                },
                required: ["shockPercent"],
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Portfolio stress test result",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    shockPercent: { type: "number" },
                    betaAdjusted: { type: "boolean" },
                    totalProjectedPnL: { type: "number" },
                    equityImpactPercent: { type: "number" },
                    currentNetLiq: { type: "number" },
                    projectedNetLiq: { type: "number" },
                    positions: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          symbol: { type: "string" },
                          marketValue: { type: "number" },
                          beta: { type: "number" },
                          effectiveShock: { type: "number" },
                          projectedLoss: { type: "number" },
                        },
                      },
                    },
                    warnings: { type: "array", items: { type: "string" } },
                  },
                },
              },
            },
          },
        },
      },
    },
    "/api/account/pnl": {
      get: {
        operationId: "getPnL",
        summary: "Get daily profit and loss (daily PnL, unrealized PnL, realized PnL). Requires TWS/Gateway.",
        responses: {
          "200": {
            description: "PnL data (or error if IBKR not connected)",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    account: { type: "string" },
                    dailyPnL: { type: "number", nullable: true },
                    unrealizedPnL: { type: "number", nullable: true },
                    realizedPnL: { type: "number", nullable: true },
                    timestamp: { type: "string" },
                  },
                },
              },
            },
          },
        },
      },
    },
    "/api/account/pnl/{symbol}": {
      get: {
        operationId: "getPnLSingle",
        summary: "Get symbol-level PnL using reqPnLSingle. Requires TWS/Gateway.",
        parameters: [
          { name: "symbol", in: "path", required: true, schema: { type: "string" } },
        ],
        responses: {
          "200": { description: "PnL single response" },
        },
      },
    },
    "/api/search/ibkr": {
      get: {
        operationId: "searchIbkrSymbols",
        summary: "Search IBKR contracts via reqMatchingSymbols.",
        parameters: [
          { name: "q", in: "query", required: true, schema: { type: "string" } },
        ],
        responses: {
          "200": { description: "Matching symbols" },
        },
      },
    },
    "/api/config/market-data-type": {
      post: {
        operationId: "setMarketDataType",
        summary: "Set IBKR market data type (1-4).",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: { marketDataType: { type: "integer", minimum: 1, maximum: 4 } },
                required: ["marketDataType"],
              },
            },
          },
        },
        responses: { "200": { description: "Configured market data type" } },
      },
    },
    "/api/orders/auto-open": {
      post: {
        operationId: "setAutoOpenOrders",
        summary: "Enable/disable auto open orders binding.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: { autoBind: { type: "boolean" } },
                required: ["autoBind"],
              },
            },
          },
        },
        responses: { "200": { description: "Auto open orders updated" } },
      },
    },
    "/api/data/head-timestamp/{symbol}": {
      get: {
        operationId: "getHeadTimestamp",
        summary: "Get earliest available historical timestamp for symbol.",
        parameters: [
          { name: "symbol", in: "path", required: true, schema: { type: "string" } },
          { name: "whatToShow", in: "query", schema: { type: "string", enum: ["TRADES", "MIDPOINT", "BID", "ASK"] } },
          { name: "useRTH", in: "query", schema: { type: "boolean" } },
          { name: "formatDate", in: "query", schema: { type: "integer", enum: [1, 2] } },
        ],
        responses: { "200": { description: "Head timestamp" } },
      },
    },
    "/api/data/histogram/{symbol}": {
      get: {
        operationId: "getHistogramData",
        summary: "Get histogram data distribution for symbol.",
        parameters: [
          { name: "symbol", in: "path", required: true, schema: { type: "string" } },
          { name: "useRTH", in: "query", schema: { type: "boolean" } },
          { name: "period", in: "query", schema: { type: "integer", minimum: 1 } },
          { name: "periodUnit", in: "query", schema: { type: "string", enum: ["S", "D", "W", "M", "Y"] } },
        ],
        responses: { "200": { description: "Histogram data" } },
      },
    },
    "/api/options/implied-vol": {
      post: {
        operationId: "calculateImpliedVolatility",
        summary: "Calculate implied volatility for an option contract.",
        requestBody: { required: true },
        responses: { "200": { description: "Implied volatility result" } },
      },
    },
    "/api/options/price": {
      post: {
        operationId: "calculateOptionPrice",
        summary: "Calculate option price from supplied volatility.",
        requestBody: { required: true },
        responses: { "200": { description: "Option price result" } },
      },
    },
    "/api/status/tws-time": {
      get: {
        operationId: "getTwsCurrentTime",
        summary: "Get TWS server time.",
        responses: { "200": { description: "Current TWS time" } },
      },
    },
    "/api/data/market-rule/{ruleId}": {
      get: {
        operationId: "getMarketRule",
        summary: "Get market rule increments for a market rule ID.",
        parameters: [
          { name: "ruleId", in: "path", required: true, schema: { type: "integer" } },
        ],
        responses: { "200": { description: "Market rule details" } },
      },
    },
    "/api/data/smart-components/{exchange}": {
      get: {
        operationId: "getSmartComponents",
        summary: "Get SMART routing components by exchange.",
        parameters: [
          { name: "exchange", in: "path", required: true, schema: { type: "string" } },
        ],
        responses: { "200": { description: "Smart components" } },
      },
    },
    "/api/data/depth-exchanges": {
      get: {
        operationId: "getDepthExchanges",
        summary: "Get list of exchanges supporting market depth.",
        responses: { "200": { description: "Depth exchanges" } },
      },
    },
    "/api/data/fundamentals/{symbol}": {
      get: {
        operationId: "getFundamentalData",
        summary: "Get IBKR fundamental data XML for symbol.",
        parameters: [
          { name: "symbol", in: "path", required: true, schema: { type: "string" } },
          { name: "reportType", in: "query", schema: { type: "string" } },
        ],
        responses: { "200": { description: "Fundamental data" } },
      },
    },
    "/api/portfolio/exposure": {
      get: {
        operationId: "getPortfolioExposure",
        summary: "Compute portfolio exposure metrics: gross/net exposure, % deployed, largest position, sector breakdown, beta-weighted exposure, portfolio heat. Requires TWS/Gateway.",
        responses: {
          "200": {
            description: "Portfolio exposure analytics (or error if IBKR not connected)",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    grossExposure: { type: "number", description: "Sum of absolute values of all position market values" },
                    netExposure: { type: "number", description: "Sum of signed market values (long positive, short negative)" },
                    percentDeployed: { type: "number", description: "Gross exposure as % of net liquidation" },
                    largestPositionPercent: { type: "number", description: "Largest single position as % of net liquidation" },
                    largestPosition: { type: "string", nullable: true, description: "Symbol of largest position" },
                    sectorBreakdown: {
                      type: "object",
                      additionalProperties: { type: "number" },
                      description: "Sector allocations as % of gross exposure",
                    },
                    betaWeightedExposure: { type: "number", description: "Sum of (position value * beta) where beta is correlation with SPY" },
                    portfolioHeat: { type: "number", description: "Sum of (position size * 2x ATR) as estimated risk" },
                    positionCount: { type: "integer", description: "Number of open positions" },
                    netLiquidation: { type: "number", description: "Total account net liquidation value" },
                  },
                },
              },
            },
          },
        },
      },
    },
    "/api/account/orders": {
      get: {
        operationId: "getOpenOrders",
        summary: "Get all open orders. Shows orderId, symbol, action, type, quantity, prices, status. Requires TWS/Gateway.",
        responses: {
          "200": {
            description: "Open orders list",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    count: { type: "integer" },
                    orders: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          orderId: { type: "integer" },
                          symbol: { type: "string" },
                          secType: { type: "string" },
                          action: { type: "string" },
                          orderType: { type: "string" },
                          totalQuantity: { type: "number" },
                          lmtPrice: { type: "number", nullable: true },
                          auxPrice: { type: "number", nullable: true },
                          status: { type: "string" },
                          tif: { type: "string" },
                          account: { type: "string" },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    "/api/account/orders/completed": {
      get: {
        operationId: "getCompletedOrders",
        summary: "Get completed (filled/cancelled) orders with fill price and quantity. Requires TWS/Gateway.",
        responses: {
          "200": {
            description: "Completed orders list",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    count: { type: "integer" },
                    orders: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          orderId: { type: "integer" },
                          symbol: { type: "string" },
                          action: { type: "string" },
                          orderType: { type: "string" },
                          totalQuantity: { type: "number" },
                          filledQuantity: { type: "number" },
                          avgFillPrice: { type: "number" },
                          status: { type: "string" },
                          completedTime: { type: "string" },
                          account: { type: "string" },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    "/api/account/executions": {
      get: {
        operationId: "getExecutions",
        summary: "Get today's executions/fills with commission and realized P&L. Requires TWS/Gateway.",
        parameters: [
          { name: "symbol", in: "query", schema: { type: "string" }, description: "Filter by symbol" },
          { name: "secType", in: "query", schema: { type: "string" }, description: "Filter by security type: STK, OPT, FUT" },
          { name: "time", in: "query", schema: { type: "string" }, description: "Filter after this time: yyyymmdd hh:mm:ss" },
        ],
        responses: {
          "200": {
            description: "Executions list",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    count: { type: "integer" },
                    executions: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          execId: { type: "string" },
                          orderId: { type: "integer" },
                          symbol: { type: "string" },
                          side: { type: "string" },
                          shares: { type: "number" },
                          price: { type: "number" },
                          avgPrice: { type: "number" },
                          time: { type: "string" },
                          commission: { type: "number", nullable: true },
                          realizedPnL: { type: "number", nullable: true },
                          account: { type: "string" },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    "/api/contract/{symbol}": {
      get: {
        operationId: "getContractDetails",
        summary: "Get IBKR contract details: trading hours, exchanges, min tick, multiplier, classification. Requires TWS/Gateway.",
        parameters: [
          { name: "symbol", in: "path", required: true, schema: { type: "string" }, description: "Symbol, e.g. AAPL, ES, EUR" },
          { name: "secType", in: "query", schema: { type: "string" }, description: "Security type: STK (default), OPT, FUT, CASH" },
          { name: "exchange", in: "query", schema: { type: "string" }, description: "Exchange: SMART (default), NYSE, GLOBEX" },
          { name: "currency", in: "query", schema: { type: "string" }, description: "Currency: USD (default), EUR, GBP" },
        ],
        responses: {
          "200": {
            description: "Contract details",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    count: { type: "integer" },
                    contracts: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          conId: { type: "integer" },
                          symbol: { type: "string" },
                          secType: { type: "string" },
                          exchange: { type: "string" },
                          currency: { type: "string" },
                          longName: { type: "string" },
                          minTick: { type: "number", nullable: true },
                          multiplier: { type: "number", nullable: true },
                          validExchanges: { type: "string" },
                          tradingHours: { type: "string" },
                          liquidHours: { type: "string" },
                          industry: { type: "string", nullable: true },
                          category: { type: "string", nullable: true },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    "/api/ibkr/quote/{symbol}": {
      get: {
        operationId: "getIBKRQuote",
        summary: "Get a real-time quote snapshot from IBKR TWS (bid, ask, last, OHLC, volume). Requires TWS/Gateway + market data subscription.",
        parameters: [
          { name: "symbol", in: "path", required: true, schema: { type: "string" }, description: "Symbol, e.g. AAPL, ES, EUR" },
          { name: "secType", in: "query", schema: { type: "string" }, description: "Security type: STK (default), OPT, FUT, CASH" },
          { name: "exchange", in: "query", schema: { type: "string" }, description: "Exchange: SMART (default), NYSE, GLOBEX" },
          { name: "currency", in: "query", schema: { type: "string" }, description: "Currency: USD (default), EUR, GBP" },
        ],
        responses: {
          "200": {
            description: "IBKR quote snapshot",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    symbol: { type: "string" },
                    bid: { type: "number", nullable: true },
                    ask: { type: "number", nullable: true },
                    last: { type: "number", nullable: true },
                    open: { type: "number", nullable: true },
                    high: { type: "number", nullable: true },
                    low: { type: "number", nullable: true },
                    close: { type: "number", nullable: true },
                    volume: { type: "number", nullable: true },
                    timestamp: { type: "string" },
                  },
                },
              },
            },
          },
        },
      },
    },
    // =====================================================================
    // ORDER EXECUTION (IBKR — requires TWS/Gateway)
    // =====================================================================
    "/api/order": {
      post: {
        operationId: "placeOrder",
        summary: "Place a single order on IBKR. Supports all order types: MKT, LMT, STP, STP LMT, TRAIL, TRAIL LIMIT, REL, MIT, MOC, LOC, PEG MID, etc. Requires TWS/Gateway.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["symbol", "action", "orderType", "totalQuantity"],
                properties: {
                  symbol: { type: "string", description: "Ticker symbol, e.g. AAPL" },
                  action: { type: "string", enum: ["BUY", "SELL"], description: "BUY or SELL" },
                  orderType: { type: "string", description: "Any IBKR order type: MKT, LMT, STP, STP LMT, TRAIL, TRAIL LIMIT, REL, MIT, MOC, LOC, PEG MID, etc." },
                  totalQuantity: { type: "number", description: "Number of shares" },
                  lmtPrice: { type: "number", description: "Limit price (required for LMT, STP LMT, TRAIL LIMIT)" },
                  auxPrice: { type: "number", description: "Stop price (STP/STP LMT) or trailing amount (TRAIL)" },
                  trailingPercent: { type: "number", description: "Trailing stop as percentage (alternative to auxPrice for TRAIL)" },
                  trailStopPrice: { type: "number", description: "Initial stop price anchor for trailing orders" },
                  tif: { type: "string", description: "Time in force: DAY (default), GTC, IOC, GTD, OPG, FOK, DTC" },
                  ocaGroup: { type: "string", description: "OCA group name" },
                  ocaType: { type: "integer", description: "OCA type: 1=cancel w/ block, 2=reduce w/ block, 3=reduce non-block" },
                  parentId: { type: "integer", description: "Parent order ID for child orders" },
                  transmit: { type: "boolean", description: "Whether to transmit immediately (default true)" },
                  outsideRth: { type: "boolean", description: "Allow execution outside regular trading hours" },
                  goodAfterTime: { type: "string", description: "Start time: YYYYMMDD HH:MM:SS timezone" },
                  goodTillDate: { type: "string", description: "Expiry time: YYYYMMDD HH:MM:SS timezone" },
                  algoStrategy: { type: "string", description: "Algo: Adaptive, ArrivalPx, DarkIce, PctVol, Twap, Vwap" },
                  discretionaryAmt: { type: "number", description: "Discretionary amount for REL orders" },
                  hidden: { type: "boolean", description: "Hidden order (iceberg)" },
                  secType: { type: "string", description: "Security type: STK (default), OPT, FUT" },
                  exchange: { type: "string", description: "Exchange: SMART (default)" },
                  currency: { type: "string", description: "Currency: USD (default)" },
                  algoParams: {
                    type: "array",
                    description: "Algo-specific parameters",
                    items: {
                      type: "object",
                      required: ["tag", "value"],
                      properties: {
                        tag: { type: "string" },
                        value: { type: "string" },
                      },
                    },
                  },
                  account: { type: "string", description: "IBKR account code" },
                  hedgeType: { type: "string", description: "Hedge type: D, B, F, or P" },
                  hedgeParam: { type: "string", description: "Hedge parameter value" },
                  strategy_version: { type: "string", description: "Strategy version metadata" },
                  journal_id: { type: "integer", description: "Linked journal entry id" },
                },
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Order placement result",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    orderId: { type: "integer" },
                    symbol: { type: "string" },
                    action: { type: "string" },
                    orderType: { type: "string" },
                    totalQuantity: { type: "number" },
                    lmtPrice: { type: "number", nullable: true },
                    auxPrice: { type: "number", nullable: true },
                    status: { type: "string" },
                    correlation_id: { type: "string" },
                  },
                },
              },
            },
          },
        },
      },
    },
    "/api/order/bracket": {
      post: {
        operationId: "placeBracketOrder",
        summary: "Place a bracket order (entry + take profit + stop loss) on IBKR. Requires TWS/Gateway.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["symbol", "action", "totalQuantity", "entryType", "takeProfitPrice", "stopLossPrice"],
                properties: {
                  symbol: { type: "string", description: "Ticker symbol, e.g. AAPL" },
                  action: { type: "string", enum: ["BUY", "SELL"], description: "BUY or SELL for the entry" },
                  totalQuantity: { type: "number", description: "Number of shares" },
                  entryType: { type: "string", enum: ["MKT", "LMT"], description: "Entry order type: MKT or LMT" },
                  entryPrice: { type: "number", description: "Limit price for entry (required if entryType is LMT)" },
                  takeProfitPrice: { type: "number", description: "Take profit limit price" },
                  stopLossPrice: { type: "number", description: "Stop loss price" },
                  tif: { type: "string", description: "Time in force for entry: DAY (default). TP/SL default to GTC." },
                  secType: { type: "string", description: "Security type: STK (default)" },
                  exchange: { type: "string", description: "Exchange: SMART (default)" },
                  currency: { type: "string", description: "Currency: USD (default)" },
                  strategy_version: { type: "string" },
                  journal_id: { type: "integer" },
                },
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Bracket order placement result",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    parentOrderId: { type: "integer" },
                    takeProfitOrderId: { type: "integer" },
                    stopLossOrderId: { type: "integer" },
                    symbol: { type: "string" },
                    action: { type: "string" },
                    totalQuantity: { type: "number" },
                    entryType: { type: "string" },
                    entryPrice: { type: "number", nullable: true },
                    takeProfitPrice: { type: "number" },
                    stopLossPrice: { type: "number" },
                    status: { type: "string" },
                    correlation_id: { type: "string" },
                  },
                },
              },
            },
          },
        },
      },
    },
    "/api/order/bracket-advanced": {
      post: {
        operationId: "placeAdvancedBracket",
        summary: "Place an advanced bracket order with OCA group, trailing stop support, and full field passthrough. Entry + take-profit + stop-loss linked via OCA.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["symbol", "action", "quantity", "entry", "takeProfit", "stopLoss"],
                properties: {
                  symbol: { type: "string", description: "Ticker symbol" },
                  action: { type: "string", enum: ["BUY", "SELL"], description: "Entry direction" },
                  quantity: { type: "number", description: "Number of shares" },
                  secType: { type: "string", default: "STK" },
                  exchange: { type: "string", default: "SMART" },
                  currency: { type: "string", default: "USD" },
                  tif: { type: "string", default: "DAY", description: "Time-in-force for entry" },
                  outsideRth: { type: "boolean", description: "Allow outside regular trading hours" },
                  entry: {
                    type: "object",
                    required: ["type"],
                    properties: {
                      type: { type: "string", description: "Entry order type (MKT, LMT, etc.)" },
                      price: { type: "number", description: "Entry price when needed by the entry order type" },
                    },
                  },
                  takeProfit: {
                    type: "object",
                    required: ["type", "price"],
                    properties: {
                      type: { type: "string", default: "LMT", description: "Take-profit order type" },
                      price: { type: "number", description: "Take-profit limit price" },
                    },
                  },
                  stopLoss: {
                    type: "object",
                    required: ["type"],
                    properties: {
                      type: { type: "string", description: "Stop-loss type: STP, STP LMT, TRAIL, TRAIL LIMIT" },
                      price: { type: "number", description: "Stop price (or trail anchor for TRAIL)" },
                      lmtPrice: { type: "number", description: "Limit price for STP LMT / TRAIL LIMIT" },
                      trailingAmount: { type: "number", description: "Trailing dollar amount (TRAIL/TRAIL LIMIT)" },
                      trailingPercent: { type: "number", description: "Trailing percentage (TRAIL/TRAIL LIMIT)" },
                    },
                  },
                  strategy_version: { type: "string" },
                  journal_id: { type: "integer" },
                },
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Advanced bracket order placement result",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    parentOrderId: { type: "integer" },
                    takeProfitOrderId: { type: "integer" },
                    stopLossOrderId: { type: "integer" },
                    ocaGroup: { type: "string" },
                    symbol: { type: "string" },
                    action: { type: "string" },
                    quantity: { type: "number" },
                    entry: {
                      type: "object",
                      properties: {
                        type: { type: "string" },
                        price: { type: "number", nullable: true },
                      },
                    },
                    takeProfit: {
                      type: "object",
                      properties: {
                        type: { type: "string" },
                        price: { type: "number" },
                      },
                    },
                    stopLoss: {
                      type: "object",
                      properties: {
                        type: { type: "string" },
                        price: { type: "number" },
                        trailingAmount: { type: "number" },
                        trailingPercent: { type: "number" },
                      },
                    },
                    status: { type: "string" },
                    correlation_id: { type: "string" },
                  },
                },
              },
            },
          },
          "400": {
            description: "Validation error",
            content: { "application/json": { schema: { type: "object", properties: { error: { type: "string" }, details: { type: "array", items: { type: "string" } } } } } },
          },
        },
      },
    },
    "/api/order/{orderId}": {
      delete: {
        operationId: "cancelOrder",
        summary: "Cancel a specific open order by orderId. Requires TWS/Gateway.",
        parameters: [
          { name: "orderId", in: "path", required: true, schema: { type: "integer" }, description: "The order ID to cancel" },
        ],
        responses: {
          "200": {
            description: "Cancel result",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    orderId: { type: "integer" },
                    status: { type: "string" },
                  },
                },
              },
            },
          },
        },
      },
    },
    "/api/orders/all": {
      delete: {
        operationId: "cancelAllOrders",
        summary: "Cancel ALL open orders globally. Use with caution. Requires TWS/Gateway.",
        responses: {
          "200": {
            description: "Cancel all result",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    status: { type: "string" },
                  },
                },
              },
            },
          },
        },
      },
    },
    // =====================================================================
    // FLATTEN / EOD CLOSE-OUT
    // =====================================================================
    "/api/positions/flatten": {
      post: {
        operationId: "flattenAllPositions",
        summary: "Immediately close ALL open positions with MKT orders and cancel all open orders. EOD flatten or emergency exit.",
        responses: {
          "200": {
            description: "Flatten result with list of closed positions",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    flattened: { type: "array", items: { type: "object" } },
                    cancelled: { type: "object" },
                    skipped: { type: "array", items: { type: "string" } },
                    timestamp: { type: "string" },
                  },
                },
              },
            },
          },
        },
      },
    },
    // =====================================================================
    // SESSION GUARDRAILS
    // =====================================================================
    "/api/session": {
      get: {
        operationId: "getSessionState",
        summary: "Get current session guardrail state (P&L, trade count, lock status, and limits).",
        responses: {
          "200": {
            description: "Current session state",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  additionalProperties: true,
                },
              },
            },
          },
        },
      },
    },
    "/api/session/trade": {
      post: {
        operationId: "recordSessionTradeResult",
        summary: "Record a completed trade P&L into session guardrails.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["realized_pnl"],
                properties: {
                  realized_pnl: { type: "number", description: "Realized P&L for the completed trade" },
                },
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Updated session state",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  additionalProperties: true,
                },
              },
            },
          },
        },
      },
    },
    "/api/session/lock": {
      post: {
        operationId: "lockSession",
        summary: "Manually lock the session.",
        requestBody: {
          required: false,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  reason: { type: "string" },
                },
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Updated session state",
            content: { "application/json": { schema: { type: "object", additionalProperties: true } } },
          },
        },
      },
    },
    "/api/session/unlock": {
      post: {
        operationId: "unlockSession",
        summary: "Unlock the session.",
        responses: {
          "200": {
            description: "Updated session state",
            content: { "application/json": { schema: { type: "object", additionalProperties: true } } },
          },
        },
      },
    },
    "/api/session/reset": {
      post: {
        operationId: "resetSession",
        summary: "Reset session state.",
        responses: {
          "200": {
            description: "Updated session state",
            content: { "application/json": { schema: { type: "object", additionalProperties: true } } },
          },
        },
      },
    },
    "/api/risk/size-position": {
      post: {
        operationId: "sizePosition",
        summary: "Calculate safe position size based on account equity, risk parameters, and margin capacity. Read-only computation — does not place orders.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["symbol", "entryPrice", "stopPrice"],
                properties: {
                  symbol: { type: "string", description: "Ticker symbol, e.g. AAPL" },
                  entryPrice: { type: "number", description: "Entry price per share" },
                  stopPrice: { type: "number", description: "Stop loss price per share" },
                  riskPercent: { type: "number", description: "Max % of net liquidation to risk (default 1%)" },
                  riskAmount: { type: "number", description: "Absolute dollar risk cap (overrides riskPercent if provided)" },
                  maxCapitalPercent: { type: "number", description: "Max % of equity in this position (default 10%)" },
                },
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Position sizing calculation",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    symbol: { type: "string" },
                    recommendedShares: { type: "number", description: "Recommended share quantity (minimum of all constraints)" },
                    riskPerShare: { type: "number", description: "Risk per share (entry - stop)" },
                    totalRisk: { type: "number", description: "Total dollar risk for recommended shares" },
                    totalCapital: { type: "number", description: "Total capital required for position" },
                    percentOfEquity: { type: "number", description: "Position size as % of net liquidation" },
                    sizing: {
                      type: "object",
                      properties: {
                        byRisk: { type: "number", description: "Max shares based on risk tolerance" },
                        byCapital: { type: "number", description: "Max shares based on capital allocation" },
                        byMargin: { type: "number", description: "Max shares based on available margin" },
                        binding: { type: "string", enum: ["byRisk", "byCapital", "byMargin"], description: "Which constraint is limiting" },
                      },
                    },
                    warnings: { type: "array", items: { type: "string" }, description: "Risk warnings" },
                    netLiquidation: { type: "number", description: "Account net liquidation value" },
                  },
                },
              },
            },
          },
          "400": {
            description: "Invalid request parameters",
            content: { "application/json": { schema: { type: "object", properties: { error: { type: "string" } } } } },
          },
          "500": {
            description: "Calculation error or IBKR connection issue",
            content: { "application/json": { schema: { type: "object", properties: { error: { type: "string" } } } } },
          },
        },
      },
    },
    "/api/flatten/config": {
      get: {
        operationId: "getFlattenConfig",
        summary: "Get current EOD auto-flatten configuration (time, enabled, firedToday)",
        responses: {
          "200": {
            description: "Flatten config",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    enabled: { type: "boolean" },
                    time: { type: "string" },
                    firedToday: { type: "string" },
                  },
                },
              },
            },
          },
        },
      },
    },
    "/api/flatten/enable": {
      post: {
        operationId: "setFlattenEnabled",
        summary: "Enable or disable the EOD auto-flatten scheduler",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["enabled"],
                properties: {
                  enabled: { type: "boolean", description: "true to enable, false to disable" },
                },
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Updated flatten config",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    enabled: { type: "boolean" },
                    time: { type: "string" },
                    firedToday: { type: "string" },
                  },
                },
              },
            },
          },
        },
      },
    },
    // =====================================================================
    // COLLABORATION CHANNEL (AI-to-AI communication)
    // =====================================================================
    "/api/collab/messages": {
      get: {
        operationId: "getCollabMessages",
        summary: "Read messages from the AI collaboration channel shared between Claude and ChatGPT",
        parameters: [
          { name: "since", in: "query", schema: { type: "string", format: "date-time" }, description: "ISO timestamp — return only messages after this time" },
          { name: "author", in: "query", schema: { type: "string", enum: ["claude", "chatgpt", "user"] }, description: "Filter messages by author" },
          { name: "tag", in: "query", schema: { type: "string" }, description: "Filter messages by tag" },
          { name: "limit", in: "query", schema: { type: "integer", default: 50 }, description: "Max messages to return (default 50, max 100)" },
        ],
        responses: {
          "200": {
            description: "Collaboration messages",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    count: { type: "integer" },
                    messages: { type: "array", items: { $ref: "#/components/schemas/CollabMessage" } },
                  },
                },
              },
            },
          },
        },
      },
      delete: {
        operationId: "clearCollabMessages",
        summary: "Clear all messages from the AI collaboration channel",
        responses: {
          "200": {
            description: "Clear result",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    cleared: { type: "integer", description: "Number of messages cleared" },
                  },
                },
              },
            },
          },
        },
      },
    },
    "/api/collab/message": {
      post: {
        operationId: "postCollabMessage",
        summary: "Post a message to the AI collaboration channel. Use author 'chatgpt' when posting.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["author", "content"],
                properties: {
                  author: { type: "string", enum: ["claude", "chatgpt", "user"], description: "Who is posting — use 'chatgpt'" },
                  content: { type: "string", maxLength: 8000, description: "Message content. Can include code, analysis, questions." },
                  replyTo: { type: "string", description: "ID of a message to reply to (thread reference)" },
                  tags: { type: "array", items: { type: "string" }, description: "Tags like 'code-review', 'architecture', 'question'" },
                },
              },
            },
          },
        },
        responses: {
          "201": {
            description: "Message posted successfully",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/CollabMessage" },
              },
            },
          },
        },
      },
    },
    "/api/collab/stats": {
      get: {
        operationId: "getCollabStats",
        summary: "Get collaboration channel statistics — total messages and count by author",
        responses: {
          "200": {
            description: "Channel statistics",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    totalMessages: { type: "integer" },
                    byAuthor: { type: "object", properties: { claude: { type: "integer" }, chatgpt: { type: "integer" }, user: { type: "integer" } } },
                  },
                },
              },
            },
          },
        },
      },
    },
    "/api/journal": {
      get: {
        operationId: "getJournal",
        summary: "Query trade journal entries. Filter by symbol or strategy.",
        parameters: [
          { name: "symbol", in: "query", schema: { type: "string" }, description: "Filter by ticker symbol" },
          { name: "strategy", in: "query", schema: { type: "string" }, description: "Filter by strategy_version" },
          { name: "limit", in: "query", schema: { type: "integer" }, description: "Max entries (default 100)" },
        ],
        responses: { "200": { description: "Trade journal entries", content: { "application/json": { schema: { type: "object", properties: { count: { type: "integer" }, entries: { type: "array", items: { type: "object" } } } } } } } },
      },
      post: {
        operationId: "createJournalEntry",
        summary: "Create a trade journal entry with reasoning and market context.",
        requestBody: {
          required: true,
          content: { "application/json": { schema: { type: "object", required: ["reasoning"], properties: { symbol: { type: "string" }, strategy_version: { type: "string" }, reasoning: { type: "string" }, ai_recommendations: { type: "string" }, tags: { type: "array", items: { type: "string" } }, spy_price: { type: "number" }, vix_level: { type: "number" }, gap_pct: { type: "number" }, relative_volume: { type: "number" }, time_of_day: { type: "string" }, session_type: { type: "string" }, spread_pct: { type: "number" } } } } },
        },
        responses: { "201": { description: "Created journal entry", content: { "application/json": { schema: { type: "object" } } } } },
      },
    },
    "/api/journal/{id}": {
      get: {
        operationId: "getJournalEntryById",
        summary: "Get a specific trade journal entry by ID.",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
        responses: { "200": { description: "Journal entry", content: { "application/json": { schema: { type: "object" } } } } },
      },
      patch: {
        operationId: "updateJournalEntry",
        summary: "Update a journal entry with post-trade notes and outcome tags.",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
        requestBody: {
          content: { "application/json": { schema: { type: "object", properties: { outcome_tags: { type: "array", items: { type: "string" } }, notes: { type: "string" } } } } },
        },
        responses: { "200": { description: "Updated journal entry", content: { "application/json": { schema: { type: "object" } } } } },
      },
    },
    "/api/orders/history": {
      get: {
        operationId: "getOrdersHistory",
        summary: "Query historical orders from the local database. Filter by symbol or strategy.",
        parameters: [
          { name: "symbol", in: "query", schema: { type: "string" }, description: "Filter by ticker symbol" },
          { name: "strategy", in: "query", schema: { type: "string" }, description: "Filter by strategy_version" },
          { name: "limit", in: "query", schema: { type: "integer" }, description: "Max orders (default 100)" },
        ],
        responses: { "200": { description: "Historical orders", content: { "application/json": { schema: { type: "object", properties: { count: { type: "integer" }, orders: { type: "array", items: { type: "object" } } } } } } } },
      },
    },
    "/api/executions/history": {
      get: {
        operationId: "getExecutionsHistory",
        summary: "Query historical executions from the local database. Filter by symbol.",
        parameters: [
          { name: "symbol", in: "query", schema: { type: "string" }, description: "Filter by ticker symbol" },
          { name: "limit", in: "query", schema: { type: "integer" }, description: "Max executions (default 100)" },
        ],
        responses: { "200": { description: "Historical executions", content: { "application/json": { schema: { type: "object", properties: { count: { type: "integer" }, executions: { type: "array", items: { type: "object" } } } } } } } },
      },
    },
  },
};
