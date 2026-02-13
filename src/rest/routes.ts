import { Router } from "express";
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
import { checkRisk, getSessionState, recordTradeResult, lockSession, unlockSession, resetSession } from "../ibkr/risk-gate.js";
import {
  queryOrders,
  queryExecutions,
  queryJournal,
  insertJournalEntry,
  updateJournalEntry,
  getJournalById,
} from "../db/database.js";

function qs(val: unknown, fallback: string): string {
  if (typeof val === "string") return val;
  return fallback;
}

/** Validate a stock/index symbol — alphanumeric, dots, hyphens, carets, max 20 chars */
const SYMBOL_RE = /^[A-Za-z0-9.\-^=%]{1,20}$/;
function validateSymbol(symbol: string): string | null {
  if (!symbol || !SYMBOL_RE.test(symbol)) {
    return "Invalid symbol: must be 1-20 alphanumeric characters";
  }
  return null;
}

/** Validate a numeric value is a finite positive number */
function isFinitePositive(val: unknown): val is number {
  return typeof val === "number" && Number.isFinite(val) && val > 0;
}

/** Clamp a parsed limit to a safe range */
function safeLimit(raw: string | undefined, defaultVal: number, max: number = 1000): number {
  if (!raw) return defaultVal;
  const n = parseInt(raw, 10);
  if (isNaN(n) || n < 1) return defaultVal;
  return Math.min(n, max);
}

export const router = Router();

// GET /api/status
router.get("/status", (_req, res) => {
  res.json(getStatus());
});

// GET /api/quote/:symbol — Smart quote: IBKR real-time first, Yahoo fallback
router.get("/quote/:symbol", async (req, res) => {
  try {
    const symbol = req.params.symbol;
    const symErr = validateSymbol(symbol);
    if (symErr) { res.status(400).json({ error: symErr }); return; }
    // Try IBKR first if connected (real-time data)
    if (isConnected()) {
      try {
        const ibkrQuote = await getIBKRQuote({ symbol });
        // If we got meaningful data (at least a last/bid/ask), return it
        if (ibkrQuote.last !== null || ibkrQuote.bid !== null) {
          res.json({ ...ibkrQuote, source: "ibkr" });
          return;
        }
      } catch {
        // IBKR failed — fall through to Yahoo
      }
    }
    // Fallback to Yahoo
    const quote = await getQuote(symbol);
    res.json({ ...quote, source: "yahoo" });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/history/:symbol
router.get("/history/:symbol", async (req, res) => {
  try {
    const { symbol } = req.params;
    const period = qs(req.query.period, "3mo");
    const interval = qs(req.query.interval, "1d");
    const bars = await getHistoricalBars(symbol, period, interval);
    res.json({ symbol: symbol.toUpperCase(), count: bars.length, bars });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/details/:symbol
router.get("/details/:symbol", async (req, res) => {
  try {
    const details = await getStockDetails(req.params.symbol);
    res.json(details);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/options/:symbol
router.get("/options/:symbol", async (req, res) => {
  try {
    const expiration = qs(req.query.expiration, "");
    const chain = await getOptionsChain(req.params.symbol, expiration || undefined);
    res.json(chain);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/options/:symbol/quote
router.get("/options/:symbol/quote", async (req, res) => {
  try {
    const { symbol } = req.params;
    const expiry = qs(req.query.expiry, "");
    const strike = parseFloat(qs(req.query.strike, ""));
    const right = qs(req.query.right, "").toUpperCase() as "C" | "P";

    if (!expiry || isNaN(strike) || !right || (right !== "C" && right !== "P")) {
      res.status(400).json({
        error: "Required query params: expiry (YYYYMMDD), strike (number), right (C or P)",
      });
      return;
    }

    const quote = await getOptionQuote(symbol, expiry, strike, right);
    res.json(quote);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/search?q=...
router.get("/search", async (req, res) => {
  try {
    const query = qs(req.query.q, "");
    if (!query) {
      res.status(400).json({ error: "Required query param: q" });
      return;
    }
    const results = await searchSymbols(query);
    res.json({ count: results.length, results });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/news/:query
router.get("/news/:query", async (req, res) => {
  try {
    const news = await getNews(req.params.query);
    res.json({ count: news.length, articles: news });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/financials/:symbol
router.get("/financials/:symbol", async (req, res) => {
  try {
    const data = await getFinancials(req.params.symbol);
    res.json(data);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/earnings/:symbol
router.get("/earnings/:symbol", async (req, res) => {
  try {
    const data = await getEarnings(req.params.symbol);
    res.json(data);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/trending
router.get("/trending", async (req, res) => {
  try {
    const region = qs(req.query.region, "US");
    const data = await getTrendingSymbols(region);
    res.json(data);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/screener/filters
router.get("/screener/filters", (_req, res) => {
  res.json(getScreenerIds());
});

// POST /api/screener/run
router.post("/screener/run", async (req, res) => {
  try {
    const body = req.body ?? {};
    const count = typeof body.count === "number" ? Math.min(Math.max(1, body.count), 100) : 20;
    const results = await runScreener(body.screener_id, count);
    res.json({ count: results.length, results });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/screener/run-with-quotes
router.post("/screener/run-with-quotes", async (req, res) => {
  try {
    const body = req.body ?? {};
    const count = typeof body.count === "number" ? Math.min(Math.max(1, body.count), 100) : 20;
    const results = await runScreenerWithQuotes(body.screener_id, count);
    res.json({ count: results.length, results });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// --- IBKR Account Endpoints (require TWS/Gateway) ---

// GET /api/account/summary
router.get("/account/summary", async (_req, res) => {
  if (!isConnected()) {
    res.json({ error: "IBKR not connected. Start TWS/Gateway for account data." });
    return;
  }
  try {
    const summary = await getAccountSummary();
    res.json(summary);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/account/positions
router.get("/account/positions", async (_req, res) => {
  if (!isConnected()) {
    res.json({ error: "IBKR not connected. Start TWS/Gateway for position data." });
    return;
  }
  try {
    const positions = await getPositions();
    res.json({ count: positions.length, positions });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/account/pnl
router.get("/account/pnl", async (_req, res) => {
  if (!isConnected()) {
    res.json({ error: "IBKR not connected. Start TWS/Gateway for PnL data." });
    return;
  }
  try {
    const pnl = await getPnL();
    res.json(pnl);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/account/orders
router.get("/account/orders", async (_req, res) => {
  if (!isConnected()) {
    res.json({ error: "IBKR not connected. Start TWS/Gateway for order data." });
    return;
  }
  try {
    const orders = await getOpenOrders();
    res.json({ count: orders.length, orders });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/account/orders/completed
router.get("/account/orders/completed", async (_req, res) => {
  if (!isConnected()) {
    res.json({ error: "IBKR not connected. Start TWS/Gateway for order data." });
    return;
  }
  try {
    const orders = await getCompletedOrders();
    res.json({ count: orders.length, orders });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/account/executions
router.get("/account/executions", async (req, res) => {
  if (!isConnected()) {
    res.json({ error: "IBKR not connected. Start TWS/Gateway for execution data." });
    return;
  }
  try {
    const symbol = qs(req.query.symbol, "");
    const secType = qs(req.query.secType, "");
    const time = qs(req.query.time, "");
    const filter = symbol || secType || time
      ? { symbol: symbol || undefined, secType: secType || undefined, time: time || undefined }
      : undefined;
    const executions = await getExecutions(filter);
    res.json({ count: executions.length, executions });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/contract/:symbol
router.get("/contract/:symbol", async (req, res) => {
  if (!isConnected()) {
    res.json({ error: "IBKR not connected. Start TWS/Gateway for contract data." });
    return;
  }
  try {
    const details = await getContractDetails({
      symbol: req.params.symbol,
      secType: qs(req.query.secType, "") || undefined,
      exchange: qs(req.query.exchange, "") || undefined,
      currency: qs(req.query.currency, "") || undefined,
    });
    res.json({ count: details.length, contracts: details });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/ibkr/quote/:symbol
router.get("/ibkr/quote/:symbol", async (req, res) => {
  if (!isConnected()) {
    res.json({ error: "IBKR not connected. Start TWS/Gateway for market data." });
    return;
  }
  try {
    const quote = await getIBKRQuote({
      symbol: req.params.symbol,
      secType: qs(req.query.secType, "") || undefined,
      exchange: qs(req.query.exchange, "") || undefined,
      currency: qs(req.query.currency, "") || undefined,
    });
    res.json(quote);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// =====================================================================
// ORDER EXECUTION ENDPOINTS (IBKR — requires TWS/Gateway)
// =====================================================================

// POST /api/order — Place a single order
router.post("/order", async (req, res) => {
  if (!isConnected()) {
    res.json({ error: "IBKR not connected. Start TWS/Gateway to place orders." });
    return;
  }
  try {
    const { symbol, action, orderType, totalQuantity, lmtPrice, auxPrice, tif, secType, exchange, currency, strategy_version, journal_id } = req.body ?? {};
    if (!symbol || !action || !orderType || !totalQuantity) {
      res.status(400).json({ error: "Required: symbol, action, orderType, totalQuantity" });
      return;
    }
    const symErr = validateSymbol(symbol);
    if (symErr) { res.status(400).json({ error: symErr }); return; }
    if (!["BUY", "SELL"].includes(action)) {
      res.status(400).json({ error: "action must be BUY or SELL" }); return;
    }
    if (!["MKT", "LMT", "STP", "STP LMT"].includes(orderType)) {
      res.status(400).json({ error: "orderType must be MKT, LMT, STP, or STP LMT" }); return;
    }
    if (typeof totalQuantity !== "number" || !Number.isFinite(totalQuantity) || totalQuantity <= 0) {
      res.status(400).json({ error: "totalQuantity must be a positive number" }); return;
    }
    if (lmtPrice !== undefined && !isFinitePositive(lmtPrice)) {
      res.status(400).json({ error: "lmtPrice must be a positive number" }); return;
    }
    if (auxPrice !== undefined && !isFinitePositive(auxPrice)) {
      res.status(400).json({ error: "auxPrice must be a positive number" }); return;
    }
    // Pre-trade risk check
    const riskResult = checkRisk({ symbol, action, orderType, totalQuantity, lmtPrice, auxPrice, secType });
    if (!riskResult.allowed) {
      res.status(403).json({ error: `Risk gate rejected: ${riskResult.reason}` });
      return;
    }
    const result = await placeOrder({ symbol, action, orderType, totalQuantity, lmtPrice, auxPrice, tif, secType, exchange, currency, strategy_version, order_source: "rest", journal_id });
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/order/bracket — Place a bracket order (entry + TP + SL)
router.post("/order/bracket", async (req, res) => {
  if (!isConnected()) {
    res.json({ error: "IBKR not connected. Start TWS/Gateway to place orders." });
    return;
  }
  try {
    const { symbol, action, totalQuantity, entryType, entryPrice, takeProfitPrice, stopLossPrice, tif, secType, exchange, currency, strategy_version, journal_id } = req.body ?? {};
    if (!symbol || !action || !totalQuantity || !entryType || takeProfitPrice == null || stopLossPrice == null) {
      res.status(400).json({ error: "Required: symbol, action, totalQuantity, entryType, takeProfitPrice, stopLossPrice" });
      return;
    }
    const symErr = validateSymbol(symbol);
    if (symErr) { res.status(400).json({ error: symErr }); return; }
    if (!["BUY", "SELL"].includes(action)) {
      res.status(400).json({ error: "action must be BUY or SELL" }); return;
    }
    if (!["MKT", "LMT"].includes(entryType)) {
      res.status(400).json({ error: "entryType must be MKT or LMT" }); return;
    }
    if (typeof totalQuantity !== "number" || !Number.isFinite(totalQuantity) || totalQuantity <= 0) {
      res.status(400).json({ error: "totalQuantity must be a positive number" }); return;
    }
    if (!isFinitePositive(takeProfitPrice)) {
      res.status(400).json({ error: "takeProfitPrice must be a positive number" }); return;
    }
    if (!isFinitePositive(stopLossPrice)) {
      res.status(400).json({ error: "stopLossPrice must be a positive number" }); return;
    }
    if (entryPrice !== undefined && !isFinitePositive(entryPrice)) {
      res.status(400).json({ error: "entryPrice must be a positive number" }); return;
    }
    // Pre-trade risk check
    const riskResult = checkRisk({ symbol, action, orderType: entryType, totalQuantity, lmtPrice: entryPrice, secType });
    if (!riskResult.allowed) {
      res.status(403).json({ error: `Risk gate rejected: ${riskResult.reason}` });
      return;
    }
    const result = await placeBracketOrder({ symbol, action, totalQuantity, entryType, entryPrice, takeProfitPrice, stopLossPrice, tif, secType, exchange, currency, strategy_version, order_source: "rest", journal_id });
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/order/:orderId — Cancel a specific order
router.delete("/order/:orderId", async (req, res) => {
  if (!isConnected()) {
    res.json({ error: "IBKR not connected. Start TWS/Gateway to cancel orders." });
    return;
  }
  try {
    const orderId = parseInt(req.params.orderId, 10);
    if (isNaN(orderId)) {
      res.status(400).json({ error: "orderId must be a number" });
      return;
    }
    const result = await cancelOrder(orderId);
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/orders/all — Cancel ALL open orders
router.delete("/orders/all", async (_req, res) => {
  if (!isConnected()) {
    res.json({ error: "IBKR not connected. Start TWS/Gateway to cancel orders." });
    return;
  }
  try {
    const result = await cancelAllOrders();
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// =====================================================================
// SESSION GUARDRAILS
// =====================================================================

// GET /api/session — current session state (P&L, trade count, consecutive losses, limits)
router.get("/session", (_req, res) => {
  res.json(getSessionState());
});

// POST /api/session/trade — record a completed trade result (feeds session state)
router.post("/session/trade", (req, res) => {
  const { realized_pnl } = req.body ?? {};
  if (typeof realized_pnl !== "number" || !Number.isFinite(realized_pnl)) {
    res.status(400).json({ error: "realized_pnl must be a finite number" });
    return;
  }
  recordTradeResult(realized_pnl);
  res.json(getSessionState());
});

// POST /api/session/lock — manually lock the session ("I'm tilting")
router.post("/session/lock", (req, res) => {
  const { reason } = req.body ?? {};
  lockSession(reason);
  res.json(getSessionState());
});

// POST /api/session/unlock — unlock the session
router.post("/session/unlock", (_req, res) => {
  unlockSession();
  res.json(getSessionState());
});

// POST /api/session/reset — reset session state (new day or manual)
router.post("/session/reset", (_req, res) => {
  resetSession();
  res.json(getSessionState());
});

// =====================================================================
// TRADE JOURNAL + HISTORY (from SQLite)
// =====================================================================

// GET /api/journal — Query trade journal entries
router.get("/journal", (req, res) => {
  try {
    const symbol = qs(req.query.symbol, "") || undefined;
    const strategy = qs(req.query.strategy, "") || undefined;
    const limit = safeLimit(qs(req.query.limit, "") || undefined, 100);
    const entries = queryJournal({ symbol, strategy, limit });
    res.json({ count: (entries as any[]).length, entries });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/journal — Create a trade journal entry
router.post("/journal", (req, res) => {
  try {
    const body = req.body ?? {};
    if (!body.reasoning) {
      res.status(400).json({ error: "Required: reasoning" });
      return;
    }
    const id = insertJournalEntry(body);
    const entry = getJournalById(id);
    res.status(201).json(entry);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// PATCH /api/journal/:id — Update a journal entry (post-trade notes, outcome tags)
router.patch("/journal/:id", (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      res.status(400).json({ error: "id must be a number" });
      return;
    }
    const existing = getJournalById(id);
    if (!existing) {
      res.status(404).json({ error: "Journal entry not found" });
      return;
    }
    updateJournalEntry(id, req.body ?? {});
    res.json(getJournalById(id));
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/orders/history — Query historical orders from DB
router.get("/orders/history", (req, res) => {
  try {
    const symbol = qs(req.query.symbol, "") || undefined;
    const strategy = qs(req.query.strategy, "") || undefined;
    const limit = safeLimit(qs(req.query.limit, "") || undefined, 100);
    const orders = queryOrders({ symbol, strategy, limit });
    res.json({ count: (orders as any[]).length, orders });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/executions/history — Query historical executions from DB
router.get("/executions/history", (req, res) => {
  try {
    const symbol = qs(req.query.symbol, "") || undefined;
    const limit = safeLimit(qs(req.query.limit, "") || undefined, 100);
    const executions = queryExecutions({ symbol, limit });
    res.json({ count: (executions as any[]).length, executions });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// =====================================================================
// COLLABORATION CHANNEL (AI-to-AI communication)
// =====================================================================

// GET /api/collab/messages — Read conversation
router.get("/collab/messages", (req, res) => {
  try {
    const since = qs(req.query.since, "") || undefined;
    const author = qs(req.query.author, "") || undefined;
    const tag = qs(req.query.tag, "") || undefined;
    const limit = safeLimit(qs(req.query.limit, "") || undefined, 50, 100);

    if (author && !["claude", "chatgpt", "user"].includes(author)) {
      res.status(400).json({ error: "author must be 'claude', 'chatgpt', or 'user'" });
      return;
    }

    const msgs = readMessages({
      since,
      author: author as "claude" | "chatgpt" | "user" | undefined,
      tag,
      limit,
    });
    res.json({ count: msgs.length, messages: msgs });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/collab/message — Post a message
router.post("/collab/message", (req, res) => {
  try {
    const body = req.body ?? {};
    const { author, content, replyTo, tags } = body;

    if (!author || !["claude", "chatgpt", "user"].includes(author)) {
      res.status(400).json({ error: "author is required and must be 'claude', 'chatgpt', or 'user'" });
      return;
    }
    if (!content || typeof content !== "string") {
      res.status(400).json({ error: "content is required and must be a string" });
      return;
    }

    const msg = postMessage({ author, content, replyTo, tags });
    res.status(201).json(msg);
  } catch (e: any) {
    if (e.message.includes("limit") || e.message.includes("empty") || e.message.includes("not found")) {
      res.status(400).json({ error: e.message });
    } else {
      res.status(500).json({ error: e.message });
    }
  }
});

// DELETE /api/collab/messages — Clear conversation
router.delete("/collab/messages", (_req, res) => {
  try {
    const result = clearMessages();
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/collab/stats — Channel statistics
router.get("/collab/stats", (_req, res) => {
  res.json(getStats());
});
