import { Router } from "express";
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
import { getOpenOrders, getCompletedOrders, getExecutions, placeOrder, placeBracketOrder, placeAdvancedBracket, modifyOrder, cancelOrder, cancelAllOrders, flattenAllPositions, validateOrder } from "../ibkr/orders.js";
import { computePortfolioExposure } from "../ibkr/portfolio.js";
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
import { getGptInstructions } from "./gpt-instructions.js";
import { checkRisk, getSessionState, recordTradeResult, lockSession, unlockSession, resetSession, getRiskGateConfig } from "../ibkr/risk-gate.js";
import { runPortfolioStressTest } from "../ibkr/portfolio.js";
import { calculatePositionSize } from "../ibkr/risk.js";
import { logger } from "../logging.js";
import { getOpenApiSpec } from "./openapi.js";
import { tuneRiskParams } from "../eval/risk-tuning.js";
import { RISK_CONFIG_DEFAULTS } from "../db/schema.js";
import {
  queryOrders,
  queryExecutions,
  queryJournal,
  insertJournalEntry,
  updateJournalEntry,
  getJournalById,
  upsertRiskConfig,
  queryAccountSnapshots,
} from "../db/database.js";

function qs(val: unknown, fallback: string): string {
  if (typeof val === "string") return val;
  return fallback;
}

/** Validate a stock/index symbol — alphanumeric, dots, hyphens, carets, max 20 chars */
const SYMBOL_RE = /^[A-Za-z0-9.\-^=%]{1,20}$/;
export function validateSymbol(symbol: string): string | null {
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
export const publicRouter = Router();
const log = logger.child({ subsystem: "rest-portfolio" });

publicRouter.get("/openapi.json", (_req, res) => {
  res.json(getOpenApiSpec());
});

const portfolioStressTestRequestSchema = z.object({
  shockPercent: z.number().finite(),
  betaAdjusted: z.boolean().default(true),
});

const historicalTicksQuerySchema = z.object({
  startTime: z.string().min(1, "startTime is required"),
  endTime: z.string().min(1, "endTime is required"),
  type: z.enum(["TRADES", "BID_ASK", "MIDPOINT"]).default("TRADES"),
  count: z.coerce.number().int().min(1).max(1000).default(1000),
});

const newsArticleParamsSchema = z.object({
  providerId: z.string().min(1, "providerId is required"),
  articleId: z.string().min(1, "articleId is required"),
});

const historicalNewsParamsSchema = z.object({
  symbol: z.string().min(1, "symbol is required"),
});

const historicalNewsQuerySchema = z.object({
  providerCodes: z.string().min(1, "providerCodes query param is required"),
  startDateTime: z.string().min(1, "startDateTime query param is required"),
  endDateTime: z.string().min(1, "endDateTime query param is required"),
  secType: z.string().optional(),
  exchange: z.string().optional(),
  currency: z.string().optional(),
});

const marketDataTypeSchema = z.object({
  marketDataType: z.number().int().min(1).max(4),
});

const autoOpenOrdersSchema = z.object({
  autoBind: z.boolean(),
});

const impliedVolatilitySchema = z.object({
  symbol: z.string().trim().min(1).max(20),
  expiry: z.string().regex(/^\d{8}$/),
  strike: z.number().positive(),
  right: z.enum(["C", "P"]),
  optionPrice: z.number().positive(),
  underlyingPrice: z.number().positive(),
});

const riskConfigUpdateSchema = z.object({
  max_position_pct: z.number().positive().max(RISK_CONFIG_DEFAULTS.max_position_pct).optional(),
  max_daily_loss_pct: z.number().positive().max(RISK_CONFIG_DEFAULTS.max_daily_loss_pct).optional(),
  max_concentration_pct: z.number().positive().max(RISK_CONFIG_DEFAULTS.max_concentration_pct).optional(),
  volatility_scalar: z.number().positive().max(RISK_CONFIG_DEFAULTS.volatility_scalar).optional(),
});

const optionPriceSchema = z.object({
  symbol: z.string().trim().min(1).max(20),
  expiry: z.string().regex(/^\d{8}$/),
  strike: z.number().positive(),
  right: z.enum(["C", "P"]),
  volatility: z.number().positive(),
  underlyingPrice: z.number().positive(),
});

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

// GET /api/data/historical-ticks/:symbol
router.get("/data/historical-ticks/:symbol", async (req, res) => {
  if (!isConnected()) {
    res.status(503).json({ error: "IBKR not connected. Start TWS/Gateway for historical tick data." });
    return;
  }

  const symErr = validateSymbol(req.params.symbol);
  if (symErr) {
    res.status(400).json({ error: symErr });
    return;
  }

  const parsedQuery = historicalTicksQuerySchema.safeParse(req.query);
  if (!parsedQuery.success) {
    res.status(400).json({ error: parsedQuery.error.issues[0]?.message ?? "Invalid query params" });
    return;
  }

  try {
    const ticks = await getHistoricalTicks(
      req.params.symbol.toUpperCase(),
      parsedQuery.data.startTime,
      parsedQuery.data.endTime,
      parsedQuery.data.type,
      parsedQuery.data.count
    );

    res.json({
      symbol: req.params.symbol.toUpperCase(),
      startTime: parsedQuery.data.startTime,
      endTime: parsedQuery.data.endTime,
      type: parsedQuery.data.type,
      count: ticks.length,
      ticks,
      source: "ibkr",
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Unknown error";
    res.status(500).json({ error: message });
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

// GET /api/news/providers
router.get("/news/providers", async (_req, res) => {
  if (!isConnected()) {
    res.json({ error: "IBKR not connected. Start TWS/Gateway for news provider data." });
    return;
  }
  try {
    const providers = await reqNewsProviders();
    res.json({ count: providers.length, providers });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/news/article/:providerId/:articleId
router.get("/news/article/:providerId/:articleId", async (req, res) => {
  if (!isConnected()) {
    res.json({ error: "IBKR not connected. Start TWS/Gateway for news articles." });
    return;
  }
  const parsedParams = newsArticleParamsSchema.safeParse(req.params);
  if (!parsedParams.success) {
    res.status(400).json({ error: parsedParams.error.issues[0]?.message ?? "Invalid path params" });
    return;
  }
  try {
    const article = await reqNewsArticle(parsedParams.data.providerId, parsedParams.data.articleId);
    res.json(article);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/news/history/:symbol
router.get("/news/history/:symbol", async (req, res) => {
  if (!isConnected()) {
    res.json({ error: "IBKR not connected. Start TWS/Gateway for historical news." });
    return;
  }
  const parsedParams = historicalNewsParamsSchema.safeParse(req.params);
  if (!parsedParams.success) {
    res.status(400).json({ error: parsedParams.error.issues[0]?.message ?? "Invalid path params" });
    return;
  }
  const parsedQuery = historicalNewsQuerySchema.safeParse({
    providerCodes: qs(req.query.providerCodes, ""),
    startDateTime: qs(req.query.startDateTime, ""),
    endDateTime: qs(req.query.endDateTime, ""),
    secType: qs(req.query.secType, "") || undefined,
    exchange: qs(req.query.exchange, "") || undefined,
    currency: qs(req.query.currency, "") || undefined,
  });
  if (!parsedQuery.success) {
    res.status(400).json({ error: parsedQuery.error.issues[0]?.message ?? "Invalid query params" });
    return;
  }
  try {
    const [contract] = await getContractDetails({
      symbol: parsedParams.data.symbol,
      secType: parsedQuery.data.secType,
      exchange: parsedQuery.data.exchange,
      currency: parsedQuery.data.currency,
    });
    if (!contract) {
      res.status(404).json({ error: `No contract found for symbol ${parsedParams.data.symbol}` });
      return;
    }
    const headlines = await reqHistoricalNews(
      contract.conId,
      parsedQuery.data.providerCodes,
      parsedQuery.data.startDateTime,
      parsedQuery.data.endDateTime
    );
    res.json({ symbol: parsedParams.data.symbol.toUpperCase(), conId: contract.conId, count: headlines.length, headlines });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/news/bulletins
router.get("/news/bulletins", async (_req, res) => {
  if (!isConnected()) {
    res.json({ error: "IBKR not connected. Start TWS/Gateway for news bulletins." });
    return;
  }
  try {
    const bulletins = await reqNewsBulletins();
    res.json({ count: bulletins.length, bulletins });
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

// GET /api/data/recommendations/:symbol
router.get("/data/recommendations/:symbol", async (req, res) => {
  try {
    const data = await getRecommendations(req.params.symbol);
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

// POST /api/portfolio/stress-test
router.post("/portfolio/stress-test", async (req, res) => {
  if (!isConnected()) {
    res.json({ error: "IBKR not connected. Start TWS/Gateway for portfolio stress test." });
    return;
  }

  const parsedBody = portfolioStressTestRequestSchema.safeParse(req.body ?? {});
  if (!parsedBody.success) {
    res.status(400).json({ error: parsedBody.error.issues[0]?.message ?? "Invalid request body" });
    return;
  }

  try {
    const result = await runPortfolioStressTest(parsedBody.data.shockPercent, parsedBody.data.betaAdjusted);
    res.json(result);
  } catch (e: any) {
    log.error({ err: e }, "Portfolio stress test failed");
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

// GET /api/account/pnl/intraday — Get today's account snapshots for equity curve
// Must be defined BEFORE /:symbol to avoid Express matching "intraday" as a symbol param
router.get("/account/pnl/intraday", (_req, res) => {
  try {
    const snapshots = queryAccountSnapshots(300) as Array<{ created_at: string; [k: string]: unknown }>;
    
    const now = new Date();
    const et = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
    const todayET = `${et.getFullYear()}-${String(et.getMonth() + 1).padStart(2, '0')}-${String(et.getDate()).padStart(2, '0')}`;
    
    const todaySnapshots = snapshots.filter((s) => {
      const snapshotDate = new Date(s.created_at);
      const snapshotET = new Date(snapshotDate.toLocaleString("en-US", { timeZone: "America/New_York" }));
      const snapshotDateStr = `${snapshotET.getFullYear()}-${String(snapshotET.getMonth() + 1).padStart(2, '0')}-${String(snapshotET.getDate()).padStart(2, '0')}`;
      return snapshotDateStr === todayET;
    });
    
    res.json({ snapshots: todaySnapshots, count: todaySnapshots.length });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Unknown error";
    res.status(500).json({ error: message });
  }
});

// GET /api/account/pnl/:symbol
router.get("/account/pnl/:symbol", async (req, res) => {
  if (!isConnected()) {
    res.status(503).json({ error: "IBKR not connected. Start TWS/Gateway for PnL data." });
    return;
  }

  const symbol = req.params.symbol;
  const symErr = validateSymbol(symbol);
  if (symErr) {
    res.status(400).json({ error: symErr });
    return;
  }

  try {
    const pnl = await reqPnLSingleBySymbol(symbol);
    res.json({ data: pnl });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Unknown error";
    res.status(500).json({ error: message });
  }
});

// GET /api/search/ibkr?q=...
router.get("/search/ibkr", async (req, res) => {
  if (!isConnected()) {
    res.status(503).json({ error: "IBKR not connected. Start TWS/Gateway for IBKR symbol search." });
    return;
  }

  const query = qs(req.query.q, "").trim();
  if (!query) {
    res.status(400).json({ error: "Required query param: q" });
    return;
  }

  try {
    const results = await reqMatchingSymbols(query);
    res.json({ data: { count: results.length, results } });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Unknown error";
    res.status(500).json({ error: message });
  }
});

// POST /api/config/market-data-type
router.post("/config/market-data-type", async (req, res) => {
  if (!isConnected()) {
    res.status(503).json({ error: "IBKR not connected. Start TWS/Gateway to set market data type." });
    return;
  }

  const parsed = marketDataTypeSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid request body" });
    return;
  }

  try {
    const result = await reqMarketDataType(parsed.data.marketDataType);
    res.json({ data: result });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Unknown error";
    res.status(500).json({ error: message });
  }
});

// POST /api/orders/auto-open
router.post("/orders/auto-open", async (req, res) => {
  if (!isConnected()) {
    res.status(503).json({ error: "IBKR not connected. Start TWS/Gateway to set auto-open orders." });
    return;
  }

  const parsed = autoOpenOrdersSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid request body" });
    return;
  }

  try {
    const result = await reqAutoOpenOrders(parsed.data.autoBind);
    res.json({ data: result });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Unknown error";
    res.status(500).json({ error: message });
  }
});

// GET /api/data/head-timestamp/:symbol
router.get("/data/head-timestamp/:symbol", async (req, res) => {
  if (!isConnected()) {
    res.status(503).json({ error: "IBKR not connected. Start TWS/Gateway for head timestamp data." });
    return;
  }
  const symbol = req.params.symbol;
  const symErr = validateSymbol(symbol);
  if (symErr) {
    res.status(400).json({ error: symErr });
    return;
  }
  const whatToShow = qs(req.query.whatToShow, "TRADES").toUpperCase();
  const useRTH = qs(req.query.useRTH, "true") !== "false";
  const formatDate = qs(req.query.formatDate, "1") === "2" ? 2 : 1;
  if (!["TRADES", "MIDPOINT", "BID", "ASK"].includes(whatToShow)) {
    res.status(400).json({ error: "whatToShow must be one of TRADES, MIDPOINT, BID, ASK" });
    return;
  }
  try {
    const data = await reqHeadTimestampBySymbol({ symbol, whatToShow: whatToShow as "TRADES" | "MIDPOINT" | "BID" | "ASK", useRTH, formatDate });
    res.json({ data });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Unknown error";
    res.status(500).json({ error: message });
  }
});

// GET /api/data/histogram/:symbol
router.get("/data/histogram/:symbol", async (req, res) => {
  if (!isConnected()) {
    res.status(503).json({ error: "IBKR not connected. Start TWS/Gateway for histogram data." });
    return;
  }
  const symbol = req.params.symbol;
  const symErr = validateSymbol(symbol);
  if (symErr) {
    res.status(400).json({ error: symErr });
    return;
  }
  const useRTH = qs(req.query.useRTH, "true") !== "false";
  const period = Number.parseInt(qs(req.query.period, "3"), 10);
  const periodUnit = qs(req.query.periodUnit, "D").toUpperCase();
  if (!Number.isFinite(period) || period <= 0) {
    res.status(400).json({ error: "period must be a positive integer" });
    return;
  }
  if (!["S", "D", "W", "M", "Y"].includes(periodUnit)) {
    res.status(400).json({ error: "periodUnit must be one of S, D, W, M, Y" });
    return;
  }
  try {
    const data = await reqHistogramDataBySymbol({ symbol, useRTH, period, periodUnit: periodUnit as "S" | "D" | "W" | "M" | "Y" });
    res.json({ data });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Unknown error";
    res.status(500).json({ error: message });
  }
});

router.post("/options/implied-vol", async (req, res) => {
  if (!isConnected()) {
    res.status(503).json({ error: "IBKR not connected. Start TWS/Gateway for option calculations." });
    return;
  }
  const parsed = impliedVolatilitySchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid request body" });
    return;
  }
  try {
    const data = await calculateImpliedVolatility(parsed.data);
    res.json({ data });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Unknown error";
    res.status(500).json({ error: message });
  }
});

router.post("/options/price", async (req, res) => {
  if (!isConnected()) {
    res.status(503).json({ error: "IBKR not connected. Start TWS/Gateway for option calculations." });
    return;
  }
  const parsed = optionPriceSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid request body" });
    return;
  }
  try {
    const data = await calculateOptionPrice(parsed.data);
    res.json({ data });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Unknown error";
    res.status(500).json({ error: message });
  }
});

router.get("/status/tws-time", async (_req, res) => {
  if (!isConnected()) {
    res.status(503).json({ error: "IBKR not connected. Start TWS/Gateway for TWS time." });
    return;
  }
  try {
    const data = await reqCurrentTime();
    res.json({ data });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Unknown error";
    res.status(500).json({ error: message });
  }
});

router.get("/data/market-rule/:ruleId", async (req, res) => {
  if (!isConnected()) {
    res.status(503).json({ error: "IBKR not connected. Start TWS/Gateway for market rule data." });
    return;
  }
  const ruleId = Number.parseInt(req.params.ruleId, 10);
  if (!Number.isFinite(ruleId) || ruleId <= 0) {
    res.status(400).json({ error: "ruleId must be a positive integer" });
    return;
  }
  try {
    const data = await reqMarketRule(ruleId);
    res.json({ data });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Unknown error";
    res.status(500).json({ error: message });
  }
});

router.get("/data/smart-components/:exchange", async (req, res) => {
  if (!isConnected()) {
    res.status(503).json({ error: "IBKR not connected. Start TWS/Gateway for smart components." });
    return;
  }
  const exchange = req.params.exchange.trim().toUpperCase();
  if (!exchange) {
    res.status(400).json({ error: "exchange is required" });
    return;
  }
  try {
    const data = await reqSmartComponents(exchange);
    res.json({ data });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Unknown error";
    res.status(500).json({ error: message });
  }
});

router.get("/data/depth-exchanges", async (_req, res) => {
  if (!isConnected()) {
    res.status(503).json({ error: "IBKR not connected. Start TWS/Gateway for depth exchange data." });
    return;
  }
  try {
    const data = await reqMktDepthExchanges();
    res.json({ data });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Unknown error";
    res.status(500).json({ error: message });
  }
});

router.get("/data/fundamentals/:symbol", async (req, res) => {
  if (!isConnected()) {
    res.status(503).json({ error: "IBKR not connected. Start TWS/Gateway for fundamental data." });
    return;
  }
  const symbol = req.params.symbol;
  const symErr = validateSymbol(symbol);
  if (symErr) {
    res.status(400).json({ error: symErr });
    return;
  }
  const reportType = qs(req.query.reportType, "ReportSnapshot");
  try {
    const data = await reqFundamentalDataBySymbol({ symbol, reportType });
    res.json({ data });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Unknown error";
    res.status(500).json({ error: message });
  }
});

// GET /api/portfolio/exposure
router.get("/portfolio/exposure", async (_req, res) => {
  if (!isConnected()) {
    res.status(503).json({ error: "IBKR not connected. Start TWS/Gateway for portfolio data." });
    return;
  }
  try {
    const exposure = await computePortfolioExposure();
    res.json(exposure);
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

// POST /api/order — Place a single order (any IBKR order type)
router.post("/order", async (req, res) => {
  if (!isConnected()) {
    res.json({ error: "IBKR not connected. Start TWS/Gateway to place orders." });
    return;
  }
  try {
    const body = req.body ?? {};
    const {
      symbol, action, orderType, totalQuantity,
      lmtPrice, auxPrice, tif, secType, exchange, currency,
      trailingPercent, trailStopPrice,
      ocaGroup, ocaType, parentId, transmit,
      goodAfterTime, goodTillDate, outsideRth, hidden, discretionaryAmt,
      algoStrategy, algoParams, account, hedgeType, hedgeParam,
      strategy_version, journal_id,
    } = body;

    // Structural validation
    const symErr = validateSymbol(symbol);
    if (symErr) { res.status(400).json({ error: symErr }); return; }

    const orderParams = {
      symbol, action, orderType, totalQuantity,
      lmtPrice, auxPrice, tif, secType, exchange, currency,
      trailingPercent, trailStopPrice,
      ocaGroup, ocaType, parentId, transmit,
      goodAfterTime, goodTillDate, outsideRth, hidden, discretionaryAmt,
      algoStrategy, algoParams, account, hedgeType, hedgeParam,
      strategy_version, order_source: "rest" as const, journal_id,
    };

    const validation = validateOrder(orderParams);
    if (!validation.valid) {
      res.status(400).json({ error: validation.errors.join("; ") });
      return;
    }

    // Pre-trade risk check
    const riskResult = checkRisk({ symbol, action, orderType, totalQuantity, lmtPrice, auxPrice, secType });
    if (!riskResult.allowed) {
      res.status(403).json({ error: `Risk gate rejected: ${riskResult.reason}` });
      return;
    }

    const result = await placeOrder(orderParams);
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

// POST /api/order/bracket-advanced — Bracket with trailing stop, OCA, any order types
router.post("/order/bracket-advanced", async (req, res) => {
  if (!isConnected()) {
    res.json({ error: "IBKR not connected. Start TWS/Gateway to place orders." });
    return;
  }
  try {
    const { symbol, action, quantity, entry, takeProfit, stopLoss, tif, outsideRth, secType, exchange, currency, strategy_version, journal_id } = req.body ?? {};
    if (!symbol || !action || !quantity || !entry || !takeProfit || !stopLoss) {
      res.status(400).json({ error: "Required: symbol, action, quantity, entry, takeProfit, stopLoss" });
      return;
    }
    const symErr = validateSymbol(symbol);
    if (symErr) { res.status(400).json({ error: symErr }); return; }
    if (!["BUY", "SELL"].includes(action)) {
      res.status(400).json({ error: "action must be BUY or SELL" }); return;
    }
    if (typeof quantity !== "number" || !Number.isFinite(quantity) || quantity <= 0) {
      res.status(400).json({ error: "quantity must be a positive number" }); return;
    }
    if (!entry.type) { res.status(400).json({ error: "entry.type is required" }); return; }
    if (!takeProfit.type || !takeProfit.price) { res.status(400).json({ error: "takeProfit.type and takeProfit.price are required" }); return; }
    if (!stopLoss.type) { res.status(400).json({ error: "stopLoss.type is required" }); return; }

    // Trailing stop validation
    if ((stopLoss.type === "TRAIL" || stopLoss.type === "TRAIL LIMIT")) {
      if (!stopLoss.trailingAmount && !stopLoss.trailingPercent) {
        res.status(400).json({ error: "TRAIL stop requires trailingAmount or trailingPercent" }); return;
      }
    }

    // Risk check on entry
    const riskResult = checkRisk({ symbol, action, orderType: entry.type, totalQuantity: quantity, lmtPrice: entry.price, secType });
    if (!riskResult.allowed) {
      res.status(403).json({ error: `Risk gate rejected: ${riskResult.reason}` });
      return;
    }

    const result = await placeAdvancedBracket({
      symbol, action, quantity, entry, takeProfit, stopLoss,
      tif, outsideRth, secType, exchange, currency,
      strategy_version, order_source: "rest", journal_id,
    });
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// PATCH /api/order/:orderId — Modify an existing order in-place (preserves bracket/OCA)
router.patch("/order/:orderId", async (req, res) => {
  if (!isConnected()) {
    res.json({ error: "IBKR not connected. Start TWS/Gateway to modify orders." });
    return;
  }
  try {
    const orderId = parseInt(req.params.orderId, 10);
    if (isNaN(orderId)) {
      res.status(400).json({ error: "orderId must be a number" });
      return;
    }
    const { lmtPrice, auxPrice, totalQuantity, orderType, tif, trailingPercent, trailStopPrice } = req.body;
    const result = await modifyOrder({ orderId, lmtPrice, auxPrice, totalQuantity, orderType, tif, trailingPercent, trailStopPrice });
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
// FLATTEN / EOD CLOSE-OUT
// =====================================================================

// POST /api/positions/flatten — immediately close all positions (MKT orders)
router.post("/positions/flatten", async (_req, res) => {
  if (!isConnected()) {
    res.json({ error: "IBKR not connected. Start TWS/Gateway to flatten." });
    return;
  }
  try {
    const result = await flattenAllPositions();
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/flatten/config — current flatten scheduler config
router.get("/flatten/config", (_req, res) => {
  res.json(getFlattenConfig());
});

// POST /api/flatten/enable — enable/disable auto-flatten
router.post("/flatten/enable", (req, res) => {
  const { enabled } = req.body ?? {};
  if (typeof enabled !== "boolean") {
    res.status(400).json({ error: "enabled must be a boolean" });
    return;
  }
  setFlattenEnabled(enabled);
  res.json(getFlattenConfig());
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

// GET /api/account/pnl/intraday — today's account snapshots for equity curve
router.get("/account/pnl/intraday", (_req, res) => {
  try {
    const now = new Date();
    const et = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
    const year = et.getFullYear();
    const month = String(et.getMonth() + 1).padStart(2, "0");
    const day = String(et.getDate()).padStart(2, "0");
    const todayStr = `${year}-${month}-${day}`;

    const snapshots = queryAccountSnapshots(1000);
    const todaySnapshots = (snapshots as any[]).filter((s) => {
      const createdStr = s.created_at.substring(0, 10); // "YYYY-MM-DD HH:MM:SS" -> "YYYY-MM-DD"
      return createdStr === todayStr;
    });

    res.json({ count: todaySnapshots.length, snapshots: todaySnapshots });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/risk/config — current persisted risk config + effective guardrail values
router.get("/risk/config", (_req, res) => {
  try {
    res.json(getRiskGateConfig());
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/risk/config — manual risk config updates
router.put("/risk/config", (req, res) => {
  const parsed = riskConfigUpdateSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid risk config payload" });
    return;
  }

  const entries = Object.entries(parsed.data)
    .filter(([, value]) => value !== undefined)
    .map(([param, value]) => ({ param, value: value as number, source: "manual" }));

  if (entries.length === 0) {
    res.status(400).json({ error: "At least one risk parameter must be provided" });
    return;
  }

  try {
    upsertRiskConfig(entries);
    res.json(getRiskGateConfig());
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/risk/tune — auto-tune risk config from recent outcomes
router.post("/risk/tune", (_req, res) => {
  try {
    const result = tuneRiskParams();
    res.json({ tune: result, config: getRiskGateConfig() });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/risk/size-position — calculate position size based on risk parameters
router.post("/risk/size-position", async (req, res) => {
  if (!isConnected()) {
    res.json({ error: "IBKR not connected. Start TWS/Gateway for account data." });
    return;
  }
  try {
    const { symbol, entryPrice, stopPrice, riskPercent, riskAmount, maxCapitalPercent } = req.body ?? {};
    
    // Validate required fields
    if (!symbol) {
      res.status(400).json({ error: "symbol is required" });
      return;
    }
    const symErr = validateSymbol(symbol);
    if (symErr) {
      res.status(400).json({ error: symErr });
      return;
    }
    if (typeof entryPrice !== "number" || !Number.isFinite(entryPrice) || entryPrice <= 0) {
      res.status(400).json({ error: "entryPrice must be a positive number" });
      return;
    }
    if (typeof stopPrice !== "number" || !Number.isFinite(stopPrice) || stopPrice < 0) {
      res.status(400).json({ error: "stopPrice must be a non-negative number" });
      return;
    }
    if (riskPercent !== undefined && (typeof riskPercent !== "number" || !Number.isFinite(riskPercent) || riskPercent <= 0 || riskPercent > 100)) {
      res.status(400).json({ error: "riskPercent must be a positive number between 0 (exclusive) and 100" });
      return;
    }
    if (riskAmount !== undefined && (typeof riskAmount !== "number" || !Number.isFinite(riskAmount) || riskAmount <= 0)) {
      res.status(400).json({ error: "riskAmount must be a positive number" });
      return;
    }
    if (maxCapitalPercent !== undefined && (typeof maxCapitalPercent !== "number" || !Number.isFinite(maxCapitalPercent) || maxCapitalPercent <= 0 || maxCapitalPercent > 100)) {
      res.status(400).json({ error: "maxCapitalPercent must be between 0 and 100" });
      return;
    }

    const { volatilityRegime } = req.body ?? {};
    const result = await calculatePositionSize({ symbol, entryPrice, stopPrice, riskPercent, riskAmount, maxCapitalPercent, volatilityRegime });
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
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

// GET /api/journal/:id — Get a specific journal entry by ID
router.get("/journal/:id", (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      res.status(400).json({ error: "id must be a number" });
      return;
    }
    const entry = getJournalById(id);
    if (!entry) {
      res.status(404).json({ error: "Journal entry not found" });
      return;
    }
    res.json(entry);
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

// GET /api/gpt-instructions — Dynamic GPT system prompt (auto-synced on every conversation)
router.get("/gpt-instructions", (_req, res) => {
  res.json({
    role: "system",
    instructions: getGptInstructions(),
  });
});

// =====================================================================
// STREAMING SUBSCRIPTIONS
// =====================================================================

// POST /api/subscriptions/real-time-bars — Start 5s bar stream
router.post("/subscriptions/real-time-bars", (req, res) => {
  if (!isConnected()) { res.status(503).json({ error: "IBKR not connected" }); return; }
  try {
    const info = subscribeRealTimeBars(req.body ?? {});
    res.status(201).json(info);
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

// DELETE /api/subscriptions/real-time-bars/:id — Cancel bar stream
router.delete("/subscriptions/real-time-bars/:id", (req, res) => {
  const removed = unsubscribeRealTimeBars(req.params.id);
  res.json({ removed });
});

// GET /api/subscriptions/real-time-bars/:id/bars — Poll buffered bars
router.get("/subscriptions/real-time-bars/:id/bars", (req, res) => {
  try {
    const limit = Math.min(parseInt(qs(req.query.limit, "60"), 10) || 60, 300);
    const bars = getRealTimeBars(req.params.id, limit);
    res.json({ subscriptionId: req.params.id, count: bars.length, bars });
  } catch (e: any) {
    res.status(404).json({ error: e.message });
  }
});

// POST /api/subscriptions/account-updates — Start account stream
router.post("/subscriptions/account-updates", (req, res) => {
  if (!isConnected()) { res.status(503).json({ error: "IBKR not connected" }); return; }
  try {
    const { account } = req.body ?? {};
    if (!account) { res.status(400).json({ error: "account is required" }); return; }
    const info = subscribeAccountUpdates(account);
    res.status(201).json(info);
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

// DELETE /api/subscriptions/account-updates — Cancel account stream
router.delete("/subscriptions/account-updates", (_req, res) => {
  const removed = unsubscribeAccountUpdates();
  res.json({ removed });
});

// GET /api/subscriptions/account-updates/snapshot — Poll account data
router.get("/subscriptions/account-updates/snapshot", (_req, res) => {
  const snapshot = getAccountSnapshot();
  if (!snapshot) { res.status(404).json({ error: "No active account updates subscription" }); return; }
  res.json(snapshot);
});

// GET /api/subscriptions/scanner-parameters — Cached scanner params XML
router.get("/subscriptions/scanner-parameters", async (_req, res) => {
  if (!isConnected()) { res.status(503).json({ error: "IBKR not connected" }); return; }
  try {
    const xml = await getScannerParameters();
    res.type("application/xml").send(xml);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/subscriptions — List all active subscriptions
router.get("/subscriptions", (_req, res) => {
  const subs = listSubscriptions();
  res.json({ count: subs.length, subscriptions: subs });
});
