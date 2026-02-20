import YahooFinance from "yahoo-finance2";
import { logger } from "../logging.js";

const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] });

// ─── Retry / Timeout / Rate Limit ────────────────────────────

const TIMEOUT_MS = 8000;
const MAX_RETRIES = 2;
const MIN_INTERVAL_MS = 500; // per-symbol cooldown

const lastCallPerSymbol = new Map<string, number>();

function rateLimit(key: string): void {
  const now = Date.now();
  const last = lastCallPerSymbol.get(key);
  if (last && now - last < MIN_INTERVAL_MS) {
    // no-op: don't block, just skip duplicate burst calls
  }
  lastCallPerSymbol.set(key, now);
  // Prune old entries every 100 inserts
  if (lastCallPerSymbol.size > 200) {
    const cutoff = now - 60000;
    for (const [k, t] of lastCallPerSymbol) {
      if (t < cutoff) lastCallPerSymbol.delete(k);
    }
  }
}

async function withTimeout<T>(promise: Promise<T>, ms: number = TIMEOUT_MS): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Yahoo request timed out after ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer!);
  }
}

async function yahooCall<T>(key: string, fn: () => Promise<T>): Promise<T> {
  rateLimit(key);
  let lastErr: Error | undefined;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await withTimeout(fn());
    } catch (e: any) {
      lastErr = e;
      const msg = e.message ?? "";
      // Don't retry on client errors (bad symbol, invalid params)
      if (msg.includes("Not Found") || msg.includes("Invalid") || msg.includes("no data")) {
        throw e;
      }
      if (attempt < MAX_RETRIES) {
        const delay = (attempt + 1) * 500; // 500ms, 1000ms
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }
  throw lastErr!;
}

// ─── Interfaces ───────────────────────────────────────────────

export interface QuoteData {
  symbol: string;
  bid: number | null;
  ask: number | null;
  last: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  volume: number | null;
  change: number | null;
  changePercent: number | null;
  marketCap: number | null;
  timestamp: string;
  /** When Yahoo last received this price from the exchange (ISO string). */
  marketTime: string | null;
  /** True if the data is delayed (Yahoo data is typically 15–20 min delayed). */
  delayed: boolean;
  /** Human-readable staleness context, e.g. "Yahoo Finance (15-20 min delayed)". */
  staleness_warning: string | null;
}

export interface BarData {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface OptionsChainData {
  symbol: string;
  expirations: string[];
  strikes: number[];
  calls: OptionContract[];
  puts: OptionContract[];
}

export interface OptionContract {
  contractSymbol: string;
  strike: number;
  expiration: string;
  type: "C" | "P";
  lastPrice: number | null;
  bid: number | null;
  ask: number | null;
  volume: number | null;
  openInterest: number | null;
  impliedVolatility: number | null;
  inTheMoney: boolean;
}

export interface StockDetails {
  symbol: string;
  longName: string | null;
  shortName: string | null;
  exchange: string | null;
  currency: string | null;
  quoteType: string | null;
  sector: string | null;
  industry: string | null;
  website: string | null;
  longBusinessSummary: string | null;
  fullTimeEmployees: number | null;
  marketCap: number | null;
  trailingPE: number | null;
  forwardPE: number | null;
  dividendYield: number | null;
  fiftyTwoWeekHigh: number | null;
  fiftyTwoWeekLow: number | null;
}

export interface SearchResult {
  symbol: string;
  shortName: string | null;
  longName: string | null;
  exchange: string | null;
  quoteType: string | null;
  sector: string | null;
  industry: string | null;
}

export interface NewsItem {
  title: string;
  publisher: string | null;
  link: string;
  publishedAt: string;
  relatedTickers: string[];
}

export interface FinancialsData {
  symbol: string;
  currentPrice: number | null;
  targetMeanPrice: number | null;
  targetHighPrice: number | null;
  targetLowPrice: number | null;
  recommendationKey: string | null;
  recommendationMean: number | null;
  numberOfAnalysts: number | null;
  totalRevenue: number | null;
  revenuePerShare: number | null;
  revenueGrowth: number | null;
  grossMargins: number | null;
  operatingMargins: number | null;
  profitMargins: number | null;
  ebitda: number | null;
  returnOnEquity: number | null;
  returnOnAssets: number | null;
  debtToEquity: number | null;
  freeCashflow: number | null;
  earningsGrowth: number | null;
  totalCash: number | null;
  totalDebt: number | null;
}

export interface EarningsData {
  symbol: string;
  earningsChart: Array<{
    quarter: string;
    actual: number | null;
    estimate: number | null;
  }>;
  financialsChart: {
    yearly: Array<{ date: number; revenue: number; earnings: number }>;
    quarterly: Array<{ date: string; revenue: number; earnings: number }>;
  } | null;
}

export interface RecommendationTrendData {
  symbol: string;
  trend: Array<{
    period: string;
    strongBuy: number;
    buy: number;
    hold: number;
    sell: number;
    strongSell: number;
  }>;
}

export interface ScreenerResult {
  rank: number;
  symbol: string;
  longName: string | null;
  last: number | null;
  change: number | null;
  changePercent: number | null;
  volume: number | null;
  marketCap: number | null;
  exchange: string | null;
}

export interface ScreenerResultWithQuote extends ScreenerResult {
  bid: number | null;
  ask: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  sector: string | null;
  industry: string | null;
  trailingPE: number | null;
  averageVolume: number | null;
}

// ─── Functions ────────────────────────────────────────────────

export async function getQuote(symbol: string): Promise<QuoteData> {
  const q = await yahooCall(symbol, () => yf.quote(symbol));
  const marketTime = q.regularMarketTime
    ? new Date(q.regularMarketTime instanceof Date ? q.regularMarketTime : (q.regularMarketTime as number) * 1000).toISOString()
    : null;
  return {
    symbol: q.symbol,
    bid: q.bid ?? null,
    ask: q.ask ?? null,
    last: q.regularMarketPrice ?? null,
    open: q.regularMarketOpen ?? null,
    high: q.regularMarketDayHigh ?? null,
    low: q.regularMarketDayLow ?? null,
    close: q.regularMarketPreviousClose ?? null,
    volume: q.regularMarketVolume ?? null,
    change: q.regularMarketChange ?? null,
    changePercent: q.regularMarketChangePercent ?? null,
    marketCap: q.marketCap ?? null,
    timestamp: new Date().toISOString(),
    marketTime,
    delayed: true,
    staleness_warning: "Yahoo Finance data is typically 15-20 min delayed. Connect IBKR TWS for real-time quotes.",
  };
}

export async function getHistoricalBars(
  symbol: string,
  period: string = "3mo",
  interval: string = "1d"
): Promise<BarData[]> {
  // Calculate period1 from period string
  const now = new Date();
  let period1: Date;
  const periodMap: Record<string, () => Date> = {
    "1d": () => new Date(now.getTime() - 1 * 86400000),
    "5d": () => new Date(now.getTime() - 5 * 86400000),
    "1mo": () => { const d = new Date(now); d.setMonth(d.getMonth() - 1); return d; },
    "3mo": () => { const d = new Date(now); d.setMonth(d.getMonth() - 3); return d; },
    "6mo": () => { const d = new Date(now); d.setMonth(d.getMonth() - 6); return d; },
    "1y": () => { const d = new Date(now); d.setFullYear(d.getFullYear() - 1); return d; },
    "2y": () => { const d = new Date(now); d.setFullYear(d.getFullYear() - 2); return d; },
    "5y": () => { const d = new Date(now); d.setFullYear(d.getFullYear() - 5); return d; },
    "10y": () => { const d = new Date(now); d.setFullYear(d.getFullYear() - 10); return d; },
    ytd: () => new Date(now.getFullYear(), 0, 1),
    max: () => new Date(1970, 0, 1),
  };

  const fn = periodMap[period];
  if (fn) {
    period1 = fn();
  } else {
    period1 = new Date(now);
    period1.setMonth(period1.getMonth() - 3);
  }

  const validIntervals = ["1m", "2m", "5m", "15m", "30m", "60m", "90m", "1h", "1d", "5d", "1wk", "1mo", "3mo"];
  const safeInterval = validIntervals.includes(interval) ? interval : "1d";

  const chart = await yahooCall(symbol, () =>
    yf.chart(symbol, {
      period1,
      period2: now,
      interval: safeInterval as any,
    })
  );

  return (chart.quotes ?? []).map((bar: any) => ({
    time: bar.date instanceof Date ? bar.date.toISOString() : String(bar.date),
    open: bar.open ?? 0,
    high: bar.high ?? 0,
    low: bar.low ?? 0,
    close: bar.close ?? 0,
    volume: bar.volume ?? 0,
  }));
}

export async function getOptionsChain(
  symbol: string,
  expiration?: string
): Promise<OptionsChainData> {
  const dateArg = expiration ? parseExpiration(expiration) : undefined;
  const opts = await yahooCall(symbol, () =>
    yf.options(symbol, dateArg ? { date: dateArg } : undefined)
  );

  const expirations = (opts.expirationDates ?? []).map((d: any) =>
    d instanceof Date ? formatYYYYMMDD(d) : String(d)
  );

  const strikes = opts.strikes ?? [];

  const calls: OptionContract[] = [];
  const puts: OptionContract[] = [];

  for (const chain of opts.options ?? []) {
    for (const c of chain.calls ?? []) {
      calls.push(mapOptionContract(c, "C"));
    }
    for (const p of chain.puts ?? []) {
      puts.push(mapOptionContract(p, "P"));
    }
  }

  return { symbol, expirations, strikes, calls, puts };
}

export async function getOptionQuote(
  symbol: string,
  expiry: string,
  strike: number,
  right: "C" | "P"
): Promise<QuoteData> {
  const normalizedExpiry = expiry.replace(/-/g, "");

  // Try with expiration filter first
  let chain = await getOptionsChain(symbol, normalizedExpiry);
  let contracts = right === "C" ? chain.calls : chain.puts;
  let match = contracts.find(
    (c) => c.expiration === normalizedExpiry && c.strike === strike
  );

  // Yahoo's date filter can miss due to epoch misalignment — retry unfiltered
  if (!match && contracts.length === 0) {
    logger.warn({ symbol, expiry: normalizedExpiry }, "Yahoo option date filter returned empty, retrying unfiltered");
    chain = await getOptionsChain(symbol);
    contracts = right === "C" ? chain.calls : chain.puts;
    match = contracts.find(
      (c) => c.expiration === normalizedExpiry && c.strike === strike
    );
  }

  if (!match) {
    // Build helpful error with available expirations
    const available = chain.expirations.slice(0, 5).join(", ");
    throw new Error(
      `No ${right === "C" ? "call" : "put"} found for ${symbol} ${normalizedExpiry} strike ${strike}. ` +
        (available ? `Available expirations: ${available}` : "No expirations returned by Yahoo.")
    );
  }

  // Final safety: verify the match is exactly what was requested
  if (match.expiration !== normalizedExpiry || match.strike !== strike) {
    throw new Error(
      `Option data mismatch: requested ${normalizedExpiry}/${strike} but got ${match.expiration}/${match.strike}`
    );
  }

  return {
    symbol: match.contractSymbol,
    bid: match.bid,
    ask: match.ask,
    last: match.lastPrice,
    open: null,
    high: null,
    low: null,
    close: null,
    volume: match.volume,
    change: null,
    changePercent: null,
    marketCap: null,
    timestamp: new Date().toISOString(),
    marketTime: null,
    delayed: true,
    staleness_warning: "Yahoo Finance option data is typically 15-20 min delayed.",
  };
}

export async function getStockDetails(symbol: string): Promise<StockDetails> {
  const [qs, q] = await Promise.all([
    yahooCall(symbol, () =>
      yf.quoteSummary(symbol, {
        modules: ["assetProfile", "summaryDetail", "price"],
      })
    ),
    yahooCall(symbol, () => yf.quote(symbol)),
  ]);

  const profile = qs.assetProfile;
  const detail = qs.summaryDetail;

  return {
    symbol,
    longName: q.longName ?? null,
    shortName: q.shortName ?? null,
    exchange: q.fullExchangeName ?? q.exchange ?? null,
    currency: q.currency ?? null,
    quoteType: q.quoteType ?? null,
    sector: profile?.sector ?? null,
    industry: profile?.industry ?? null,
    website: profile?.website ?? null,
    longBusinessSummary: profile?.longBusinessSummary ?? null,
    fullTimeEmployees: profile?.fullTimeEmployees ?? null,
    marketCap: q.marketCap ?? null,
    trailingPE: q.trailingPE ?? null,
    forwardPE: q.forwardPE ?? null,
    dividendYield: detail?.dividendYield ?? null,
    fiftyTwoWeekHigh: q.fiftyTwoWeekHigh ?? null,
    fiftyTwoWeekLow: q.fiftyTwoWeekLow ?? null,
  };
}

export async function searchSymbols(query: string): Promise<SearchResult[]> {
  const result = await yahooCall(query, () => yf.search(query));
  return (result.quotes ?? []).map((q: any) => ({
    symbol: q.symbol ?? "",
    shortName: q.shortname ?? null,
    longName: q.longname ?? null,
    exchange: q.exchDisp ?? q.exchange ?? null,
    quoteType: q.typeDisp ?? q.quoteType ?? null,
    sector: q.sectorDisp ?? q.sector ?? null,
    industry: q.industryDisp ?? q.industry ?? null,
  }));
}

export async function getNews(query: string): Promise<NewsItem[]> {
  const result = await yahooCall(query, () => yf.search(query));
  return (result.news ?? []).map((n: any) => ({
    title: n.title ?? "",
    publisher: n.publisher ?? null,
    link: n.link ?? "",
    publishedAt: n.providerPublishTime
      ? new Date(n.providerPublishTime).toISOString()
      : new Date().toISOString(),
    relatedTickers: n.relatedTickers ?? [],
  }));
}

export async function getFinancials(symbol: string): Promise<FinancialsData> {
  const qs = await yahooCall(symbol, () =>
    yf.quoteSummary(symbol, { modules: ["financialData"] })
  );

  const fd = qs.financialData;

  return {
    symbol,
    currentPrice: fd?.currentPrice ?? null,
    targetMeanPrice: fd?.targetMeanPrice ?? null,
    targetHighPrice: fd?.targetHighPrice ?? null,
    targetLowPrice: fd?.targetLowPrice ?? null,
    recommendationKey: fd?.recommendationKey ?? null,
    recommendationMean: fd?.recommendationMean ?? null,
    numberOfAnalysts: fd?.numberOfAnalystOpinions ?? null,
    totalRevenue: fd?.totalRevenue ?? null,
    revenuePerShare: fd?.revenuePerShare ?? null,
    revenueGrowth: fd?.revenueGrowth ?? null,
    grossMargins: fd?.grossMargins ?? null,
    operatingMargins: fd?.operatingMargins ?? null,
    profitMargins: fd?.profitMargins ?? null,
    ebitda: fd?.ebitda ?? null,
    returnOnEquity: fd?.returnOnEquity ?? null,
    returnOnAssets: fd?.returnOnAssets ?? null,
    debtToEquity: fd?.debtToEquity ?? null,
    freeCashflow: fd?.freeCashflow ?? null,
    earningsGrowth: fd?.earningsGrowth ?? null,
    totalCash: fd?.totalCash ?? null,
    totalDebt: fd?.totalDebt ?? null,
  };
}

export async function getEarnings(symbol: string): Promise<EarningsData> {
  const qs = await yahooCall(symbol, () =>
    yf.quoteSummary(symbol, { modules: ["earnings"] })
  );

  const e = qs.earnings;
  const earningsChart = (e?.earningsChart?.quarterly ?? []).map((q: any) => ({
    quarter: q.date ?? "",
    actual: q.actual ?? null,
    estimate: q.estimate ?? null,
  }));

  let financialsChart = null;
  if (e?.financialsChart) {
    financialsChart = {
      yearly: (e.financialsChart.yearly ?? []).map((y: any) => ({
        date: y.date ?? 0,
        revenue: y.revenue ?? 0,
        earnings: y.earnings ?? 0,
      })),
      quarterly: (e.financialsChart.quarterly ?? []).map((q: any) => ({
        date: q.date ?? "",
        revenue: q.revenue ?? 0,
        earnings: q.earnings ?? 0,
      })),
    };
  }

  return { symbol, earningsChart, financialsChart };
}

export async function getRecommendations(symbol: string): Promise<RecommendationTrendData> {
  const qs = await yahooCall(symbol, () =>
    yf.quoteSummary(symbol, { modules: ["recommendationTrend"] })
  );

  const trend = (qs.recommendationTrend?.trend ?? []).map((item: any) => ({
    period: item.period ?? "",
    strongBuy: item.strongBuy ?? 0,
    buy: item.buy ?? 0,
    hold: item.hold ?? 0,
    sell: item.sell ?? 0,
    strongSell: item.strongSell ?? 0,
  }));

  return { symbol, trend };
}

export async function getTrendingSymbols(
  region: string = "US"
): Promise<Array<{ symbol: string }>> {
  const result = await yahooCall(`trending:${region}`, () =>
    yf.trendingSymbols(region, { count: 20 })
  );
  return (result.quotes ?? []).map((q: any) => ({
    symbol: q.symbol ?? "",
  }));
}

// ─── Screener (replaces Finviz) ────────────────────────────────

const SCREENER_IDS: Record<string, string> = {
  day_gainers: "day_gainers",
  day_losers: "day_losers",
  most_actives: "most_actives",
  small_cap_gainers: "small_cap_gainers",
  undervalued_large_caps: "undervalued_large_caps",
  aggressive_small_caps: "aggressive_small_caps",
  growth_technology_stocks: "growth_technology_stocks",
};

export function getScreenerIds(): Record<string, string> {
  return {
    day_gainers: "Top daily percentage gainers",
    day_losers: "Top daily percentage losers",
    most_actives: "Most actively traded stocks by volume",
    small_cap_gainers: "Small cap stocks with upward momentum",
    undervalued_large_caps: "Large cap stocks trading below estimated value",
    aggressive_small_caps: "High-growth small cap stocks",
    growth_technology_stocks: "Technology stocks with strong growth",
  };
}

export async function runScreener(
  screenerId: string = "day_gainers",
  count: number = 20
): Promise<ScreenerResult[]> {
  const scrId = SCREENER_IDS[screenerId] ?? "day_gainers";
  const result = await yahooCall(`screener:${scrId}`, () =>
    yf.screener({ scrIds: scrId as any, count })
  );

  return (result.quotes ?? []).map((q: any, i: number) => ({
    rank: i + 1,
    symbol: q.symbol ?? "",
    longName: q.longName ?? q.shortName ?? null,
    last: q.regularMarketPrice ?? null,
    change: q.regularMarketChange ?? null,
    changePercent: q.regularMarketChangePercent ?? null,
    volume: q.regularMarketVolume ?? null,
    marketCap: q.marketCap ?? null,
    exchange: q.fullExchangeName ?? q.exchange ?? null,
  }));
}

export async function runScreenerWithQuotes(
  screenerId: string = "day_gainers",
  count: number = 20
): Promise<ScreenerResultWithQuote[]> {
  const scrId = SCREENER_IDS[screenerId] ?? "day_gainers";
  const result = await yahooCall(`screener:${scrId}`, () =>
    yf.screener({ scrIds: scrId as any, count })
  );

  return (result.quotes ?? []).map((q: any, i: number) => ({
    rank: i + 1,
    symbol: q.symbol ?? "",
    longName: q.longName ?? q.shortName ?? null,
    last: q.regularMarketPrice ?? null,
    change: q.regularMarketChange ?? null,
    changePercent: q.regularMarketChangePercent ?? null,
    volume: q.regularMarketVolume ?? null,
    marketCap: q.marketCap ?? null,
    exchange: q.fullExchangeName ?? q.exchange ?? null,
    bid: q.bid ?? null,
    ask: q.ask ?? null,
    open: q.regularMarketOpen ?? null,
    high: q.regularMarketDayHigh ?? null,
    low: q.regularMarketDayLow ?? null,
    close: q.regularMarketPreviousClose ?? null,
    sector: q.sector ?? null,
    industry: q.industry ?? null,
    trailingPE: q.trailingPE ?? null,
    averageVolume: q.averageDailyVolume3Month ?? null,
  }));
}

// ─── Helpers ──────────────────────────────────────────────────

function parseExpiration(expiry: string): Date {
  // Accept YYYYMMDD or YYYY-MM-DD — returns UTC midnight
  const clean = expiry.replace(/-/g, "");
  const y = parseInt(clean.substring(0, 4));
  const m = parseInt(clean.substring(4, 6)) - 1;
  const d = parseInt(clean.substring(6, 8));
  return new Date(Date.UTC(y, m, d));
}

function formatYYYYMMDD(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

function mapOptionContract(raw: any, type: "C" | "P"): OptionContract {
  return {
    contractSymbol: raw.contractSymbol ?? "",
    strike: raw.strike ?? 0,
    expiration: raw.expiration
      ? raw.expiration instanceof Date
        ? formatYYYYMMDD(raw.expiration)
        : String(raw.expiration)
      : "",
    type,
    lastPrice: raw.lastPrice ?? null,
    bid: raw.bid ?? null,
    ask: raw.ask ?? null,
    volume: raw.volume ?? null,
    openInterest: raw.openInterest ?? null,
    impliedVolatility: raw.impliedVolatility ?? null,
    inTheMoney: raw.inTheMoney ?? false,
  };
}
