import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getStatus } from "../providers/status.js";
import {
  getQuote,
  getHistoricalBars,
  getOptionsChain,
  getOptionQuote,
  getStockDetails,
  searchSymbols,
  getNews,
  getFinancials,
  getEarnings,
  getRecommendations,
  getTrendingSymbols,
  getScreenerIds,
  runScreener,
  runScreenerWithQuotes,
} from "../providers/yahoo.js";
import { isConnected, getConnectionStatus } from "../ibkr/connection.js";
import { config } from "../config.js";
import { ibkrTool } from "./rest-proxy.js";
import { getAccountSummary, getPositions, getPnL } from "../ibkr/account.js";
import { getOpenOrders, getCompletedOrders, getExecutions, placeOrder, placeBracketOrder, placeAdvancedBracket, modifyOrder, cancelOrder, cancelAllOrders, flattenAllPositions, validateOrder } from "../ibkr/orders.js";
import { setFlattenEnabled, getFlattenConfig } from "../scheduler.js";
import { getContractDetails } from "../ibkr/contracts.js";
import { getIBKRQuote, getHistoricalTicks } from "../ibkr/marketdata.js";
import { reqHistoricalNews, reqNewsArticle, reqNewsBulletins, reqNewsProviders } from "../ibkr/news.js";
import {
  subscribeRealTimeBars, unsubscribeRealTimeBars, getRealTimeBars,
  subscribeAccountUpdates, unsubscribeAccountUpdates, getAccountSnapshot,
  getScannerParameters, listSubscriptions,
} from "../ibkr/subscriptions.js";
import {
  calculateImpliedVolatility,
  calculateOptionPrice,
  reqAutoOpenOrders,
  reqCurrentTime,
  reqFundamentalDataBySymbol,
  reqHeadTimestampBySymbol,
  reqHistogramDataBySymbol,
  reqMarketDataType,
  reqMarketRule,
  reqMatchingSymbols,
  reqMktDepthExchanges,
  reqPnLSingleBySymbol,
  reqSmartComponents,
} from "../ibkr/data.js";
import { readMessages, postMessage, clearMessages, getStats } from "../collab/store.js";
import { checkRisk, getSessionState, recordTradeResult, lockSession, unlockSession, resetSession, getRiskGateConfig } from "../ibkr/risk-gate.js";
import { runPortfolioStressTest, computePortfolioExposure } from "../ibkr/portfolio.js";
import { calculatePositionSize } from "../ibkr/risk.js";
import {
  queryOrders,
  queryExecutions,
  queryJournal,
  insertJournalEntry,
  updateJournalEntry,
  getJournalById,
  getDailySummaries,
  getTodaysTrades,
  getEvalStats,
  getEvalsForSimulation,
  getEvalOutcomes,
  insertOutcome,
  getEvaluationById,
  getReasoningForEval,
  getTraderSyncTrades,
  getTraderSyncStats,
  getWeightHistory,
  queryHollyAlerts,
  getHollyAlertStats,
  getLatestHollySymbols,
  querySignals,
  getSignalStats,
  getAutoLinkStats,
  getRecentLinks,
  getDb,
} from "../db/database.js";
import { computeDriftReport } from "../eval/drift.js";
import { getRecentDriftAlerts } from "../eval/drift-alerts.js";
import { computeEdgeReport, runWalkForward } from "../eval/edge-analytics.js";
import { importTraderSyncCSV } from "../tradersync/importer.js";
import { importHollyAlerts } from "../holly/importer.js";
import { isAutoEvalEnabled, setAutoEvalEnabled, getAutoEvalStatus } from "../holly/auto-eval.js";
import { buildProfiles, scanSymbols, getPreAlertCandidates } from "../holly/predictor.js";
import { extractRules, runBacktest, getStrategyBreakdown } from "../holly/backtester.js";
import { importHollyTradesFromFile, getHollyTradeStats, queryHollyTrades } from "../holly/trade-importer.js";
import { runExitAutopsy } from "../holly/exit-autopsy.js";
import {
  runFullOptimization, getOptimizationSummary, runPerStrategyOptimization,
  getDefaultParamSets, runTrailingStopSimulation,
} from "../holly/trailing-stop-optimizer.js";
import { computeEnsembleWithWeights } from "../eval/ensemble/scorer.js";
import { getWeights } from "../eval/ensemble/weights.js";
import { tuneRiskParams } from "../eval/risk-tuning.js";
import { getMetrics, getRecentIncidents } from "../ops/metrics.js";
import { checkDriftAlerts } from "../eval/drift-alerts.js";
import { upsertRiskConfig } from "../db/database.js";
import { RISK_CONFIG_DEFAULTS, type RiskConfigParam } from "../db/schema.js";
import type { ModelEvaluation } from "../eval/models/types.js";
import { logger } from "../logging.js";
import { updateMcpSessionActivity } from "../db/database.js";

const log = logger.child({ subsystem: "mcp" });

// Wrap MCP tool handlers with structured error handling
type ToolHandler<T = any> = (params: T) => Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }>;

function withErrorHandling<T = any>(toolName: string, handler: ToolHandler<T>): ToolHandler<T> {
  return async (params: T) => {
    try {
      const result = await handler(params);
      return result;
    } catch (e: any) {
      log.error({ tool: toolName, params, error: e.message, stack: e.stack }, "MCP tool error");
      return {
        content: [{ type: "text", text: `Error in ${toolName}: ${e.message}` }],
        isError: true,
      };
    }
  };
}

export function createMcpServer(): McpServer {
  const server = new McpServer({
    name: "market-data-bridge",
    version: "2.0.0",
  });

  // --- Tool: debug_runtime --- Proves what THIS process is actually using
  server.tool(
    "debug_runtime",
    "Returns runtime diagnostics: PID, env vars, clientId, connection state. Use to prove which process is serving tools.",
    {},
    async () => {
      const conn = getConnectionStatus();
      return {
        content: [{ type: "text", text: JSON.stringify({
          pid: process.pid,
          ppid: process.ppid,
          mode: process.argv.includes("--mode")
            ? process.argv[process.argv.indexOf("--mode") + 1] : "unknown",
          clientId: conn.clientId,
          reconnectAttempts: conn.reconnectAttempts,
          host: conn.host,
          port: conn.port,
          connected: conn.connected,
          accountMode: conn.mode,
          uptime_s: Math.round(process.uptime()),
          started: new Date(Date.now() - process.uptime() * 1000).toISOString(),
        }, null, 2) }],
      };
    }
  );

  // --- Tool: get_status ---
  server.tool(
    "get_status",
    "Get bridge status. Returns easternTime, marketSession (pre-market/regular/after-hours/closed), and IBKR connection state. Call this FIRST before any query.",
    {},
    withErrorHandling("get_status", async () => ({
      content: [{ type: "text", text: JSON.stringify(getStatus(), null, 2) }],
    }))
  );

  // --- Tool: get_quote --- Smart: IBKR real-time first, Yahoo fallback
  server.tool(
    "get_quote",
    "Get a quote for a stock, ETF, or index. Uses IBKR real-time data when TWS is connected, falls back to Yahoo Finance.",
    {
      symbol: z.string().describe("Ticker symbol, e.g. AAPL, MSFT, SPY"),
    },
    async ({ symbol }) => {
      try {
        // Try IBKR first if connected
        if (isConnected()) {
          try {
            const ibkrQuote = await getIBKRQuote({ symbol });
            if (ibkrQuote.last !== null || ibkrQuote.bid !== null) {
              return { content: [{ type: "text", text: JSON.stringify({ ...ibkrQuote, source: "ibkr" }, null, 2) }] };
            }
          } catch {
            // IBKR failed — fall through to Yahoo
          }
        }
        const quote = await getQuote(symbol);
        return { content: [{ type: "text", text: JSON.stringify({ ...quote, source: "yahoo" }, null, 2) }] };
      } catch (e: any) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
      }
    }
  );

  // --- Tool: get_historical_bars ---
  server.tool(
    "get_historical_bars",
    "Get historical OHLCV bars for a stock. Returns an array of candles.",
    {
      symbol: z.string().describe("Ticker symbol, e.g. AAPL"),
      period: z
        .string()
        .optional()
        .describe('Time period: "1d","5d","1mo","3mo","6mo","1y","2y","5y","10y","ytd","max" (default: "3mo")'),
      interval: z
        .string()
        .optional()
        .describe('Bar interval: "1m","5m","15m","1h","1d","1wk","1mo" (default: "1d")'),
    },
    async ({ symbol, period, interval }) => {
      try {
        const bars = await getHistoricalBars(symbol, period, interval);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ symbol: symbol.toUpperCase(), count: bars.length, bars }, null, 2),
            },
          ],
        };
      } catch (e: any) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
      }
    }
  );

  // --- Tool: get_historical_ticks ---
  server.tool(
    "get_historical_ticks",
    "Get IBKR historical tick-by-tick data (trades, bid/ask, or midpoint). Requires IBKR connection.",
    {
      symbol: z.string().describe("Ticker symbol, e.g. AAPL"),
      startTime: z.string().describe("Start datetime in IBKR format, e.g. 20240201 09:30:00 US/Eastern"),
      endTime: z.string().describe("End datetime in IBKR format, e.g. 20240201 10:00:00 US/Eastern"),
      type: z.enum(["TRADES", "BID_ASK", "MIDPOINT"]).default("TRADES"),
      count: z.number().int().min(1).max(1000).default(1000),
    },
    async ({ symbol, startTime, endTime, type, count }) => ibkrTool(
      "get_historical_ticks",
      async () => {
        const ticks = await getHistoricalTicks(symbol.toUpperCase(), startTime, endTime, type, count);
        return { symbol: symbol.toUpperCase(), startTime, endTime, type, count: ticks.length, ticks, source: "ibkr" };
      },
      { symbol, startTime, endTime, type, count },
    )
  );

  // --- Tool: get_stock_details ---
  server.tool(
    "get_stock_details",
    "Get detailed company info: sector, industry, description, market cap, PE ratio, 52-week range",
    {
      symbol: z.string().describe("Ticker symbol, e.g. AAPL"),
    },
    async ({ symbol }) => {
      try {
        const details = await getStockDetails(symbol);
        return { content: [{ type: "text", text: JSON.stringify(details, null, 2) }] };
      } catch (e: any) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
      }
    }
  );

  // --- Tool: get_options_chain ---
  server.tool(
    "get_options_chain",
    "Get option expirations, strikes, and full chain data (calls + puts with bid/ask/IV/OI) for a stock",
    {
      symbol: z.string().describe("Underlying stock symbol, e.g. AAPL"),
      expiration: z.string().optional().describe("Filter to specific expiration in YYYYMMDD format"),
    },
    async ({ symbol, expiration }) => {
      try {
        const chain = await getOptionsChain(symbol, expiration);
        return { content: [{ type: "text", text: JSON.stringify(chain, null, 2) }] };
      } catch (e: any) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
      }
    }
  );

  // --- Tool: get_option_quote ---
  server.tool(
    "get_option_quote",
    "Get quote for a specific option contract",
    {
      symbol: z.string().describe("Underlying stock symbol, e.g. AAPL"),
      expiry: z.string().describe("Expiration date in YYYYMMDD format, e.g. 20260320"),
      strike: z.number().describe("Strike price, e.g. 220"),
      right: z.enum(["C", "P"]).describe("C for call, P for put"),
    },
    async ({ symbol, expiry, strike, right }) => {
      try {
        const quote = await getOptionQuote(symbol, expiry, strike, right);
        return { content: [{ type: "text", text: JSON.stringify(quote, null, 2) }] };
      } catch (e: any) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
      }
    }
  );

  // --- Tool: search_symbols ---
  server.tool(
    "search_symbols",
    "Search for stocks, ETFs, indices by name or partial symbol (e.g. 'Apple' or 'AA')",
    {
      query: z.string().describe("Search query — partial symbol or company name"),
    },
    async ({ query }) => {
      try {
        const results = await searchSymbols(query);
        return {
          content: [
            { type: "text", text: JSON.stringify({ count: results.length, results }, null, 2) },
          ],
        };
      } catch (e: any) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
      }
    }
  );

  // --- Tool: get_news ---
  server.tool(
    "get_news",
    "Get recent news articles for a stock ticker or search query",
    {
      query: z.string().describe("Ticker symbol or search query for news"),
    },
    async ({ query }) => {
      try {
        const news = await getNews(query);
        return {
          content: [
            { type: "text", text: JSON.stringify({ count: news.length, articles: news }, null, 2) },
          ],
        };
      } catch (e: any) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
      }
    }
  );

  // --- Tool: get_financials ---
  server.tool(
    "get_financials",
    "Get financial data: revenue, margins, debt, analyst targets, recommendation",
    {
      symbol: z.string().describe("Ticker symbol, e.g. AAPL"),
    },
    async ({ symbol }) => {
      try {
        const data = await getFinancials(symbol);
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      } catch (e: any) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
      }
    }
  );

  // --- Tool: get_earnings ---
  server.tool(
    "get_earnings",
    "Get earnings history (actual vs estimate) and annual/quarterly financial charts",
    {
      symbol: z.string().describe("Ticker symbol, e.g. AAPL"),
    },
    async ({ symbol }) => {
      try {
        const data = await getEarnings(symbol);
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      } catch (e: any) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
      }
    }
  );

  // --- Tool: get_recommendations ---
  server.tool(
    "get_recommendations",
    "Get Yahoo analyst recommendation trend counts (strong buy/buy/hold/sell/strong sell) by period",
    {
      symbol: z.string().describe("Ticker symbol, e.g. AAPL"),
    },
    async ({ symbol }) => {
      try {
        const data = await getRecommendations(symbol);
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      } catch (e: any) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
      }
    }
  );

  // --- Tool: get_trending ---
  server.tool(
    "get_trending",
    "Get currently trending stock symbols",
    {
      region: z.string().optional().describe('Country code: "US" (default), "GB", "JP", "CA", etc.'),
    },
    async ({ region }) => {
      try {
        const data = await getTrendingSymbols(region);
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      } catch (e: any) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
      }
    }
  );

  // --- Tool: get_screener_filters ---
  server.tool(
    "get_screener_filters",
    "Get available stock screener IDs and their descriptions",
    {},
    async () => ({
      content: [{ type: "text", text: JSON.stringify(getScreenerIds(), null, 2) }],
    })
  );

  // --- Tool: run_screener ---
  server.tool(
    "run_screener",
    "Run a stock screener. Returns ranked list of stocks matching criteria. Use for top gainers, losers, most active, etc.",
    {
      screener_id: z
        .string()
        .optional()
        .describe(
          'Screener: "day_gainers" (default), "day_losers", "most_actives", "small_cap_gainers", "undervalued_large_caps", "aggressive_small_caps", "growth_technology_stocks"'
        ),
      count: z.number().optional().describe("Number of results (default: 20)"),
    },
    async ({ screener_id, count }) => {
      try {
        const results = await runScreener(screener_id, count);
        return {
          content: [
            { type: "text", text: JSON.stringify({ count: results.length, results }, null, 2) },
          ],
        };
      } catch (e: any) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
      }
    }
  );

  // --- Tool: run_screener_with_quotes ---
  server.tool(
    "run_screener_with_quotes",
    "Run a stock screener with full quote data (bid/ask/OHLC/sector/industry/PE). More detail than run_screener.",
    {
      screener_id: z
        .string()
        .optional()
        .describe(
          'Screener: "day_gainers" (default), "day_losers", "most_actives", "small_cap_gainers", "undervalued_large_caps", "aggressive_small_caps", "growth_technology_stocks"'
        ),
      count: z.number().optional().describe("Number of results (default: 20)"),
    },
    async ({ screener_id, count }) => {
      try {
        const results = await runScreenerWithQuotes(screener_id, count);
        return {
          content: [
            { type: "text", text: JSON.stringify({ count: results.length, results }, null, 2) },
          ],
        };
      } catch (e: any) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
      }
    }
  );

  // --- Tool: get_account_summary (IBKR — requires TWS/Gateway) ---
  server.tool(
    "get_account_summary",
    "Get IBKR account summary: net liquidation, cash, buying power, margin. Requires TWS/Gateway.",
    {},
    async () => ibkrTool("get_account_summary", () => getAccountSummary())
  );

  // --- Tool: get_positions (IBKR — requires TWS/Gateway) ---
  server.tool(
    "get_positions",
    "Get all current IBKR positions with symbol, quantity, and average cost. Requires TWS/Gateway.",
    {},
    async () => ibkrTool("get_positions", async () => {
      const positions = await getPositions();
      return { count: positions.length, positions };
    })
  );

  // --- Tool: get_pnl (IBKR — requires TWS/Gateway) ---
  server.tool(
    "get_pnl",
    "Get daily profit and loss (daily PnL, unrealized PnL, realized PnL). Requires TWS/Gateway.",
    {},
    async () => ibkrTool("get_pnl", () => getPnL())
  );

  // --- Tool: get_news_providers (IBKR — requires TWS/Gateway) ---
  server.tool(
    "get_news_providers",
    "Get IBKR news providers. Returns provider codes used for historical/news article lookups.",
    {},
    async () => ibkrTool("get_news_providers", async () => {
      const providers = await reqNewsProviders();
      return { count: providers.length, providers };
    })
  );

  // --- Tool: get_news_article (IBKR — requires TWS/Gateway) ---
  server.tool(
    "get_news_article",
    "Get a full IBKR news article by provider code and article ID.",
    {
      providerCode: z.string().describe("News provider code, e.g. BRFG"),
      articleId: z.string().describe("Article ID from historical news results"),
    },
    async ({ providerCode, articleId }) => ibkrTool(
      "get_news_article", () => reqNewsArticle(providerCode, articleId),
      { providerCode, articleId },
    )
  );

  // --- Tool: get_historical_news (IBKR — requires TWS/Gateway) ---
  server.tool(
    "get_historical_news",
    "Get IBKR historical news headlines for a symbol and provider codes.",
    {
      symbol: z.string().describe("Ticker symbol, e.g. AAPL"),
      providerCodes: z.string().describe("Provider codes separated by '+', e.g. BRFG+BRFUPDN"),
      startDateTime: z.string().describe("Start datetime in IBKR format, e.g. 20240101-00:00:00"),
      endDateTime: z.string().describe("End datetime in IBKR format, e.g. 20240131-23:59:59"),
      secType: z.string().optional().describe("Security type (default STK)"),
      exchange: z.string().optional().describe("Exchange (default SMART)"),
      currency: z.string().optional().describe("Currency (default USD)"),
    },
    async ({ symbol, providerCodes, startDateTime, endDateTime, secType, exchange, currency }) => ibkrTool(
      "get_historical_news",
      async () => {
        const [contract] = await getContractDetails({ symbol, secType, exchange, currency });
        if (!contract) throw new Error(`No contract found for symbol ${symbol}`);
        const headlines = await reqHistoricalNews(contract.conId, providerCodes, startDateTime, endDateTime);
        return { symbol: symbol.toUpperCase(), conId: contract.conId, count: headlines.length, headlines };
      },
      { symbol, providerCodes, startDateTime, endDateTime, secType, exchange, currency },
    )
  );

  // --- Tool: get_news_bulletins (IBKR — requires TWS/Gateway) ---
  server.tool(
    "get_news_bulletins",
    "Subscribe to IBKR news bulletins for 3 seconds, then unsubscribe and return collected bulletins.",
    {},
    async () => ibkrTool("get_news_bulletins", async () => {
      const bulletins = await reqNewsBulletins();
      return { count: bulletins.length, bulletins };
    })
  );

  // =====================================================================
  // STREAMING SUBSCRIPTIONS (src/ibkr/subscriptions.ts)
  // =====================================================================

  server.tool(
    "subscribe_real_time_bars",
    "Subscribe to IBKR 5-second real-time bars. Returns subscription ID. Poll with get_real_time_bars. Max ~50 concurrent.",
    {
      symbol: z.string().describe("Ticker symbol, e.g. AAPL"),
      secType: z.string().optional().describe("Security type: STK, FUT, OPT (default: STK)"),
      exchange: z.string().optional().describe("Exchange (default: SMART)"),
      currency: z.string().optional().describe("Currency (default: USD)"),
      whatToShow: z.string().optional().describe("TRADES, MIDPOINT, BID, ASK (default: TRADES)"),
      useRTH: z.boolean().optional().describe("Regular trading hours only (default: true)"),
    },
    async (params) => ibkrTool("subscribe_real_time_bars", () => Promise.resolve(subscribeRealTimeBars(params)), params)
  );

  server.tool(
    "unsubscribe_real_time_bars",
    "Cancel a real-time bars subscription by ID.",
    { subscriptionId: z.string().describe("Subscription ID from subscribe_real_time_bars") },
    async ({ subscriptionId }) => {
      const removed = unsubscribeRealTimeBars(subscriptionId);
      return { content: [{ type: "text", text: JSON.stringify({ removed }) }] };
    }
  );

  server.tool(
    "get_real_time_bars",
    "Get buffered real-time bars for an active subscription (up to 300 = 25 min of 5s bars).",
    {
      subscriptionId: z.string().describe("Subscription ID"),
      limit: z.number().int().min(1).max(300).optional().describe("Max bars to return (default: 60)"),
    },
    async ({ subscriptionId, limit }) => {
      try {
        const bars = getRealTimeBars(subscriptionId, limit ?? 60);
        return { content: [{ type: "text", text: JSON.stringify({ count: bars.length, bars }, null, 2) }] };
      } catch (e: any) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
      }
    }
  );

  server.tool(
    "subscribe_account_updates",
    "Subscribe to real-time account value and portfolio updates. One account at a time (IBKR limit). Poll with get_account_snapshot.",
    { account: z.string().describe("Account code, e.g. DUA482209") },
    async ({ account }) => ibkrTool("subscribe_account_updates", () => Promise.resolve(subscribeAccountUpdates(account)), { account })
  );

  server.tool(
    "unsubscribe_account_updates",
    "Cancel the account updates subscription.",
    {},
    async () => {
      const removed = unsubscribeAccountUpdates();
      return { content: [{ type: "text", text: JSON.stringify({ removed }) }] };
    }
  );

  server.tool(
    "get_account_snapshot",
    "Get latest account values and portfolio from active account updates subscription.",
    {},
    async () => {
      const snapshot = getAccountSnapshot();
      if (!snapshot) return { content: [{ type: "text", text: JSON.stringify({ error: "No active account subscription" }) }] };
      return { content: [{ type: "text", text: JSON.stringify(snapshot, null, 2) }] };
    }
  );

  server.tool(
    "get_scanner_parameters",
    "Get IBKR scanner parameters XML (cached 60 min). Lists available scan codes, instruments, locations.",
    {},
    async () => ibkrTool("get_scanner_parameters", async () => {
      const xml = await getScannerParameters();
      return xml.slice(0, 50000);
    })
  );

  server.tool(
    "list_subscriptions",
    "List all active streaming subscriptions (real-time bars, account updates).",
    {},
    async () => {
      const subs = listSubscriptions();
      return { content: [{ type: "text", text: JSON.stringify({ count: subs.length, subscriptions: subs }, null, 2) }] };
    }
  );

  // =====================================================================
  // IBKR DATA WRAPPERS (13 methods from src/ibkr/data.ts)
  // =====================================================================

  server.tool(
    "get_pnl_single",
    "Get position-level daily PnL for one symbol using reqPnLSingle.",
    { symbol: z.string().describe("Ticker symbol") },
    async ({ symbol }) => ibkrTool("get_pnl_single", async () => ({ data: await reqPnLSingleBySymbol(symbol) }), { symbol })
  );

  server.tool(
    "search_ibkr_symbols",
    "Search symbols from IBKR contract database using reqMatchingSymbols.",
    { query: z.string().min(1).describe("Search pattern") },
    async ({ query }) => ibkrTool("search_ibkr_symbols", async () => {
      const results = await reqMatchingSymbols(query);
      return { data: { count: results.length, results } };
    }, { query })
  );

  server.tool(
    "set_market_data_type",
    "Set market data mode: 1=live, 2=frozen, 3=delayed, 4=delayed-frozen.",
    { marketDataType: z.number().int().min(1).max(4) },
    async ({ marketDataType }) => ibkrTool("set_market_data_type", async () => ({ data: await reqMarketDataType(marketDataType) }), { marketDataType })
  );

  server.tool(
    "set_auto_open_orders",
    "Enable or disable automatic open order binding for clientId 0.",
    { autoBind: z.boolean() },
    async ({ autoBind }) => ibkrTool("set_auto_open_orders", async () => ({ data: await reqAutoOpenOrders(autoBind) }), { autoBind })
  );

  server.tool(
    "get_head_timestamp",
    "Get earliest available timestamp for historical data for a symbol.",
    {
      symbol: z.string(),
      whatToShow: z.enum(["TRADES", "MIDPOINT", "BID", "ASK"]).optional(),
      useRTH: z.boolean().optional(),
      formatDate: z.union([z.literal(1), z.literal(2)]).optional(),
    },
    async ({ symbol, whatToShow, useRTH, formatDate }) => ibkrTool("get_head_timestamp", async () => ({
      data: await reqHeadTimestampBySymbol({ symbol, whatToShow: whatToShow ?? "TRADES", useRTH: useRTH ?? true, formatDate: formatDate ?? 1 }),
    }), { symbol, whatToShow, useRTH, formatDate })
  );

  server.tool(
    "get_histogram_data",
    "Get histogram data distribution for a symbol.",
    {
      symbol: z.string(),
      useRTH: z.boolean().optional(),
      period: z.number().int().positive().optional(),
      periodUnit: z.enum(["S", "D", "W", "M", "Y"]).optional(),
    },
    async ({ symbol, useRTH, period, periodUnit }) => ibkrTool("get_histogram_data", async () => ({
      data: await reqHistogramDataBySymbol({ symbol, useRTH: useRTH ?? true, period: period ?? 3, periodUnit: periodUnit ?? "D" }),
    }), { symbol, useRTH, period, periodUnit })
  );

  server.tool(
    "calculate_implied_volatility",
    "Calculate implied volatility for an option contract.",
    {
      symbol: z.string(),
      expiry: z.string().regex(/^\d{8}$/),
      strike: z.number().positive(),
      right: z.enum(["C", "P"]),
      optionPrice: z.number().positive(),
      underlyingPrice: z.number().positive(),
    },
    async (input) => ibkrTool("calculate_implied_volatility", async () => ({ data: await calculateImpliedVolatility(input) }), input)
  );

  server.tool(
    "calculate_option_price",
    "Calculate option theoretical price from volatility and underlying price.",
    {
      symbol: z.string(),
      expiry: z.string().regex(/^\d{8}$/),
      strike: z.number().positive(),
      right: z.enum(["C", "P"]),
      volatility: z.number().positive(),
      underlyingPrice: z.number().positive(),
    },
    async (input) => ibkrTool("calculate_option_price", async () => ({ data: await calculateOptionPrice(input) }), input)
  );

  server.tool(
    "get_tws_current_time",
    "Get current TWS server time.",
    {},
    async () => ibkrTool("get_tws_current_time", async () => ({ data: await reqCurrentTime() }))
  );

  server.tool(
    "get_market_rule",
    "Get market rule increments by rule id.",
    { ruleId: z.number().int().positive() },
    async ({ ruleId }) => ibkrTool("get_market_rule", async () => ({ data: await reqMarketRule(ruleId) }), { ruleId })
  );

  server.tool(
    "get_smart_components",
    "Get SMART routing component map for an exchange.",
    { exchange: z.string().min(1) },
    async ({ exchange }) => ibkrTool("get_smart_components", async () => ({ data: await reqSmartComponents(exchange.toUpperCase()) }), { exchange })
  );

  server.tool(
    "get_depth_exchanges",
    "Get list of available market depth exchanges.",
    {},
    async () => ibkrTool("get_depth_exchanges", async () => ({ data: await reqMktDepthExchanges() }))
  );

  server.tool(
    "get_fundamental_data",
    "Get IBKR fundamental data XML report for a symbol.",
    { symbol: z.string(), reportType: z.string().optional() },
    async ({ symbol, reportType }) => ibkrTool("get_fundamental_data", async () => ({
      data: await reqFundamentalDataBySymbol({ symbol, reportType: reportType ?? "ReportSnapshot" }),
    }), { symbol, reportType })
  );

  // --- Tool: stress_test (IBKR — requires TWS/Gateway) ---
  server.tool(
    "stress_test",
    "Run a portfolio stress test using open positions and account net liquidation. Supports optional beta-adjusted shocks.",
    {
      shockPercent: z.number().describe("Shock percentage to apply (e.g. -5 for a 5% down shock)"),
      betaAdjusted: z.boolean().optional().describe("When true, scales each symbol shock by its beta vs SPY"),
    },
    async ({ shockPercent, betaAdjusted }) => ibkrTool("stress_test",
      () => runPortfolioStressTest(shockPercent, betaAdjusted ?? true), { shockPercent, betaAdjusted })
  );

  // --- Tool: portfolio_exposure (IBKR — requires TWS/Gateway) ---
  server.tool(
    "portfolio_exposure",
    "Compute portfolio exposure analytics: gross/net exposure, % deployed, largest position, sector breakdown, beta-weighted exposure, portfolio heat. Requires TWS/Gateway.",
    {},
    async () => ibkrTool("portfolio_exposure", () => computePortfolioExposure())
  );

  // --- Tool: get_open_orders (IBKR — requires TWS/Gateway) ---
  server.tool(
    "get_open_orders",
    "Get all open orders across all clients. Shows orderId, symbol, action, type, quantity, limit/stop price, status, TIF.",
    {},
    async () => ibkrTool("get_open_orders", async () => {
      const orders = await getOpenOrders();
      return { count: orders.length, orders };
    })
  );

  // --- Tool: get_completed_orders (IBKR — requires TWS/Gateway) ---
  server.tool(
    "get_completed_orders",
    "Get completed (filled/cancelled) orders. Shows fill price, quantity, status, completion time.",
    {},
    async () => ibkrTool("get_completed_orders", async () => {
      const orders = await getCompletedOrders();
      return { count: orders.length, orders };
    })
  );

  // --- Tool: get_executions (IBKR — requires TWS/Gateway) ---
  server.tool(
    "get_executions",
    "Get today's executions/fills with commission and realized P&L. Optionally filter by symbol, secType, or time.",
    {
      symbol: z.string().optional().describe("Filter by symbol, e.g. AAPL"),
      secType: z.string().optional().describe("Filter by security type: STK, OPT, FUT, etc."),
      time: z.string().optional().describe("Filter executions after this time: yyyymmdd hh:mm:ss"),
    },
    async ({ symbol, secType, time }) => ibkrTool("get_executions", async () => {
      const filter = symbol || secType || time ? { symbol, secType, time } : undefined;
      const executions = await getExecutions(filter);
      return { count: executions.length, executions };
    }, { symbol, secType, time })
  );

  // --- Tool: get_contract_details (IBKR — requires TWS/Gateway) ---
  server.tool(
    "get_contract_details",
    "Get IBKR contract details: trading hours, valid exchanges, min tick, multiplier, industry classification.",
    {
      symbol: z.string().describe("Symbol, e.g. AAPL, ES, EUR"),
      secType: z.string().optional().describe("Security type: STK (default), OPT, FUT, CASH, etc."),
      exchange: z.string().optional().describe("Exchange: SMART (default), NYSE, GLOBEX, etc."),
      currency: z.string().optional().describe("Currency: USD (default), EUR, GBP, etc."),
    },
    async ({ symbol, secType, exchange, currency }) => ibkrTool("get_contract_details", async () => {
      const details = await getContractDetails({ symbol, secType, exchange, currency });
      return { count: details.length, contracts: details };
    }, { symbol, secType, exchange, currency })
  );

  // --- Tool: get_ibkr_quote (IBKR — requires TWS/Gateway) ---
  server.tool(
    "get_ibkr_quote",
    "Get a real-time quote snapshot directly from IBKR TWS (bid, ask, last, OHLC, volume). Requires market data subscription.",
    {
      symbol: z.string().describe("Symbol, e.g. AAPL, ES, EUR"),
      secType: z.string().optional().describe("Security type: STK (default), OPT, FUT, CASH, etc."),
      exchange: z.string().optional().describe("Exchange: SMART (default), NYSE, GLOBEX, etc."),
      currency: z.string().optional().describe("Currency: USD (default), EUR, GBP, etc."),
    },
    async ({ symbol, secType, exchange, currency }) => ibkrTool("get_ibkr_quote",
      () => getIBKRQuote({ symbol, secType, exchange, currency }), { symbol, secType, exchange, currency })
  );

  // --- Tool: place_order (IBKR — requires TWS/Gateway) ---
  server.tool(
    "place_order",
    "Place a single order on IBKR. Supports all order types: MKT, LMT, STP, STP LMT, TRAIL, TRAIL LIMIT, REL, MIT, MOC, LOC, PEG MID, and more. Requires TWS/Gateway.",
    {
      symbol: z.string().describe("Ticker symbol, e.g. AAPL"),
      action: z.enum(["BUY", "SELL"]).describe("BUY or SELL"),
      orderType: z.string().describe("Order type: MKT, LMT, STP, STP LMT, TRAIL, TRAIL LIMIT, REL, MIT, MOC, LOC, PEG MID, etc."),
      totalQuantity: z.number().describe("Number of shares"),
      lmtPrice: z.number().optional().describe("Limit price (required for LMT, STP LMT, TRAIL LIMIT)"),
      auxPrice: z.number().optional().describe("Stop price (STP/STP LMT) or trailing amount (TRAIL)"),
      trailingPercent: z.number().optional().describe("Trailing stop as percentage (alternative to auxPrice for TRAIL)"),
      trailStopPrice: z.number().optional().describe("Initial stop price anchor for trailing orders"),
      tif: z.string().optional().describe("Time in force: DAY (default), GTC, IOC, GTD, OPG, FOK, DTC"),
      ocaGroup: z.string().optional().describe("OCA group name (links orders that cancel each other)"),
      ocaType: z.number().optional().describe("OCA type: 1=cancel w/ block, 2=reduce w/ block, 3=reduce non-block"),
      parentId: z.number().optional().describe("Parent order ID for child orders"),
      transmit: z.boolean().optional().describe("Whether to transmit immediately (default true)"),
      outsideRth: z.boolean().optional().describe("Allow execution outside regular trading hours"),
      goodAfterTime: z.string().optional().describe("Start time: YYYYMMDD HH:MM:SS timezone"),
      goodTillDate: z.string().optional().describe("Expiry time: YYYYMMDD HH:MM:SS timezone"),
      algoStrategy: z.string().optional().describe("Algo strategy: Adaptive, ArrivalPx, DarkIce, PctVol, Twap, Vwap"),
      discretionaryAmt: z.number().optional().describe("Discretionary amount for REL orders"),
      secType: z.string().optional().describe("Security type: STK (default), OPT, FUT"),
      exchange: z.string().optional().describe("Exchange: SMART (default)"),
      currency: z.string().optional().describe("Currency: USD (default)"),
      eval_id: z.string().optional().describe("Evaluation ID to link this order to (for auto-link tracking)"),
    },
    async (params) => ibkrTool(
      "place_order",
      async () => {
        const validation = validateOrder(params as any);
        if (!validation.valid) throw new Error(validation.errors.join("; "));
        const riskResult = checkRisk(params);
        if (!riskResult.allowed) throw new Error(`Risk gate rejected: ${riskResult.reason}`);
        return placeOrder({ ...params, order_source: "mcp" });
      },
      params as Record<string, unknown>,
    )
  );

  // --- Tool: place_bracket_order (IBKR — requires TWS/Gateway) ---
  server.tool(
    "place_bracket_order",
    "Place a bracket order (entry + take profit + stop loss) on IBKR. Requires TWS/Gateway.",
    {
      symbol: z.string().describe("Ticker symbol, e.g. AAPL"),
      action: z.enum(["BUY", "SELL"]).describe("BUY or SELL for the entry"),
      totalQuantity: z.number().describe("Number of shares"),
      entryType: z.enum(["MKT", "LMT"]).describe("Entry order type: MKT or LMT"),
      entryPrice: z.number().optional().describe("Limit price for entry (required if entryType is LMT)"),
      takeProfitPrice: z.number().describe("Take profit limit price"),
      stopLossPrice: z.number().describe("Stop loss price"),
      tif: z.string().optional().describe("Time in force for entry: DAY (default). TP/SL default to GTC."),
      secType: z.string().optional().describe("Security type: STK (default)"),
      exchange: z.string().optional().describe("Exchange: SMART (default)"),
      currency: z.string().optional().describe("Currency: USD (default)"),
      eval_id: z.string().optional().describe("Evaluation ID to link this order to"),
    },
    async (params) => ibkrTool(
      "place_bracket_order",
      async () => {
        const riskResult = checkRisk({ symbol: params.symbol, action: params.action, orderType: params.entryType, totalQuantity: params.totalQuantity, lmtPrice: params.entryPrice, secType: params.secType });
        if (!riskResult.allowed) throw new Error(`Risk gate rejected: ${riskResult.reason}`);
        return placeBracketOrder({ ...params, order_source: "mcp" });
      },
      params as Record<string, unknown>,
    )
  );

  // --- Tool: place_advanced_bracket (IBKR — requires TWS/Gateway) ---
  server.tool(
    "place_advanced_bracket",
    "Place an advanced bracket order with OCA group, trailing stop support, and any order types. Entry + Take Profit + Stop Loss (STP, TRAIL, TRAIL LIMIT, STP LMT). Requires TWS/Gateway.",
    {
      symbol: z.string().describe("Ticker symbol, e.g. AAPL"),
      action: z.enum(["BUY", "SELL"]).describe("BUY or SELL for the entry"),
      quantity: z.number().describe("Number of shares"),
      entry: z.object({
        type: z.string().describe("Entry order type: MKT, LMT, etc."),
        price: z.number().optional().describe("Limit price (required for LMT)"),
      }).describe("Entry order config"),
      takeProfit: z.object({
        type: z.string().describe("TP order type: LMT (typical)"),
        price: z.number().describe("Take profit price"),
      }).describe("Take profit config"),
      stopLoss: z.object({
        type: z.string().describe("SL order type: STP, TRAIL, TRAIL LIMIT, STP LMT"),
        price: z.number().optional().describe("Stop price (or initial anchor for TRAIL)"),
        trailingAmount: z.number().optional().describe("Trailing amount in dollars (for TRAIL)"),
        trailingPercent: z.number().optional().describe("Trailing percent (for TRAIL, alternative to trailingAmount)"),
        lmtPrice: z.number().optional().describe("Limit price for TRAIL LIMIT or STP LMT"),
      }).describe("Stop loss config"),
      tif: z.string().optional().describe("Time in force for entry: DAY (default). TP/SL default to GTC."),
      outsideRth: z.boolean().optional().describe("Allow execution outside regular trading hours"),
      secType: z.string().optional().describe("Security type: STK (default)"),
      exchange: z.string().optional().describe("Exchange: SMART (default)"),
      currency: z.string().optional().describe("Currency: USD (default)"),
      eval_id: z.string().optional().describe("Evaluation ID to link this order to"),
    },
    async (params) => ibkrTool(
      "place_advanced_bracket",
      async () => {
        const riskResult = checkRisk({ symbol: params.symbol, action: params.action, orderType: params.entry.type, totalQuantity: params.quantity, lmtPrice: params.entry.price, secType: params.secType });
        if (!riskResult.allowed) throw new Error(`Risk gate rejected: ${riskResult.reason}`);
        return placeAdvancedBracket({ ...params, order_source: "mcp" });
      },
      params as Record<string, unknown>,
    )
  );

  // --- Tool: modify_order (IBKR — requires TWS/Gateway) ---
  server.tool(
    "modify_order",
    "Modify an existing open order IN-PLACE (preserves bracket/OCA links). Use this instead of cancel+re-place to edit a bracket leg's price or quantity. Requires TWS/Gateway.",
    {
      orderId: z.number().describe("The order ID to modify (must be an open/working order)"),
      lmtPrice: z.number().optional().describe("New limit price"),
      auxPrice: z.number().optional().describe("New stop/trigger price"),
      totalQuantity: z.number().optional().describe("New total quantity"),
      orderType: z.string().optional().describe("New order type (e.g. STP → STP LMT)"),
      tif: z.string().optional().describe("New time-in-force (DAY, GTC, IOC, etc.)"),
      trailingPercent: z.number().optional().describe("New trailing stop percentage"),
      trailStopPrice: z.number().optional().describe("New trail stop price anchor"),
    },
    async (params) => ibkrTool("modify_order", () => modifyOrder(params), params as Record<string, unknown>)
  );

  // --- Tool: cancel_order (IBKR — requires TWS/Gateway) ---
  server.tool(
    "cancel_order",
    "Cancel a specific open order by orderId. Requires TWS/Gateway.",
    {
      orderId: z.number().describe("The order ID to cancel"),
    },
    async ({ orderId: id }) => ibkrTool("cancel_order", () => cancelOrder(id), { orderId: id })
  );

  // --- Tool: cancel_all_orders (IBKR — requires TWS/Gateway) ---
  server.tool(
    "cancel_all_orders",
    "Cancel ALL open orders globally. Use with caution. Requires TWS/Gateway.",
    {},
    async () => ibkrTool("cancel_all_orders", () => cancelAllOrders())
  );

  // --- Tool: flatten_positions (EOD close-out) ---
  server.tool(
    "flatten_positions",
    "Immediately close ALL open positions with MKT orders and cancel all open orders. Use for EOD flatten or emergency exit.",
    {},
    async () => ibkrTool("flatten_positions", () => flattenAllPositions())
  );

  // --- Tool: flatten_config (view/toggle auto-flatten) ---
  server.tool(
    "flatten_config",
    "Get or set the EOD auto-flatten configuration. Returns current time/enabled state. Pass enabled=true/false to toggle.",
    {
      enabled: z.boolean().optional().describe("Set to true to enable auto-flatten, false to disable"),
    },
    async ({ enabled }) => {
      if (typeof enabled === "boolean") {
        setFlattenEnabled(enabled);
      }
      return { content: [{ type: "text", text: JSON.stringify(getFlattenConfig(), null, 2) }] };
    }
  );

  // =====================================================================
  // COLLABORATION CHANNEL TOOLS (AI-to-AI communication)
  // =====================================================================

  server.tool(
    "collab_read",
    "Read messages from the AI collaboration channel. Use this to see what ChatGPT or the user has posted. Returns most recent messages by default.",
    {
      since: z.string().optional().describe("ISO timestamp — return only messages posted after this time"),
      author: z.enum(["claude", "chatgpt", "user"]).optional().describe("Filter by author"),
      tag: z.string().optional().describe("Filter by tag (e.g. 'code-review', 'architecture')"),
      limit: z.number().optional().describe("Max messages to return (default 50, max 100)"),
    },
    async ({ since, author, tag, limit }) => {
      try {
        const msgs = readMessages({ since, author, tag, limit });
        return { content: [{ type: "text" as const, text: JSON.stringify({ count: msgs.length, messages: msgs }, null, 2) }] };
      } catch (e: any) {
        return { content: [{ type: "text" as const, text: `Error: ${e.message}` }], isError: true };
      }
    }
  );

  server.tool(
    "collab_post",
    "Post a message to the AI collaboration channel. Use this to share analysis, code suggestions, or responses to ChatGPT. Your author is always 'claude'.",
    {
      content: z.string().describe("The message content (max 8000 chars). Can include code blocks, analysis, questions."),
      replyTo: z.string().optional().describe("ID of a message to reply to (creates a thread reference)"),
      tags: z.array(z.string()).optional().describe("Tags for the message, e.g. ['code-review', 'architecture', 'question']"),
    },
    async ({ content, replyTo, tags }) => {
      try {
        const msg = postMessage({ author: "claude", content, replyTo, tags });
        return { content: [{ type: "text" as const, text: JSON.stringify(msg, null, 2) }] };
      } catch (e: any) {
        return { content: [{ type: "text" as const, text: `Error: ${e.message}` }], isError: true };
      }
    }
  );

  server.tool(
    "collab_clear",
    "Clear all messages from the AI collaboration channel. Use when starting a new topic or conversation.",
    {},
    async () => {
      try {
        const result = clearMessages();
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (e: any) {
        return { content: [{ type: "text" as const, text: `Error: ${e.message}` }], isError: true };
      }
    }
  );

  server.tool(
    "collab_stats",
    "Get statistics for the AI collaboration channel — total messages and count by author.",
    {},
    async () => ({
      content: [{ type: "text" as const, text: JSON.stringify(getStats(), null, 2) }],
    })
  );

  // =====================================================================
  // SESSION GUARDRAILS
  // =====================================================================

  server.tool(
    "session_state",
    "Get current trading session state: daily P&L, trade count, consecutive losses, cooldown status, and all session limits. Check this before placing trades.",
    {},
    async () => {
      try {
        const state = getSessionState();
        return { content: [{ type: "text", text: JSON.stringify(state, null, 2) }] };
      } catch (e: any) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
      }
    }
  );

  server.tool(
    "session_record_trade",
    "Record a completed trade result to update session guardrails. Feed this after every trade closes.",
    {
      realized_pnl: z.number().describe("P&L of the completed trade (positive = win, negative = loss)"),
    },
    async (params) => {
      try {
        recordTradeResult(params.realized_pnl);
        return { content: [{ type: "text", text: JSON.stringify(getSessionState(), null, 2) }] };
      } catch (e: any) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
      }
    }
  );

  server.tool(
    "session_lock",
    "Manually lock the session to prevent any new trades. Use when tilting or stepping away.",
    {
      reason: z.string().optional().describe("Why you're locking (e.g., 'tilting', 'lunch break', 'done for day')"),
    },
    async (params) => {
      try {
        lockSession(params.reason);
        return { content: [{ type: "text", text: JSON.stringify(getSessionState(), null, 2) }] };
      } catch (e: any) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
      }
    }
  );

  server.tool(
    "session_unlock",
    "Unlock a manually locked session to resume trading.",
    {},
    async () => {
      try {
        unlockSession();
        return { content: [{ type: "text", text: JSON.stringify(getSessionState(), null, 2) }] };
      } catch (e: any) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
      }
    }
  );

  server.tool(
    "session_reset",
    "Reset session state. Use at start of day or after a break to clear all counters.",
    {},
    async () => {
      try {
        resetSession();
        return { content: [{ type: "text", text: JSON.stringify(getSessionState(), null, 2) }] };
      } catch (e: any) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
      }
    }
  );

  server.tool(
    "get_risk_config",
    "Get persisted and effective risk configuration values used by the risk gate.",
    {},
    async () => {
      try {
        return {
          content: [{ type: "text", text: JSON.stringify(getRiskGateConfig(), null, 2) }],
        };
      } catch (e: any) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
      }
    }
  );

  server.tool(
    "tune_risk_params",
    "Auto-tune risk parameters from the last 100 outcomes using half-Kelly sizing and store them in risk_config.",
    {},
    async () => {
      try {
        const tune = tuneRiskParams();
        return {
          content: [{ type: "text", text: JSON.stringify({ tune, config: getRiskGateConfig() }, null, 2) }],
        };
      } catch (e: any) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
      }
    }
  );

  server.tool(
    "size_position",
    "Calculate safe position size based on account equity, risk parameters, and margin capacity. Read-only computation — does not place orders.",
    {
      symbol: z.string().describe("Ticker symbol, e.g. AAPL, MSFT"),
      entryPrice: z.number().positive().describe("Entry price per share"),
      stopPrice: z.number().nonnegative().describe("Stop loss price per share"),
      riskPercent: z.number().positive().max(100).optional().describe("Max % of net liquidation to risk (default 1%)"),
      riskAmount: z.number().positive().optional().describe("Absolute dollar risk cap (overrides riskPercent if provided)"),
      maxCapitalPercent: z.number().positive().max(100).optional().describe("Max % of equity in this position (default 10%)"),
      volatilityRegime: z.enum(["low", "normal", "high"]).optional().describe("Current volatility regime — scales position down in high vol (default: normal)"),
    },
    async (params) => ibkrTool("size_position", () => calculatePositionSize(params), params as Record<string, unknown>)
  );

  // =====================================================================
  // TRADE JOURNAL + HISTORY (from SQLite)
  // =====================================================================

  server.tool(
    "trade_journal_read",
    "Query trade journal entries. Filter by symbol or strategy.",
    {
      symbol: z.string().optional().describe("Filter by symbol"),
      strategy: z.string().optional().describe("Filter by strategy_version"),
      limit: z.number().optional().describe("Max entries to return (default 100)"),
    },
    async (params) => {
      try {
        const entries = queryJournal(params);
        return { content: [{ type: "text", text: JSON.stringify({ count: (entries as any[]).length, entries }, null, 2) }] };
      } catch (e: any) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
      }
    }
  );

  server.tool(
    "trade_journal_write",
    "Add or update a trade journal entry. To create, provide 'reasoning'. To update, provide 'id' with outcome_tags/notes.",
    {
      id: z.number().optional().describe("Journal entry ID (for updates only)"),
      symbol: z.string().optional().describe("Ticker symbol"),
      strategy_version: z.string().optional().describe("Strategy version identifier"),
      reasoning: z.string().optional().describe("Trade reasoning (required for new entries)"),
      ai_recommendations: z.string().optional().describe("AI-generated recommendations"),
      tags: z.array(z.string()).optional().describe("Categorization tags"),
      outcome_tags: z.array(z.string()).optional().describe("Post-trade outcome tags (for updates)"),
      notes: z.string().optional().describe("Post-trade notes (for updates)"),
      confidence_rating: z.number().min(1).max(3).optional().describe("Trader confidence: 1=low, 2=medium, 3=high"),
      rule_followed: z.boolean().optional().describe("Did trader follow their own rules?"),
      setup_type: z.string().optional().describe("Setup type: breakout, pullback, reversal, gap_fill, momentum"),
      spy_price: z.number().optional().describe("SPY price at entry"),
      vix_level: z.number().optional().describe("VIX level at entry"),
    },
    async (params) => {
      try {
        if (params.id) {
          // Update existing entry
          updateJournalEntry(params.id, { outcome_tags: params.outcome_tags, notes: params.notes });
          const entry = getJournalById(params.id);
          return { content: [{ type: "text", text: JSON.stringify(entry, null, 2) }] };
        } else {
          // Create new entry
          if (!params.reasoning) {
            return { content: [{ type: "text", text: JSON.stringify({ error: "reasoning is required for new entries" }, null, 2) }] };
          }
          const id = insertJournalEntry(params as any);
          const entry = getJournalById(id);
          return { content: [{ type: "text", text: JSON.stringify(entry, null, 2) }] };
        }
      } catch (e: any) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
      }
    }
  );

  server.tool(
    "orders_history",
    "Query historical orders from the local database. Filter by symbol or strategy.",
    {
      symbol: z.string().optional().describe("Filter by symbol"),
      strategy: z.string().optional().describe("Filter by strategy_version"),
      limit: z.number().optional().describe("Max orders to return (default 100)"),
    },
    async (params) => {
      try {
        const orders = queryOrders(params);
        return { content: [{ type: "text", text: JSON.stringify({ count: (orders as any[]).length, orders }, null, 2) }] };
      } catch (e: any) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
      }
    }
  );

  server.tool(
    "executions_history",
    "Query historical executions from the local database. Filter by symbol.",
    {
      symbol: z.string().optional().describe("Filter by symbol"),
      limit: z.number().optional().describe("Max executions to return (default 100)"),
    },
    async (params) => {
      try {
        const executions = queryExecutions(params);
        return { content: [{ type: "text", text: JSON.stringify({ count: (executions as any[]).length, executions }, null, 2) }] };
      } catch (e: any) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
      }
    }
  );

  // --- Tool: daily_summary ---
  server.tool(
    "daily_summary",
    "Get daily session summaries — P&L, win rate, avg R, best/worst R per day. Query params: date (single day, e.g. '2026-02-13') or days (last N days, e.g. 30). Returns sessions array + rolling totals.",
    {
      date: z.string().optional().describe("Single date filter (YYYY-MM-DD)"),
      days: z.number().optional().describe("Last N days to include (default: all)"),
    },
    async (params) => {
      try {
        const summaries = getDailySummaries({
          date: params.date,
          days: params.days,
        });

        const trades = params.date ? getTodaysTrades() : undefined;

        let totalTrades = 0, totalWins = 0, totalLosses = 0, totalR = 0;
        for (const s of summaries) {
          totalTrades += s.total_trades;
          totalWins += s.wins;
          totalLosses += s.losses;
          totalR += s.total_r ?? 0;
        }

        const result = {
          sessions: summaries,
          ...(trades ? { trades } : {}),
          rolling: {
            total_trades: totalTrades,
            wins: totalWins,
            losses: totalLosses,
            win_rate: totalTrades > 0 ? totalWins / totalTrades : null,
            avg_r: totalTrades > 0 ? totalR / totalTrades : null,
            total_r: totalR,
            days_with_trades: summaries.length,
          },
        };

        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (e: any) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
      }
    }
  );

  // --- Tool: eval_stats ---
  server.tool(
    "eval_stats",
    "Get model performance statistics — total evaluations, average scores, win rate, model accuracy. Includes per-model breakdown.",
    {},
    async () => {
      try {
        const stats = getEvalStats();
        return { content: [{ type: "text", text: JSON.stringify(stats, null, 2) }] };
      } catch (e: any) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
      }
    }
  );

  // --- Tool: simulate_weights ---
  server.tool(
    "simulate_weights",
    "Re-score historical evaluations with custom weights. Shows comparison: current vs simulated avg score, trade rate, accuracy. Use to answer 'what if I weighted claude higher?' before committing.",
    {
      claude: z.number().describe("Weight for Claude model (e.g. 0.5)"),
      gpt4o: z.number().describe("Weight for GPT-4o model (e.g. 0.3)"),
      gemini: z.number().describe("Weight for Gemini model (e.g. 0.2)"),
      k: z.number().optional().describe("Disagreement penalty factor (default: current)"),
      days: z.number().optional().describe("Historical window in days (default: 90)"),
      symbol: z.string().optional().describe("Filter to specific symbol"),
    },
    async (params) => {
      try {
        if (params.claude < 0 || params.gpt4o < 0 || params.gemini < 0) {
          return { content: [{ type: "text", text: "Error: Weights must be non-negative" }], isError: true };
        }
        const weightSum = params.claude + params.gpt4o + params.gemini;
        if (weightSum <= 0) {
          return { content: [{ type: "text", text: "Error: At least one weight must be > 0" }], isError: true };
        }

        const currentWeights = getWeights();
        const simWeights = {
          claude: params.claude,
          gpt4o: params.gpt4o,
          gemini: params.gemini,
          k: params.k ?? currentWeights.k,
        };

        const rawEvals = getEvalsForSimulation({
          days: params.days ?? 90,
          symbol: params.symbol,
        });

        if (rawEvals.length === 0) {
          return { content: [{ type: "text", text: JSON.stringify({ message: "No evaluations found for simulation", simulated_weights: simWeights }, null, 2) }] };
        }

        let currentTradeCount = 0, simTradeCount = 0;
        let currentScoreSum = 0, simScoreSum = 0;
        let currentCorrect = 0, simCorrect = 0;
        let outcomesWithTrades = 0;
        let changedDecisions = 0;

        for (const row of rawEvals) {
          const modelEvals: ModelEvaluation[] = row.model_outputs.map((mo) => ({
            model_id: mo.model_id as ModelEvaluation["model_id"],
            output: mo.compliant && mo.trade_score != null ? {
              trade_score: mo.trade_score,
              extension_risk: 0, exhaustion_risk: 0, float_rotation_risk: 0, market_alignment: 0,
              expected_rr: mo.expected_rr ?? 0,
              confidence: mo.confidence ?? 0,
              should_trade: mo.should_trade === 1,
              reasoning: "",
            } : null,
            raw_response: "", latency_ms: 0, error: null,
            compliant: mo.compliant === 1,
            model_version: "", prompt_hash: "", token_count: 0, api_response_id: "",
            timestamp: row.timestamp,
          }));

          const currentResult = computeEnsembleWithWeights(modelEvals, {
            claude: currentWeights.claude, gpt4o: currentWeights.gpt4o, gemini: currentWeights.gemini, k: currentWeights.k,
          });
          const simResult = computeEnsembleWithWeights(modelEvals, simWeights);

          currentScoreSum += currentResult.trade_score;
          simScoreSum += simResult.trade_score;
          if (currentResult.should_trade) currentTradeCount++;
          if (simResult.should_trade) simTradeCount++;
          if (currentResult.should_trade !== simResult.should_trade) changedDecisions++;

          if (row.trade_taken === 1 && row.r_multiple != null) {
            outcomesWithTrades++;
            const isWin = row.r_multiple > 0;
            if ((currentResult.should_trade && isWin) || (!currentResult.should_trade && !isWin)) currentCorrect++;
            if ((simResult.should_trade && isWin) || (!simResult.should_trade && !isWin)) simCorrect++;
          }
        }

        const n = rawEvals.length;
        const result = {
          simulated_weights: simWeights,
          current_weights: { claude: currentWeights.claude, gpt4o: currentWeights.gpt4o, gemini: currentWeights.gemini, k: currentWeights.k },
          evaluations_count: n,
          outcomes_with_trades: outcomesWithTrades,
          comparison: {
            current: {
              avg_score: Math.round((currentScoreSum / n) * 100) / 100,
              trade_rate: Math.round((currentTradeCount / n) * 1000) / 1000,
              accuracy: outcomesWithTrades > 0 ? Math.round((currentCorrect / outcomesWithTrades) * 1000) / 1000 : null,
            },
            simulated: {
              avg_score: Math.round((simScoreSum / n) * 100) / 100,
              trade_rate: Math.round((simTradeCount / n) * 1000) / 1000,
              accuracy: outcomesWithTrades > 0 ? Math.round((simCorrect / outcomesWithTrades) * 1000) / 1000 : null,
            },
            delta: {
              avg_score: Math.round(((simScoreSum - currentScoreSum) / n) * 100) / 100,
              trade_rate: Math.round(((simTradeCount - currentTradeCount) / n) * 1000) / 1000,
              accuracy: outcomesWithTrades > 0 ? Math.round(((simCorrect - currentCorrect) / outcomesWithTrades) * 1000) / 1000 : null,
              decisions_changed: changedDecisions,
              decisions_changed_pct: Math.round((changedDecisions / n) * 1000) / 1000,
            },
          },
        };

        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (e: any) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
      }
    }
  );

  // --- Tool: weight_history ---
  server.tool(
    "weight_history",
    "Get history of ensemble weight changes. Shows timestamp, weights, sample size, and reason (manual/recalibration/simulation) for each update. Use to track weight evolution and audit recalibrations.",
    {
      limit: z.number().optional().describe("Max records to return (default: 100, max: 500)"),
    },
    async (params) => {
      try {
        const limit = params.limit ?? 100;
        const history = getWeightHistory(Math.min(limit, 500));
        
        // Parse weights_json for each record
        const parsed = history.map((row) => ({
          id: row.id,
          weights: JSON.parse(row.weights_json),
          sample_size: row.sample_size,
          reason: row.reason,
          created_at: row.created_at,
        }));

        return { content: [{ type: "text", text: JSON.stringify({ count: parsed.length, history: parsed }, null, 2) }] };
      } catch (e: any) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
      }
    }
  );

  // --- Tool: eval_outcomes ---
  server.tool(
    "eval_outcomes",
    "Get evaluations joined with their trade outcomes. Core data for calibration curves, regime analysis, and scatter plots. Returns ensemble scores + R-multiples + regime metadata.",
    {
      limit: z.number().optional().describe("Max rows (default 500, max 2000)"),
      symbol: z.string().optional().describe("Filter by symbol"),
      days: z.number().optional().describe("Last N days"),
      all: z.boolean().optional().describe("Include non-traded outcomes (default: trades only)"),
    },
    async (params) => {
      try {
        const outcomes = getEvalOutcomes({
          limit: params.limit,
          symbol: params.symbol,
          days: params.days,
          tradesTakenOnly: !params.all,
        });
        return { content: [{ type: "text", text: JSON.stringify({ count: outcomes.length, outcomes }, null, 2) }] };
      } catch (e: any) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
      }
    }
  );

  // --- Tool: record_outcome ---
  server.tool(
    "record_outcome",
    "Record a trade outcome for an evaluation. Tag behavioral fields (confidence, rule_followed, setup_type) alongside the outcome for edge analytics. Supports passed setups as negative examples (decision_type='passed_setup').",
    {
      evaluation_id: z.string().describe("Evaluation ID to record outcome for"),
      trade_taken: z.boolean().optional().describe("Whether the trade was executed (default: false)"),
      decision_type: z.enum(["took_trade", "passed_setup", "ensemble_no", "risk_gate_blocked"]).optional()
        .describe("Why this outcome exists: took_trade (executed), passed_setup (saw it, chose not to), ensemble_no (model said no), risk_gate_blocked"),
      confidence_rating: z.number().min(1).max(3).optional().describe("Trader confidence: 1=low, 2=medium, 3=high"),
      rule_followed: z.boolean().optional().describe("Did trader follow their own rules?"),
      setup_type: z.string().optional().describe("Setup type: breakout, pullback, reversal, gap_fill, momentum"),
      actual_entry_price: z.number().optional().describe("Actual entry price"),
      actual_exit_price: z.number().optional().describe("Actual exit price"),
      r_multiple: z.number().optional().describe("Risk-reward outcome (positive = win)"),
      exit_reason: z.string().optional().describe("Why the trade was exited"),
      notes: z.string().optional().describe("Post-trade notes"),
    },
    async (params) => {
      try {
        const existing = getEvaluationById(params.evaluation_id);
        if (!existing) {
          return { content: [{ type: "text", text: JSON.stringify({ error: `Evaluation ${params.evaluation_id} not found` }) }], isError: true };
        }

        insertOutcome({
          evaluation_id: params.evaluation_id,
          trade_taken: params.trade_taken ? 1 : 0,
          decision_type: params.decision_type ?? null,
          confidence_rating: params.confidence_rating ?? null,
          rule_followed: params.rule_followed != null ? (params.rule_followed ? 1 : 0) : null,
          setup_type: params.setup_type ?? null,
          actual_entry_price: params.actual_entry_price ?? null,
          actual_exit_price: params.actual_exit_price ?? null,
          r_multiple: params.r_multiple ?? null,
          exit_reason: params.exit_reason ?? null,
          notes: params.notes ?? null,
          recorded_at: new Date().toISOString(),
        });

        return { content: [{ type: "text", text: JSON.stringify({ success: true, evaluation_id: params.evaluation_id, decision_type: params.decision_type ?? "took_trade" }, null, 2) }] };
      } catch (e: any) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
      }
    }
  );

  // --- Tool: eval_reasoning ---
  server.tool(
    "eval_reasoning",
    "Get structured reasoning for an evaluation. Returns per-model key_drivers (which features drove the decision), risk_factors, uncertainties, and conviction level. Use for drift detection and disagreement diagnosis.",
    {
      evalId: z.string().optional().describe("Evaluation ID"),
      evaluation_id: z.string().optional().describe("Legacy alias for evaluation ID"),
    },
    async (params) => {
      try {
        const evalId = params.evalId ?? params.evaluation_id;
        if (!evalId) {
          return { content: [{ type: "text", text: JSON.stringify({ error: "evalId is required" }) }], isError: true };
        }

        const evaluation = getEvaluationById(evalId);
        if (!evaluation) {
          return { content: [{ type: "text", text: JSON.stringify({ error: `Evaluation ${evalId} not found` }) }], isError: true };
        }

        const rows = getReasoningForEval(evalId);
        const models: Record<string, unknown> = {};
        for (const row of rows) {
          models[row.model_id as string] = {
            key_drivers: JSON.parse(row.key_drivers as string),
            risk_factors: JSON.parse(row.risk_factors as string),
            uncertainties: JSON.parse(row.uncertainties as string),
            conviction: row.conviction,
          };
        }
        return { content: [{ type: "text", text: JSON.stringify({ evaluation_id: evalId, models }, null, 2) }] };
      } catch (e: any) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
      }
    }
  );

  // --- Tool: drift_report ---
  server.tool(
    "drift_report",
    "Generate a drift report with rolling model accuracy (last 50/20/10), calibration error by score decile, and regime-shift detection.",
    {},
    async () => {
      try {
        const report = computeDriftReport();
        return { content: [{ type: "text", text: JSON.stringify(report, null, 2) }] };
      } catch (e: any) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
      }
    }
  );

  // --- Tool: drift_alerts ---
  server.tool(
    "drift_alerts",
    "Get recent drift alerts that were triggered when model accuracy or calibration metrics fell below configured thresholds. Returns alert history with type, model, metric values, and timestamps.",
    {
      limit: z.number().int().positive().optional().describe("Number of recent alerts to return (default: 50)"),
    },
    async ({ limit }) => {
      try {
        const alerts = getRecentDriftAlerts(limit ?? 50);
        return { content: [{ type: "text", text: JSON.stringify({ count: alerts.length, alerts }, null, 2) }] };
      } catch (e: any) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
      }
    }
  );

  // --- Tool: edge_report ---
  server.tool(
    "edge_report",
    "Full edge analytics report: rolling Sharpe/Sortino, win rate, profit factor, max drawdown, expectancy, composite edge score, feature attribution (which features predict winners), and optional walk-forward validation (proves out-of-sample edge vs luck).",
    {
      days: z.number().int().positive().optional().describe("Lookback period in days (default: 90)"),
      rolling_window: z.number().int().positive().optional().describe("Rolling window size in trades (default: 20)"),
      include_walk_forward: z.boolean().optional().describe("Include walk-forward validation (default: true, slower)"),
    },
    async (params) => {
      try {
        const report = computeEdgeReport({
          days: params.days,
          rollingWindow: params.rolling_window,
          includeWalkForward: params.include_walk_forward,
        });
        return { content: [{ type: "text", text: JSON.stringify(report, null, 2) }] };
      } catch (e: any) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
      }
    }
  );

  // --- Tool: walk_forward ---
  server.tool(
    "walk_forward",
    "Walk-forward backtest: slides a train/test window across historical evaluations with outcomes, optimizes ensemble weights on train window via grid search, tests on out-of-sample window. Reports per-window win rate, avg R, Sharpe, and aggregate edge stability / decay detection.",
    {
      days: z.number().int().positive().optional().describe("Lookback period in days (default: 180)"),
      train_size: z.number().int().positive().optional().describe("Training window size in trades (default: 30)"),
      test_size: z.number().int().positive().optional().describe("Test window size in trades (default: 10)"),
    },
    async (params) => {
      try {
        const result = runWalkForward({
          days: params.days,
          trainSize: params.train_size,
          testSize: params.test_size,
        });
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (e: any) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
      }
    }
  );

  // --- Tool: tradersync_import ---
  server.tool(
    "tradersync_import",
    "Import TraderSync trade_data CSV content into the database. Pass the full CSV content as a string. Returns batch ID, inserted count, skipped duplicates, and any parse errors.",
    {
      csv: z.string().describe("Full CSV content from TraderSync trade_data export"),
    },
    async (params) => {
      try {
        const result = importTraderSyncCSV(params.csv);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (e: any) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
      }
    }
  );

  // --- Tool: tradersync_stats ---
  server.tool(
    "tradersync_stats",
    "Get aggregate stats from imported TraderSync trades: total trades, win rate, avg R, total P&L, unique symbols, date range.",
    {},
    async () => {
      try {
        const stats = getTraderSyncStats();
        return { content: [{ type: "text", text: JSON.stringify(stats, null, 2) }] };
      } catch (e: any) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
      }
    }
  );

  // --- Tool: tradersync_trades ---
  server.tool(
    "tradersync_trades",
    "Query imported TraderSync trades. Filter by symbol, side (LONG/SHORT), status (WIN/LOSS), and lookback days.",
    {
      symbol: z.string().optional().describe("Filter by ticker symbol"),
      side: z.enum(["LONG", "SHORT"]).optional().describe("Filter by trade side"),
      status: z.enum(["WIN", "LOSS"]).optional().describe("Filter by outcome"),
      days: z.number().optional().describe("Lookback period in days"),
      limit: z.number().optional().default(100).describe("Max results (default: 100)"),
    },
    async (params) => {
      try {
        const trades = getTraderSyncTrades({
          symbol: params.symbol,
          side: params.side,
          status: params.status,
          days: params.days,
          limit: params.limit,
        });
        return { content: [{ type: "text", text: JSON.stringify({ count: trades.length, trades }, null, 2) }] };
      } catch (e: any) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
      }
    }
  );

  // --- Tool: holly_import ---
  server.tool(
    "holly_import",
    "Import Trade Ideas Holly AI alert CSV content into the database. Pass the full CSV content as a string. Auto-detects columns from the header row.",
    {
      csv: z.string().describe("Full CSV content from Trade Ideas Holly AI alert export"),
    },
    async (params) => {
      try {
        const result = importHollyAlerts(params.csv);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (e: any) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
      }
    }
  );

  // --- Tool: holly_alerts ---
  server.tool(
    "holly_alerts",
    "Query imported Holly AI alerts with optional filters. Returns alerts sorted by most recent first.",
    {
      symbol: z.string().optional().describe("Filter by ticker symbol"),
      strategy: z.string().optional().describe("Filter by Holly strategy name"),
      since: z.string().optional().describe("Only alerts after this timestamp"),
      limit: z.number().optional().default(100).describe("Max results (default: 100)"),
    },
    async (params) => {
      const alerts = queryHollyAlerts(params);
      return { content: [{ type: "text", text: JSON.stringify({ count: alerts.length, alerts }, null, 2) }] };
    }
  );

  // --- Tool: holly_stats ---
  server.tool(
    "holly_stats",
    "Get aggregate statistics from imported Holly AI alerts — total alerts, unique symbols, strategies, date range.",
    {},
    async () => {
      const stats = getHollyAlertStats();
      return { content: [{ type: "text", text: JSON.stringify(stats, null, 2) }] };
    }
  );

  // --- Tool: holly_symbols ---
  server.tool(
    "holly_symbols",
    "Get the most recent distinct symbols from Holly AI alerts. Useful for feeding into ensemble scoring or watchlist.",
    {
      limit: z.number().optional().default(20).describe("Max symbols to return (default: 20)"),
    },
    async (params) => {
      const symbols = getLatestHollySymbols(params.limit);
      return { content: [{ type: "text", text: JSON.stringify({ count: symbols.length, symbols }, null, 2) }] };
    }
  );

  // --- Tool: holly_predictor_status ---
  server.tool(
    "holly_predictor_status",
    "Get Holly pre-alert predictor status: how many strategy profiles are built, what strategies, and total historical alert count used for learning.",
    {},
    async () => {
      const db = getDb();
      const profiles = buildProfiles(db);
      return { content: [{ type: "text", text: JSON.stringify({ profiles_built: profiles.length, strategies: [...new Set(profiles.map(p => p.strategy))] }, null, 2) }] };
    }
  );

  // --- Tool: holly_predictor_scan ---
  server.tool(
    "holly_predictor_scan",
    "Scan a symbol against learned Holly feature profiles. Returns z-score match quality.",
    {
      symbol: z.string().describe("Symbol to scan (e.g. AAPL)"),
    },
    async (params) => {
      const db = getDb();
      const profiles = buildProfiles(db);
      const results = scanSymbols([{ symbol: params.symbol } as any], profiles);
      return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
    }
  );

  // --- Tool: holly_predictor_candidates ---
  server.tool(
    "holly_predictor_candidates",
    "Get top pre-alert candidates — symbols most likely to trigger Holly AI alerts soon.",
    {
      limit: z.number().optional().default(10).describe("Max candidates to return"),
      hours_back: z.number().optional().default(24).describe("Look back N hours for unevaluated alerts"),
    },
    async (params) => {
      const db = getDb();
      const profiles = buildProfiles(db);
      const result = getPreAlertCandidates(db, profiles, params.limit, params.hours_back);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  // --- Tool: holly_predictor_refresh ---
  server.tool(
    "holly_predictor_refresh",
    "Rebuild Holly predictor profiles from latest data.",
    {
      min_samples: z.number().optional().default(20).describe("Minimum samples per strategy"),
    },
    async (params) => {
      const db = getDb();
      const profiles = buildProfiles(db, params.min_samples);
      return { content: [{ type: "text", text: JSON.stringify({ profiles_built: profiles.length }, null, 2) }] };
    }
  );

  // --- Tool: holly_extract_rules ---
  server.tool(
    "holly_extract_rules",
    "Reverse-engineer Holly alert trigger conditions using Cohen's d effect size analysis.",
    {
      min_samples: z.number().optional().default(10).describe("Minimum alerts per strategy"),
      min_cohens_d: z.number().optional().default(0.2).describe("Minimum Cohen's d separation"),
    },
    async (params) => {
      const db = getDb();
      const rules = extractRules(db, params.min_samples, params.min_cohens_d);
      return { content: [{ type: "text", text: JSON.stringify({ total_rules: rules.length, rules }, null, 2) }] };
    }
  );

  // --- Tool: holly_backtest ---
  server.tool(
    "holly_backtest",
    "Backtest extracted Holly rules: precision, win rate, Sharpe, P&L.",
    {
      win_threshold: z.number().optional().default(60).describe("Min score to count as win prediction"),
    },
    async (params) => {
      const db = getDb();
      const rules = extractRules(db);
      const report = runBacktest(db, rules, params.win_threshold);
      return { content: [{ type: "text", text: JSON.stringify(report, null, 2) }] };
    }
  );

  // --- Tool: holly_strategy_breakdown ---
  server.tool(
    "holly_strategy_breakdown",
    "Quick breakdown of each Holly strategy: features, separation, outcome P&L.",
    {},
    async () => {
      const result = getStrategyBreakdown(getDb());
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  // --- Tool: holly_trade_import_file ---
  server.tool(
    "holly_trade_import_file",
    "Import Holly trades from a Trade Ideas CSV export file on disk. Parses the non-standard format, computes derived metrics (hold time, MFE, MAE, giveback, R-multiple), and stores in holly_trades table.",
    {
      file_path: z.string().describe("Absolute path to the Trade Ideas Holly CSV export"),
    },
    async (params) => {
      const result = importHollyTradesFromFile(params.file_path);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  // --- Tool: holly_trade_stats ---
  server.tool(
    "holly_trade_stats",
    "Get aggregate statistics from imported Holly trades: total trades, win rate, avg R, avg giveback, avg hold time, total P&L.",
    {},
    async () => {
      const stats = getHollyTradeStats();
      return { content: [{ type: "text", text: JSON.stringify(stats, null, 2) }] };
    }
  );

  // --- Tool: holly_trades ---
  server.tool(
    "holly_trades",
    "Query Holly historical trades with full MFE/MAE/giveback metrics. Filter by symbol, strategy, segment, date range.",
    {
      symbol: z.string().optional().describe("Filter by symbol"),
      strategy: z.string().optional().describe("Filter by strategy name"),
      segment: z.string().optional().describe("Filter by segment (Holly Grail, Holly Neo, etc.)"),
      since: z.string().optional().describe("Start date (ISO)"),
      until: z.string().optional().describe("End date (ISO)"),
      limit: z.number().optional().default(100).describe("Max trades (default: 100, max: 1000)"),
    },
    async (params) => {
      const trades = queryHollyTrades({
        symbol: params.symbol,
        strategy: params.strategy,
        segment: params.segment,
        since: params.since,
        until: params.until,
        limit: params.limit,
      });
      return { content: [{ type: "text", text: JSON.stringify({ count: trades.length, trades }, null, 2) }] };
    }
  );

  // --- Tool: holly_exit_autopsy ---
  server.tool(
    "holly_exit_autopsy",
    "Full exit autopsy report on Holly historical trades. Strategy leaderboard (expectancy, Sharpe, profit factor), MFE/MAE giveback profiles, exit policy recommendations per strategy archetype (early_peaker/late_grower/bleeder), time-of-day performance, segment comparison (Grail vs Neo).",
    {
      since: z.string().optional().describe("Start date (ISO)"),
      until: z.string().optional().describe("End date (ISO)"),
    },
    async (params) => {
      const report = runExitAutopsy({ since: params.since, until: params.until });
      return { content: [{ type: "text", text: JSON.stringify(report, null, 2) }] };
    }
  );

  // --- Tool: trailing_stop_optimize ---
  server.tool(
    "trailing_stop_optimize",
    "Run all 19 trailing stop strategies on Holly historical trades. Simulates fixed-%, ATR-based, time-decay, MFE-escalation, and breakeven+trail exits against actual MFE/MAE data. Returns results sorted by P&L improvement.",
    {
      strategy: z.string().optional().describe("Filter by Holly strategy name"),
      segment: z.string().optional().describe("Filter by Holly segment"),
      since: z.string().optional().describe("Start date (ISO)"),
      until: z.string().optional().describe("End date (ISO)"),
    },
    async (params) => {
      const results = runFullOptimization({
        strategy: params.strategy, segment: params.segment,
        since: params.since, until: params.until,
      });
      return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
    }
  );

  // --- Tool: trailing_stop_summary ---
  server.tool(
    "trailing_stop_summary",
    "Compact comparison table of all trailing stop strategies showing original vs simulated P&L, win rate, Sharpe, and giveback reduction. Best for quick overview of which exit approach works best.",
    {
      strategy: z.string().optional().describe("Filter by Holly strategy name"),
      segment: z.string().optional().describe("Filter by Holly segment"),
      since: z.string().optional().describe("Start date (ISO)"),
      until: z.string().optional().describe("End date (ISO)"),
    },
    async (params) => {
      const summary = getOptimizationSummary({
        strategy: params.strategy, segment: params.segment,
        since: params.since, until: params.until,
      });
      return { content: [{ type: "text", text: JSON.stringify(summary, null, 2) }] };
    }
  );

  // --- Tool: trailing_stop_per_strategy ---
  server.tool(
    "trailing_stop_per_strategy",
    "Find the optimal trailing stop parameters for EACH Holly strategy independently. Returns the best trailing stop type and params per strategy with P&L improvement metrics.",
    {
      since: z.string().optional().describe("Start date (ISO)"),
      until: z.string().optional().describe("End date (ISO)"),
      min_trades: z.number().optional().default(20).describe("Minimum trades per strategy (default: 20)"),
    },
    async (params) => {
      const results = runPerStrategyOptimization({
        since: params.since, until: params.until,
        minTrades: params.min_trades,
      });
      return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
    }
  );

  // --- Tool: trailing_stop_params ---
  server.tool(
    "trailing_stop_params",
    "List all 19 default trailing stop parameter sets that can be tested. Shows name, type, and specific parameters for each strategy.",
    {},
    async () => {
      const params = getDefaultParamSets();
      return { content: [{ type: "text", text: JSON.stringify(params, null, 2) }] };
    }
  );

  // --- Tool: signal_feed ---
  server.tool(
    "signal_feed",
    "Query evaluated signals from the auto-eval pipeline. Signals are generated when Holly alerts are auto-evaluated through the 3-model ensemble. Shows ensemble score, should_trade verdict, and links to the full evaluation.",
    {
      symbol: z.string().optional().describe("Filter by symbol"),
      direction: z.string().optional().describe("Filter by direction (long/short)"),
      since: z.string().optional().describe("ISO datetime — only signals after this time"),
      limit: z.number().optional().default(50).describe("Max signals to return (default: 50)"),
    },
    async (params) => {
      const signals = querySignals({
        symbol: params.symbol, direction: params.direction,
        limit: params.limit, since: params.since,
      });
      return { content: [{ type: "text", text: JSON.stringify({ count: signals.length, signals }, null, 2) }] };
    }
  );

  // --- Tool: signal_stats ---
  server.tool(
    "signal_stats",
    "Get aggregate statistics for auto-eval signals: total count, tradeable signals, blocked by prefilter, and breakdown by direction.",
    {},
    async () => {
      const stats = getSignalStats();
      return { content: [{ type: "text", text: JSON.stringify(stats, null, 2) }] };
    }
  );

  // --- Tool: auto_eval_status ---
  server.tool(
    "auto_eval_status",
    "Get the auto-eval pipeline status: whether it's enabled, how many evals are currently running, max concurrent limit, and dedup window.",
    {},
    async () => {
      const status = getAutoEvalStatus();
      return { content: [{ type: "text", text: JSON.stringify(status, null, 2) }] };
    }
  );

  // --- Tool: auto_eval_toggle ---
  server.tool(
    "auto_eval_toggle",
    "Enable or disable the auto-eval pipeline. When enabled, incoming Holly alerts are automatically evaluated through the 3-model ensemble.",
    {
      enabled: z.boolean().describe("Set to true to enable, false to disable"),
    },
    async (params) => {
      setAutoEvalEnabled(params.enabled);
      const status = getAutoEvalStatus();
      return { content: [{ type: "text", text: JSON.stringify(status, null, 2) }] };
    }
  );

  // --- Tool: auto_link_stats ---
  server.tool(
    "auto_link_stats",
    "Get evaluation-to-execution auto-link statistics: total links, explicit vs heuristic, outcomes auto-recorded, and recent links.",
    {},
    async () => {
      const stats = getAutoLinkStats();
      const recent = getRecentLinks(10);
      return { content: [{ type: "text", text: JSON.stringify({ stats, recent }, null, 2) }] };
    }
  );

  // --- Tool: divoom_status ---
  server.tool(
    "divoom_status",
    "Check if Divoom Times Gate display is connected and retrieve device information.",
    {},
    async () => {
      const { getDivoomDisplay } = await import("../divoom/updater.js");
      const display = getDivoomDisplay();
      
      if (!display) {
        return {
          content: [{
            type: "text",
            text: JSON.stringify({ error: "Divoom display not initialized. Check DIVOOM_ENABLED and DIVOOM_DEVICE_IP config." }, null, 2)
          }],
        };
      }

      try {
        const deviceInfo = await display.getDeviceInfo();
        return { content: [{ type: "text", text: JSON.stringify(deviceInfo, null, 2) }] };
      } catch (e: any) {
        return {
          content: [{ type: "text", text: `Error: ${e.message}` }],
          isError: true,
        };
      }
    }
  );

  // --- Tool: divoom_send_text ---
  server.tool(
    "divoom_send_text",
    "Manually send text to the Divoom Times Gate display.",
    {
      text: z.string().describe("Text to display"),
      color: z.string().optional().describe("Hex color, e.g. #FF0000 (default: #FFFFFF)"),
      x: z.number().optional().describe("X position (default: 0)"),
      y: z.number().optional().describe("Y position (default: 0)"),
      font: z.number().optional().describe("Font ID (default: 2)"),
      scrollSpeed: z.number().optional().describe("Scroll speed 0-100 (default: 50)"),
    },
    async (params) => {
      const { getDivoomDisplay } = await import("../divoom/updater.js");
      const display = getDivoomDisplay();
      
      if (!display) {
        return {
          content: [{
            type: "text",
            text: JSON.stringify({ error: "Divoom display not initialized. Check DIVOOM_ENABLED and DIVOOM_DEVICE_IP config." }, null, 2)
          }],
        };
      }

      try {
        await display.sendText(params.text, {
          color: params.color,
          x: params.x,
          y: params.y,
          font: params.font,
          scrollSpeed: params.scrollSpeed,
        });
        return { content: [{ type: "text", text: JSON.stringify({ success: true, text: params.text }, null, 2) }] };
      } catch (e: any) {
        return {
          content: [{ type: "text", text: `Error: ${e.message}` }],
          isError: true,
        };
      }
    }
  );

  // --- Tool: divoom_set_brightness ---
  server.tool(
    "divoom_set_brightness",
    "Adjust Divoom Times Gate display brightness (0-100).",
    {
      brightness: z.number().min(0).max(100).describe("Brightness level 0-100"),
    },
    async (params) => {
      const { getDivoomDisplay } = await import("../divoom/updater.js");
      const display = getDivoomDisplay();
      
      if (!display) {
        return {
          content: [{
            type: "text",
            text: JSON.stringify({ error: "Divoom display not initialized. Check DIVOOM_ENABLED and DIVOOM_DEVICE_IP config." }, null, 2)
          }],
        };
      }

      try {
        await display.setBrightness(params.brightness);
        return { content: [{ type: "text", text: JSON.stringify({ success: true, brightness: params.brightness }, null, 2) }] };
      } catch (e: any) {
        return {
          content: [{ type: "text", text: `Error: ${e.message}` }],
          isError: true,
        };
      }
    }
  );

  // --- Tool: ops_health ---
  server.tool(
    "ops_health",
    "Full ops health dashboard: process metrics, IBKR availability SLA, request latency percentiles, error rates, incidents.",
    {},
    async () => ({ content: [{ type: "text", text: JSON.stringify(getMetrics(), null, 2) }] })
  );

  // --- Tool: ops_incidents ---
  server.tool(
    "ops_incidents",
    "Get recent operational incidents (disconnects, errors, heartbeat timeouts).",
    { limit: z.number().default(20).describe("Max incidents to return") },
    async (params) => {
      const incidents = getRecentIncidents(params.limit);
      return { content: [{ type: "text", text: JSON.stringify({ count: incidents.length, incidents }, null, 2) }] };
    }
  );

  // --- Tool: ops_uptime ---
  server.tool(
    "ops_uptime",
    "Get uptime summary: process uptime, IBKR connection SLA, memory/CPU, error rate.",
    {},
    async () => {
      const connStatus = getConnectionStatus();
      const metrics = getMetrics();
      return { content: [{ type: "text", text: JSON.stringify({
        process_uptime_seconds: metrics.uptimeSeconds,
        started_at: metrics.startedAt,
        ibkr_uptime_percent: metrics.ibkrUptimePercent,
        ibkr_connected: metrics.ibkrConnected,
        ibkr_current_streak_seconds: metrics.ibkrCurrentStreakSeconds,
        ibkr_total_disconnects: connStatus.totalDisconnects,
        ibkr_reconnect_attempts: connStatus.reconnectAttempts,
        memory_mb: metrics.memoryMb,
        cpu_percent: metrics.cpuPercent,
        request_error_rate: metrics.requests.errorRate,
        incident_count: metrics.incidentCount,
        last_incident: metrics.lastIncident,
      }, null, 2) }] };
    }
  );

  // --- Tool: ops_runbook ---
  server.tool(
    "ops_runbook",
    "Get ops runbook procedure for a scenario (crash, disconnect, tunnel, mcp, error, memory, tws, database). Returns symptoms, diagnosis, recovery, prevention.",
    { scenario: z.string().default("").describe("Scenario: crash, disconnect, tunnel, mcp, error, memory, tws, database") },
    async (params) => {
      const scenario = params.scenario.toLowerCase();
      const runbook: Record<string, { scenario: string; symptoms: string[]; diagnosis: string[]; recovery: string[]; prevention: string[] }> = {
        crash: {
          scenario: "Bridge process crash",
          symptoms: ["pm2 restart count increases", "All tools fail simultaneously", "MCP sessions drop"],
          diagnosis: ["pm2 status — check restart count and uptime", "pm2 logs market-bridge --lines 100", "curl localhost:3000/health/ready"],
          recovery: ["pm2 restart market-bridge", "If crash-looping: pm2 stop, fix root cause, pm2 start"],
          prevention: ["Monitor incident_count in /health/deep"],
        },
        disconnect: {
          scenario: "IBKR disconnect",
          symptoms: ["Tools return 'IBKR is not connected' errors", "ops_uptime shows ibkr_connected: false"],
          diagnosis: ["Check TWS/Gateway is running", "Check TWS API Settings: Socket port, Active X", "Look for error 326 (clientId collision)"],
          recovery: ["Usually auto-recovers via reconnect backoff", "If stuck: pm2 restart market-bridge"],
          prevention: ["3-strike heartbeat system auto-detects and recovers"],
        },
        tunnel: {
          scenario: "Cloudflare tunnel down",
          symptoms: ["ChatGPT tools timeout", "localhost works but api.klfh-dot-io.com does not"],
          diagnosis: ["Check cloudflared process is running", "curl localhost:3000/health — if works, tunnel is the issue"],
          recovery: ["Start cloudflared: Start-Process cloudflared -ArgumentList 'tunnel','run','market-bridge'", "Or restart service: cloudflared service restart"],
          prevention: ["Install cloudflared as Windows service for auto-start"],
        },
        mcp: {
          scenario: "MCP transport broken (Claude Desktop)",
          symptoms: ["Claude Desktop tools all fail", "Bridge otherwise healthy (REST works)"],
          diagnosis: ["Check Claude Desktop Settings > MCP status", "curl localhost:3000/health/ready"],
          recovery: ["Restart Claude Desktop", "If bridge crashed too: pm2 restart first"],
          prevention: ["MCP REST proxy ensures tools work even when direct connection fails"],
        },
        error: {
          scenario: "High error rate",
          symptoms: ["Intermittent failures", "Some tools work, others fail"],
          diagnosis: ["curl localhost:3000/health/deep — check errorRate", "pm2 logs market-bridge --lines 200"],
          recovery: ["Identify failing actions from logs", "pm2 restart as last resort"],
          prevention: ["Monitor errorRate in /health/deep"],
        },
        memory: {
          scenario: "Memory leak / high memory",
          symptoms: ["Gradual performance degradation", "rss > 400MB"],
          diagnosis: ["curl localhost:3000/health/deep — check memoryMb.rss", "pm2 monit"],
          recovery: ["pm2 restart market-bridge"],
          prevention: ["Set pm2 max_memory_restart in ecosystem config"],
        },
        tws: {
          scenario: "TWS restart",
          symptoms: ["All IBKR tools fail simultaneously", "Error 1100 in logs"],
          diagnosis: ["Check if TWS is running", "ops_incidents — look for ibkr_tws_restart"],
          recovery: ["Usually auto-recovers: bridge waits 10s then reconnects", "If stuck: pm2 restart"],
          prevention: ["Configure TWS auto-restart in TWS Settings"],
        },
        database: {
          scenario: "Database corruption",
          symptoms: ["DB write errors in logs", "db_writable: false"],
          diagnosis: ["Check disk space", "sqlite3 data/bridge.db 'PRAGMA integrity_check'"],
          recovery: ["Restore from backup", "Nuclear: delete data/bridge.db and restart"],
          prevention: ["Regular backups of data/bridge.db"],
        },
      };

      if (!scenario) {
        return { content: [{ type: "text", text: JSON.stringify({ available_scenarios: Object.keys(runbook) }, null, 2) }] };
      }
      const match = Object.keys(runbook).find((k) => scenario.includes(k) || k.includes(scenario));
      if (!match) {
        return { content: [{ type: "text", text: JSON.stringify({ error: `Unknown scenario '${scenario}'`, available_scenarios: Object.keys(runbook) }, null, 2) }] };
      }
      return { content: [{ type: "text", text: JSON.stringify(runbook[match], null, 2) }] };
    }
  );

  // --- Tool: drift_check ---
  server.tool(
    "drift_check",
    "Check model drift against thresholds and generate alerts. Runs drift report + alert check in one call.",
    {},
    async () => {
      const report = computeDriftReport();
      const alerts = checkDriftAlerts(report);
      return { content: [{ type: "text", text: JSON.stringify({ report, alerts }, null, 2) }] };
    }
  );

  // --- Tool: update_risk_config ---
  server.tool(
    "update_risk_config",
    "Update risk configuration parameters (max_position_pct, max_daily_loss_pct, max_concentration_pct, volatility_scalar).",
    {
      max_position_pct: z.number().optional().describe("Max position % of equity"),
      max_daily_loss_pct: z.number().optional().describe("Max daily loss %"),
      max_concentration_pct: z.number().optional().describe("Max single-position concentration %"),
      volatility_scalar: z.number().optional().describe("Volatility scaling factor"),
      source: z.string().default("manual").describe("Source of the change"),
    },
    async (params) => {
      const knownKeys = new Set<RiskConfigParam>(Object.keys(RISK_CONFIG_DEFAULTS) as RiskConfigParam[]);
      const entries: Array<{ param: RiskConfigParam; value: number; source: string }> = Object.entries(params)
        .filter((entry): entry is [RiskConfigParam, number] => {
          const [key, value] = entry;
          return knownKeys.has(key as RiskConfigParam) && typeof value === "number" && Number.isFinite(value);
        })
        .map(([param, value]) => ({ param, value, source: params.source }));

      if (entries.length === 0) {
        return { content: [{ type: "text", text: JSON.stringify({ updated: 0, config: getRiskGateConfig() }, null, 2) }] };
      }
      upsertRiskConfig(entries);
      return { content: [{ type: "text", text: JSON.stringify({ updated: entries.length, config: getRiskGateConfig() }, null, 2) }] };
    }
  );

  return server;
}
