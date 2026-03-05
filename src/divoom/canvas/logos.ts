/**
 * Logo Fetch & Cache — loads company logos for sector treemap backgrounds.
 *
 * Uses Google Favicon API: https://www.google.com/s2/favicons?domain=...&sz=128
 * Free, no auth, reliable. Returns best-available favicon (up to 128×128).
 *
 * Clearbit (logo.clearbit.com) was shut down after HubSpot acquisition.
 *
 * Returns @napi-rs/canvas Image objects that DrawContext.drawImage() can render.
 * Logos are fetched once and cached in-memory. Failed fetches are cached as null
 * to avoid repeated network hits.
 */

import { loadImage, type Image } from "@napi-rs/canvas";

// ─── Ticker → Domain Mapping ────────────────────────────────

/** Well-known sector leaders mapped to their corporate domains */
const TICKER_DOMAINS: Record<string, string> = {
  // TECH
  AAPL: "apple.com",
  MSFT: "microsoft.com",
  NVDA: "nvidia.com",
  GOOGL: "google.com",
  META: "meta.com",
  // HLTH
  UNH: "unitedhealthgroup.com",
  JNJ: "jnj.com",
  LLY: "lilly.com",
  // FINL
  JPM: "jpmorganchase.com",
  V: "visa.com",
  BRK: "berkshirehathaway.com",
  // INDU
  CAT: "caterpillar.com",
  GE: "ge.com",
  HON: "honeywell.com",
  // CONS
  AMZN: "amazon.com",
  TSLA: "tesla.com",
  HD: "homedepot.com",
  // ENER
  XOM: "exxonmobil.com",
  CVX: "chevron.com",
  // UTIL
  NEE: "nexteraenergy.com",
  SO: "southerncompany.com",
  // REAL
  PLD: "prologis.com",
  AMT: "americantower.com",
  // MATL
  LIN: "linde.com",
  APD: "airproducts.com",
  // COMM
  GOOG: "google.com",
  DIS: "disney.com",
  NFLX: "netflix.com",
  // STPL
  PG: "pg.com",
  KO: "coca-cola.com",
  WMT: "walmart.com",
};

// ─── Cache ──────────────────────────────────────────────────

const cache = new Map<string, Image | null>();

/**
 * Fetch a company logo by ticker symbol.
 * Returns an Image ready for drawImage(), or null if unavailable.
 * Results are cached — safe to call repeatedly.
 */
export async function fetchLogo(ticker: string): Promise<Image | null> {
  const key = ticker.toUpperCase();
  if (cache.has(key)) return cache.get(key) ?? null;

  const domain = TICKER_DOMAINS[key];
  if (!domain) {
    cache.set(key, null);
    return null;
  }

  try {
    const url = `https://www.google.com/s2/favicons?domain=${domain}&sz=128`;
    const img = await loadImage(url);
    cache.set(key, img);
    return img;
  } catch {
    cache.set(key, null);
    return null;
  }
}

/**
 * Fetch logos for multiple tickers in parallel.
 * Returns a Map<ticker, Image> (only successful fetches).
 */
export async function fetchLogos(tickers: string[]): Promise<Map<string, Image>> {
  const results = new Map<string, Image>();
  const promises = tickers.map(async (ticker) => {
    const img = await fetchLogo(ticker);
    if (img) results.set(ticker.toUpperCase(), img);
  });
  await Promise.all(promises);
  return results;
}
