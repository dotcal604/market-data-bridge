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
import { isConnected } from "../ibkr/connection.js";
import { getAccountSummary, getPositions, getPnL } from "../ibkr/account.js";
import { getOpenOrders, getCompletedOrders, getExecutions, placeOrder, placeBracketOrder, placeAdvancedBracket, cancelOrder, cancelAllOrders, flattenAllPositions, validateOrder } from "../ibkr/orders.js";
import { setFlattenEnabled, getFlattenConfig } from "../scheduler.js";
import { getContractDetails } from "../ibkr/contracts.js";
import { getIBKRQuote, getHistoricalTicks } from "../ibkr/marketdata.js";
import { reqHistoricalNews, reqNewsArticle, reqNewsBulletins, reqNewsProviders } from "../ibkr/news.js";
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
import { checkRisk, getSessionState, recordTradeResult, lockSession, unlockSession, resetSession } from "../ibkr/risk-gate.js";
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
} from "../db/database.js";
import { computeDriftReport } from "../eval/drift.js";
import { importTraderSyncCSV } from "../tradersync/importer.js";
import { computeEnsembleWithWeights } from "../eval/ensemble/scorer.js";
import { getWeights } from "../eval/ensemble/weights.js";
import type { ModelEvaluation } from "../eval/models/types.js";

export function createMcpServer(): McpServer {
  const server = new McpServer({
    name: "market-data-bridge",
    version: "2.0.0",
  });

  // --- Tool: get_status ---
  server.tool(
    "get_status",
    "Get bridge status. Returns easternTime, marketSession (pre-market/regular/after-hours/closed), and IBKR connection state. Call this FIRST before any query.",
    {},
    async () => ({
      content: [{ type: "text", text: JSON.stringify(getStatus(), null, 2) }],
    })
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
    async ({ symbol, startTime, endTime, type, count }) => {
      try {
        if (!isConnected()) {
          return { content: [{ type: "text", text: "Error: IBKR not connected. Start TWS/Gateway for historical tick data." }], isError: true };
        }

        const ticks = await getHistoricalTicks(symbol.toUpperCase(), startTime, endTime, type, count);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  symbol: symbol.toUpperCase(),
                  startTime,
                  endTime,
                  type,
                  count: ticks.length,
                  ticks,
                  source: "ibkr",
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (e: any) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
      }
    }
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
    async () => {
      if (!isConnected()) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                { error: "IBKR not connected. Start TWS/Gateway for account data." },
                null,
                2
              ),
            },
          ],
        };
      }
      try {
        const summary = await getAccountSummary();
        return { content: [{ type: "text", text: JSON.stringify(summary, null, 2) }] };
      } catch (e: any) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
      }
    }
  );

  // --- Tool: get_positions (IBKR — requires TWS/Gateway) ---
  server.tool(
    "get_positions",
    "Get all current IBKR positions with symbol, quantity, and average cost. Requires TWS/Gateway.",
    {},
    async () => {
      if (!isConnected()) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                { error: "IBKR not connected. Start TWS/Gateway for position data." },
                null,
                2
              ),
            },
          ],
        };
      }
      try {
        const positions = await getPositions();
        return {
          content: [
            { type: "text", text: JSON.stringify({ count: positions.length, positions }, null, 2) },
          ],
        };
      } catch (e: any) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
      }
    }
  );

  // --- Tool: get_pnl (IBKR — requires TWS/Gateway) ---
  server.tool(
    "get_pnl",
    "Get daily profit and loss (daily PnL, unrealized PnL, realized PnL). Requires TWS/Gateway.",
    {},
    async () => {
      if (!isConnected()) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                { error: "IBKR not connected. Start TWS/Gateway for PnL data." },
                null,
                2
              ),
            },
          ],
        };
      }
      try {
        const pnl = await getPnL();
        return { content: [{ type: "text", text: JSON.stringify(pnl, null, 2) }] };
      } catch (e: any) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
      }
    }
  );

  // --- Tool: get_news_providers (IBKR — requires TWS/Gateway) ---
  server.tool(
    "get_news_providers",
    "Get IBKR news providers. Returns provider codes used for historical/news article lookups.",
    {},
    async () => {
      if (!isConnected()) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                { error: "IBKR not connected. Start TWS/Gateway for news provider data." },
                null,
                2
              ),
            },
          ],
        };
      }
      try {
        const providers = await reqNewsProviders();
        return {
          content: [
            { type: "text", text: JSON.stringify({ count: providers.length, providers }, null, 2) },
          ],
        };
      } catch (e: any) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
      }
    }
  );

  // --- Tool: get_news_article (IBKR — requires TWS/Gateway) ---
  server.tool(
    "get_news_article",
    "Get a full IBKR news article by provider code and article ID.",
    {
      providerCode: z.string().describe("News provider code, e.g. BRFG"),
      articleId: z.string().describe("Article ID from historical news results"),
    },
    async ({ providerCode, articleId }) => {
      if (!isConnected()) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                { error: "IBKR not connected. Start TWS/Gateway for news articles." },
                null,
                2
              ),
            },
          ],
        };
      }
      try {
        const article = await reqNewsArticle(providerCode, articleId);
        return { content: [{ type: "text", text: JSON.stringify(article, null, 2) }] };
      } catch (e: any) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
      }
    }
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
    async ({ symbol, providerCodes, startDateTime, endDateTime, secType, exchange, currency }) => {
      if (!isConnected()) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                { error: "IBKR not connected. Start TWS/Gateway for historical news." },
                null,
                2
              ),
            },
          ],
        };
      }
      try {
        const [contract] = await getContractDetails({ symbol, secType, exchange, currency });
        if (!contract) {
          return {
            content: [{ type: "text", text: JSON.stringify({ error: `No contract found for symbol ${symbol}` }, null, 2) }],
            isError: true,
          };
        }
        const headlines = await reqHistoricalNews(contract.conId, providerCodes, startDateTime, endDateTime);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ symbol: symbol.toUpperCase(), conId: contract.conId, count: headlines.length, headlines }, null, 2),
            },
          ],
        };
      } catch (e: any) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
      }
    }
  );

  // --- Tool: get_news_bulletins (IBKR — requires TWS/Gateway) ---
  server.tool(
    "get_news_bulletins",
    "Subscribe to IBKR news bulletins for 3 seconds, then unsubscribe and return collected bulletins.",
    {},
    async () => {
      if (!isConnected()) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                { error: "IBKR not connected. Start TWS/Gateway for news bulletins." },
                null,
                2
              ),
            },
          ],
        };
      }
      try {
        const bulletins = await reqNewsBulletins();
        return {
          content: [
            { type: "text", text: JSON.stringify({ count: bulletins.length, bulletins }, null, 2) },
          ],
        };
      } catch (e: any) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
      }
    }
  );

  // =====================================================================
  // IBKR DATA WRAPPERS (13 methods from src/ibkr/data.ts)
  // =====================================================================

  server.tool(
    "get_pnl_single",
    "Get position-level daily PnL for one symbol using reqPnLSingle.",
    { symbol: z.string().describe("Ticker symbol") },
    async ({ symbol }) => {
      if (!isConnected()) {
        return { content: [{ type: "text", text: JSON.stringify({ error: "IBKR not connected. Start TWS/Gateway for PnL data." }, null, 2) }], isError: true };
      }
      try {
        const data = await reqPnLSingleBySymbol(symbol);
        return { content: [{ type: "text", text: JSON.stringify({ data }, null, 2) }] };
      } catch (e: any) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
      }
    }
  );

  server.tool(
    "search_ibkr_symbols",
    "Search symbols from IBKR contract database using reqMatchingSymbols.",
    { query: z.string().min(1).describe("Search pattern") },
    async ({ query }) => {
      if (!isConnected()) {
        return { content: [{ type: "text", text: JSON.stringify({ error: "IBKR not connected. Start TWS/Gateway for symbol search." }, null, 2) }], isError: true };
      }
      try {
        const results = await reqMatchingSymbols(query);
        return { content: [{ type: "text", text: JSON.stringify({ data: { count: results.length, results } }, null, 2) }] };
      } catch (e: any) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
      }
    }
  );

  server.tool(
    "set_market_data_type",
    "Set market data mode: 1=live, 2=frozen, 3=delayed, 4=delayed-frozen.",
    { marketDataType: z.number().int().min(1).max(4) },
    async ({ marketDataType }) => {
      if (!isConnected()) {
        return { content: [{ type: "text", text: JSON.stringify({ error: "IBKR not connected. Start TWS/Gateway to set market data type." }, null, 2) }], isError: true };
      }
      try {
        const data = await reqMarketDataType(marketDataType);
        return { content: [{ type: "text", text: JSON.stringify({ data }, null, 2) }] };
      } catch (e: any) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
      }
    }
  );

  server.tool(
    "set_auto_open_orders",
    "Enable or disable automatic open order binding for clientId 0.",
    { autoBind: z.boolean() },
    async ({ autoBind }) => {
      if (!isConnected()) {
        return { content: [{ type: "text", text: JSON.stringify({ error: "IBKR not connected. Start TWS/Gateway to set auto-open orders." }, null, 2) }], isError: true };
      }
      try {
        const data = await reqAutoOpenOrders(autoBind);
        return { content: [{ type: "text", text: JSON.stringify({ data }, null, 2) }] };
      } catch (e: any) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
      }
    }
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
    async ({ symbol, whatToShow, useRTH, formatDate }) => {
      if (!isConnected()) {
        return { content: [{ type: "text", text: JSON.stringify({ error: "IBKR not connected. Start TWS/Gateway for head timestamp data." }, null, 2) }], isError: true };
      }
      try {
        const data = await reqHeadTimestampBySymbol({ symbol, whatToShow: whatToShow ?? "TRADES", useRTH: useRTH ?? true, formatDate: formatDate ?? 1 });
        return { content: [{ type: "text", text: JSON.stringify({ data }, null, 2) }] };
      } catch (e: any) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
      }
    }
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
    async ({ symbol, useRTH, period, periodUnit }) => {
      if (!isConnected()) {
        return { content: [{ type: "text", text: JSON.stringify({ error: "IBKR not connected. Start TWS/Gateway for histogram data." }, null, 2) }], isError: true };
      }
      try {
        const data = await reqHistogramDataBySymbol({ symbol, useRTH: useRTH ?? true, period: period ?? 3, periodUnit: periodUnit ?? "D" });
        return { content: [{ type: "text", text: JSON.stringify({ data }, null, 2) }] };
      } catch (e: any) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
      }
    }
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
    async (input) => {
      if (!isConnected()) {
        return { content: [{ type: "text", text: JSON.stringify({ error: "IBKR not connected. Start TWS/Gateway for option calculations." }, null, 2) }], isError: true };
      }
      try {
        const data = await calculateImpliedVolatility(input);
        return { content: [{ type: "text", text: JSON.stringify({ data }, null, 2) }] };
      } catch (e: any) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
      }
    }
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
    async (input) => {
      if (!isConnected()) {
        return { content: [{ type: "text", text: JSON.stringify({ error: "IBKR not connected. Start TWS/Gateway for option calculations." }, null, 2) }], isError: true };
      }
      try {
        const data = await calculateOptionPrice(input);
        return { content: [{ type: "text", text: JSON.stringify({ data }, null, 2) }] };
      } catch (e: any) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
      }
    }
  );

  server.tool(
    "get_tws_current_time",
    "Get current TWS server time.",
    {},
    async () => {
      if (!isConnected()) {
        return { content: [{ type: "text", text: JSON.stringify({ error: "IBKR not connected. Start TWS/Gateway for TWS time." }, null, 2) }], isError: true };
      }
      try {
        const data = await reqCurrentTime();
        return { content: [{ type: "text", text: JSON.stringify({ data }, null, 2) }] };
      } catch (e: any) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
      }
    }
  );

  server.tool(
    "get_market_rule",
    "Get market rule increments by rule id.",
    { ruleId: z.number().int().positive() },
    async ({ ruleId }) => {
      if (!isConnected()) {
        return { content: [{ type: "text", text: JSON.stringify({ error: "IBKR not connected. Start TWS/Gateway for market rule data." }, null, 2) }], isError: true };
      }
      try {
        const data = await reqMarketRule(ruleId);
        return { content: [{ type: "text", text: JSON.stringify({ data }, null, 2) }] };
      } catch (e: any) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
      }
    }
  );

  server.tool(
    "get_smart_components",
    "Get SMART routing component map for an exchange.",
    { exchange: z.string().min(1) },
    async ({ exchange }) => {
      if (!isConnected()) {
        return { content: [{ type: "text", text: JSON.stringify({ error: "IBKR not connected. Start TWS/Gateway for smart components." }, null, 2) }], isError: true };
      }
      try {
        const data = await reqSmartComponents(exchange.toUpperCase());
        return { content: [{ type: "text", text: JSON.stringify({ data }, null, 2) }] };
      } catch (e: any) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
      }
    }
  );

  server.tool(
    "get_depth_exchanges",
    "Get list of available market depth exchanges.",
    {},
    async () => {
      if (!isConnected()) {
        return { content: [{ type: "text", text: JSON.stringify({ error: "IBKR not connected. Start TWS/Gateway for depth exchange data." }, null, 2) }], isError: true };
      }
      try {
        const data = await reqMktDepthExchanges();
        return { content: [{ type: "text", text: JSON.stringify({ data }, null, 2) }] };
      } catch (e: any) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
      }
    }
  );

  server.tool(
    "get_fundamental_data",
    "Get IBKR fundamental data XML report for a symbol.",
    { symbol: z.string(), reportType: z.string().optional() },
    async ({ symbol, reportType }) => {
      if (!isConnected()) {
        return { content: [{ type: "text", text: JSON.stringify({ error: "IBKR not connected. Start TWS/Gateway for fundamental data." }, null, 2) }], isError: true };
      }
      try {
        const data = await reqFundamentalDataBySymbol({ symbol, reportType: reportType ?? "ReportSnapshot" });
        return { content: [{ type: "text", text: JSON.stringify({ data }, null, 2) }] };
      } catch (e: any) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
      }
    }
  );

  // --- Tool: stress_test (IBKR — requires TWS/Gateway) ---
  server.tool(
    "stress_test",
    "Run a portfolio stress test using open positions and account net liquidation. Supports optional beta-adjusted shocks.",
    {
      shockPercent: z.number().describe("Shock percentage to apply (e.g. -5 for a 5% down shock)"),
      betaAdjusted: z.boolean().optional().describe("When true, scales each symbol shock by its beta vs SPY"),
    },
    async ({ shockPercent, betaAdjusted }) => {
      if (!isConnected()) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                { error: "IBKR not connected. Start TWS/Gateway for portfolio stress test." },
                null,
                2
              ),
            },
          ],
        };
      }
      try {
        const result = await runPortfolioStressTest(shockPercent, betaAdjusted ?? true);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (e: any) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
      }
    }
  );

  // --- Tool: portfolio_exposure (IBKR — requires TWS/Gateway) ---
  server.tool(
    "portfolio_exposure",
    "Compute portfolio exposure analytics: gross/net exposure, % deployed, largest position, sector breakdown, beta-weighted exposure, portfolio heat. Requires TWS/Gateway.",
    {},
    async () => {
      if (!isConnected()) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                { error: "IBKR not connected. Start TWS/Gateway for portfolio data." },
                null,
                2
              ),
            },
          ],
          isError: true,
        };
      }
      try {
        const exposure = await computePortfolioExposure();
        return { content: [{ type: "text", text: JSON.stringify(exposure, null, 2) }] };
      } catch (e: any) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
      }
    }
  );

  // --- Tool: get_open_orders (IBKR — requires TWS/Gateway) ---
  server.tool(
    "get_open_orders",
    "Get all open orders across all clients. Shows orderId, symbol, action, type, quantity, limit/stop price, status, TIF.",
    {},
    async () => {
      if (!isConnected()) {
        return {
          content: [
            { type: "text", text: JSON.stringify({ error: "IBKR not connected. Start TWS/Gateway for order data." }, null, 2) },
          ],
        };
      }
      try {
        const orders = await getOpenOrders();
        return { content: [{ type: "text", text: JSON.stringify({ count: orders.length, orders }, null, 2) }] };
      } catch (e: any) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
      }
    }
  );

  // --- Tool: get_completed_orders (IBKR — requires TWS/Gateway) ---
  server.tool(
    "get_completed_orders",
    "Get completed (filled/cancelled) orders. Shows fill price, quantity, status, completion time.",
    {},
    async () => {
      if (!isConnected()) {
        return {
          content: [
            { type: "text", text: JSON.stringify({ error: "IBKR not connected. Start TWS/Gateway for order data." }, null, 2) },
          ],
        };
      }
      try {
        const orders = await getCompletedOrders();
        return { content: [{ type: "text", text: JSON.stringify({ count: orders.length, orders }, null, 2) }] };
      } catch (e: any) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
      }
    }
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
    async ({ symbol, secType, time }) => {
      if (!isConnected()) {
        return {
          content: [
            { type: "text", text: JSON.stringify({ error: "IBKR not connected. Start TWS/Gateway for execution data." }, null, 2) },
          ],
        };
      }
      try {
        const filter = symbol || secType || time ? { symbol, secType, time } : undefined;
        const executions = await getExecutions(filter);
        return { content: [{ type: "text", text: JSON.stringify({ count: executions.length, executions }, null, 2) }] };
      } catch (e: any) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
      }
    }
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
    async ({ symbol, secType, exchange, currency }) => {
      if (!isConnected()) {
        return {
          content: [
            { type: "text", text: JSON.stringify({ error: "IBKR not connected. Start TWS/Gateway for contract data." }, null, 2) },
          ],
        };
      }
      try {
        const details = await getContractDetails({ symbol, secType, exchange, currency });
        return { content: [{ type: "text", text: JSON.stringify({ count: details.length, contracts: details }, null, 2) }] };
      } catch (e: any) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
      }
    }
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
    async ({ symbol, secType, exchange, currency }) => {
      if (!isConnected()) {
        return {
          content: [
            { type: "text", text: JSON.stringify({ error: "IBKR not connected. Start TWS/Gateway for market data." }, null, 2) },
          ],
        };
      }
      try {
        const quote = await getIBKRQuote({ symbol, secType, exchange, currency });
        return { content: [{ type: "text", text: JSON.stringify(quote, null, 2) }] };
      } catch (e: any) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
      }
    }
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
    },
    async (params) => {
      if (!isConnected()) {
        return {
          content: [{ type: "text", text: JSON.stringify({ error: "IBKR not connected." }, null, 2) }],
        };
      }
      try {
        const validation = validateOrder(params as any);
        if (!validation.valid) {
          return { content: [{ type: "text", text: JSON.stringify({ error: validation.errors.join("; ") }, null, 2) }] };
        }
        const riskResult = checkRisk(params);
        if (!riskResult.allowed) {
          return { content: [{ type: "text", text: JSON.stringify({ error: `Risk gate rejected: ${riskResult.reason}` }, null, 2) }] };
        }
        const result = await placeOrder({ ...params, order_source: "mcp" });
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (e: any) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
      }
    }
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
    },
    async (params) => {
      if (!isConnected()) {
        return {
          content: [{ type: "text", text: JSON.stringify({ error: "IBKR not connected." }, null, 2) }],
        };
      }
      try {
        const riskResult = checkRisk({ symbol: params.symbol, action: params.action, orderType: params.entryType, totalQuantity: params.totalQuantity, lmtPrice: params.entryPrice, secType: params.secType });
        if (!riskResult.allowed) {
          return { content: [{ type: "text", text: JSON.stringify({ error: `Risk gate rejected: ${riskResult.reason}` }, null, 2) }] };
        }
        const result = await placeBracketOrder({ ...params, order_source: "mcp" });
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (e: any) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
      }
    }
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
    },
    async (params) => {
      if (!isConnected()) {
        return {
          content: [{ type: "text", text: JSON.stringify({ error: "IBKR not connected." }, null, 2) }],
        };
      }
      try {
        const riskResult = checkRisk({ symbol: params.symbol, action: params.action, orderType: params.entry.type, totalQuantity: params.quantity, lmtPrice: params.entry.price, secType: params.secType });
        if (!riskResult.allowed) {
          return { content: [{ type: "text", text: JSON.stringify({ error: `Risk gate rejected: ${riskResult.reason}` }, null, 2) }] };
        }
        const result = await placeAdvancedBracket({ ...params, order_source: "mcp" });
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (e: any) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
      }
    }
  );

  // --- Tool: cancel_order (IBKR — requires TWS/Gateway) ---
  server.tool(
    "cancel_order",
    "Cancel a specific open order by orderId. Requires TWS/Gateway.",
    {
      orderId: z.number().describe("The order ID to cancel"),
    },
    async ({ orderId: id }) => {
      if (!isConnected()) {
        return {
          content: [{ type: "text", text: JSON.stringify({ error: "IBKR not connected." }, null, 2) }],
        };
      }
      try {
        const result = await cancelOrder(id);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (e: any) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
      }
    }
  );

  // --- Tool: cancel_all_orders (IBKR — requires TWS/Gateway) ---
  server.tool(
    "cancel_all_orders",
    "Cancel ALL open orders globally. Use with caution. Requires TWS/Gateway.",
    {},
    async () => {
      if (!isConnected()) {
        return {
          content: [{ type: "text", text: JSON.stringify({ error: "IBKR not connected." }, null, 2) }],
        };
      }
      try {
        const result = await cancelAllOrders();
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (e: any) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
      }
    }
  );

  // --- Tool: flatten_positions (EOD close-out) ---
  server.tool(
    "flatten_positions",
    "Immediately close ALL open positions with MKT orders and cancel all open orders. Use for EOD flatten or emergency exit.",
    {},
    async () => {
      if (!isConnected()) {
        return { content: [{ type: "text", text: JSON.stringify({ error: "IBKR not connected." }, null, 2) }] };
      }
      try {
        const result = await flattenAllPositions();
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (e: any) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
      }
    }
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
    "size_position",
    "Calculate safe position size based on account equity, risk parameters, and margin capacity. Read-only computation — does not place orders.",
    {
      symbol: z.string().describe("Ticker symbol, e.g. AAPL, MSFT"),
      entryPrice: z.number().positive().describe("Entry price per share"),
      stopPrice: z.number().nonnegative().describe("Stop loss price per share"),
      riskPercent: z.number().positive().max(100).optional().describe("Max % of net liquidation to risk (default 1%)"),
      riskAmount: z.number().positive().optional().describe("Absolute dollar risk cap (overrides riskPercent if provided)"),
      maxCapitalPercent: z.number().positive().max(100).optional().describe("Max % of equity in this position (default 10%)"),
    },
    async (params) => {
      if (!isConnected()) {
        return { content: [{ type: "text", text: "Error: IBKR not connected. Start TWS/Gateway for account data." }], isError: true };
      }
      try {
        const result = await calculatePositionSize(params);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (e: any) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
      }
    }
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

  return server;
}
