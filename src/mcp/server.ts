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
  getTrendingSymbols,
  getScreenerIds,
  runScreener,
  runScreenerWithQuotes,
} from "../providers/yahoo.js";
import { isConnected } from "../ibkr/connection.js";
import { getAccountSummary, getPositions, getPnL } from "../ibkr/account.js";
import { getOpenOrders, getCompletedOrders, getExecutions, placeOrder, placeBracketOrder, cancelOrder, cancelAllOrders } from "../ibkr/orders.js";
import { getContractDetails } from "../ibkr/contracts.js";
import { getIBKRQuote } from "../ibkr/marketdata.js";
import { readMessages, postMessage, clearMessages, getStats } from "../collab/store.js";
import { checkRisk } from "../ibkr/risk-gate.js";
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
} from "../db/database.js";

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
    "Place a single order (MKT, LMT, STP, STP LMT) on IBKR. Requires TWS/Gateway.",
    {
      symbol: z.string().describe("Ticker symbol, e.g. AAPL"),
      action: z.enum(["BUY", "SELL"]).describe("BUY or SELL"),
      orderType: z.enum(["MKT", "LMT", "STP", "STP LMT"]).describe("Order type"),
      totalQuantity: z.number().describe("Number of shares"),
      lmtPrice: z.number().optional().describe("Limit price (required for LMT and STP LMT)"),
      auxPrice: z.number().optional().describe("Stop price (required for STP and STP LMT)"),
      tif: z.string().optional().describe("Time in force: DAY (default), GTC, IOC"),
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

  return server;
}
