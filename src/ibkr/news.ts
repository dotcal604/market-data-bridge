import { EventName, ErrorCode, isNonFatalError, type NewsProvider } from "@stoqey/ib";
import { logger } from "../logging.js";
import { getIBKRClient, getNextReqId, isConnected } from "./connection.js";

const log = logger.child({ subsystem: "ibkr-news" });

const REQUEST_TIMEOUT_MS = 10000;
const BULLETIN_COLLECTION_MS = 3000;

/**
 * Known Benzinga provider codes for IBKR.
 * "BZ" is the standard code; "BZNY" is the Benzinga New York variant.
 * The actual available code depends on the user's IBKR subscription.
 */
export const BENZINGA_PROVIDER_CODES = ["BZ", "BZNY"] as const;
export const BENZINGA_DEFAULT_CODE = "BZ";

export interface NewsProviderData {
  code: string;
  name: string;
}

export interface NewsArticleData {
  providerCode: string;
  articleId: string;
  articleType: number;
  articleText: string;
}

export interface HistoricalNewsHeadline {
  time: string;
  providerCode: string;
  articleId: string;
  headline: string;
}

export interface NewsBulletinData {
  msgId: number;
  msgType: number;
  message: string;
  originatingExchange: string;
}

function ensureConnected(): void {
  if (!isConnected()) {
    throw new Error("IBKR not connected. Start TWS/Gateway for news data.");
  }
}

/**
 * Fetch available news providers.
 * @returns Promise resolving to list of news providers
 */
export async function reqNewsProviders(): Promise<NewsProviderData[]> {
  ensureConnected();
  const ib = getIBKRClient();

  return new Promise((resolve, reject) => {
    let settled = false;

    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error("News providers request timed out"));
    }, REQUEST_TIMEOUT_MS);

    const onProviders = (providers: NewsProvider[]) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(providers.map((provider) => ({ code: provider.providerCode ?? "", name: provider.providerName ?? "" })));
    };

    const onError = (err: Error, code: ErrorCode) => {
      if (isNonFatalError(code, err)) return;
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error(`News providers error (${code}): ${err.message}`));
    };

    const cleanup = () => {
      clearTimeout(timeout);
      ib.off(EventName.newsProviders, onProviders);
      ib.off(EventName.error, onError);
    };

    ib.on(EventName.newsProviders, onProviders);
    ib.on(EventName.error, onError);

    ib.reqNewsProviders();
  });
}

/**
 * Fetch a specific news article.
 * @param providerCode Provider code (e.g. "BRFG")
 * @param articleId Article ID
 * @returns Promise resolving to article data
 */
export async function reqNewsArticle(providerCode: string, articleId: string): Promise<NewsArticleData> {
  ensureConnected();
  const ib = getIBKRClient();
  const reqId = getNextReqId();

  return new Promise((resolve, reject) => {
    let settled = false;

    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error("News article request timed out"));
    }, REQUEST_TIMEOUT_MS);

    const onArticle = (id: number, articleType: number, articleText: string) => {
      if (id !== reqId) return;
      if (settled) return;
      settled = true;
      cleanup();
      resolve({ providerCode, articleId, articleType, articleText });
    };

    const onError = (err: Error, code: ErrorCode, id: number) => {
      if (id !== reqId) return;
      if (isNonFatalError(code, err)) return;
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error(`News article error (${code}): ${err.message}`));
    };

    const cleanup = () => {
      clearTimeout(timeout);
      ib.off(EventName.newsArticle, onArticle);
      ib.off(EventName.error, onError);
    };

    ib.on(EventName.newsArticle, onArticle);
    ib.on(EventName.error, onError);

    ib.reqNewsArticle(reqId, providerCode, articleId);
  });
}

/**
 * Fetch historical news headlines for a contract.
 * @param conId Contract ID
 * @param providerCodes Comma-separated provider codes
 * @param startDateTime Start time (YYYY-MM-DD HH:mm:ss)
 * @param endDateTime End time (YYYY-MM-DD HH:mm:ss)
 * @returns Promise resolving to list of headlines
 */
export async function reqHistoricalNews(
  conId: number,
  providerCodes: string,
  startDateTime: string,
  endDateTime: string
): Promise<HistoricalNewsHeadline[]> {
  ensureConnected();
  const ib = getIBKRClient();
  const reqId = getNextReqId();

  return new Promise((resolve, reject) => {
    let settled = false;
    const headlines: HistoricalNewsHeadline[] = [];

    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error("Historical news request timed out"));
    }, REQUEST_TIMEOUT_MS);

    const onHeadline = (
      id: number,
      time: string,
      providerCode: string,
      articleId: string,
      headline: string
    ) => {
      if (id !== reqId) return;
      headlines.push({ time, providerCode, articleId, headline });
    };

    const onEnd = (id: number) => {
      if (id !== reqId) return;
      if (settled) return;
      settled = true;
      cleanup();
      resolve(headlines);
    };

    const onError = (err: Error, code: ErrorCode, id: number) => {
      if (id !== reqId) return;
      if (isNonFatalError(code, err)) return;
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error(`Historical news error (${code}): ${err.message}`));
    };

    const cleanup = () => {
      clearTimeout(timeout);
      ib.off(EventName.historicalNews, onHeadline);
      ib.off(EventName.historicalNewsEnd, onEnd);
      ib.off(EventName.error, onError);
    };

    ib.on(EventName.historicalNews, onHeadline);
    ib.on(EventName.historicalNewsEnd, onEnd);
    ib.on(EventName.error, onError);

    ib.reqHistoricalNews(reqId, conId, providerCodes, startDateTime, endDateTime, 50);
  });
}

/**
 * Subscribe to IBKR news bulletins.
 * @returns Promise resolving to initial list of bulletins
 */
export async function reqNewsBulletins(): Promise<NewsBulletinData[]> {
  ensureConnected();
  const ib = getIBKRClient();

  return new Promise((resolve, reject) => {
    let settled = false;
    const bulletins: NewsBulletinData[] = [];

    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      ib.cancelNewsBulletins();
      reject(new Error("News bulletins request timed out"));
    }, REQUEST_TIMEOUT_MS);

    const collectionWindow = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      ib.cancelNewsBulletins();
      resolve(bulletins);
    }, BULLETIN_COLLECTION_MS);

    const onBulletin = (msgId: number, msgType: number, message: string, originatingExchange: string) => {
      bulletins.push({ msgId, msgType, message, originatingExchange });
    };

    const onError = (err: Error, code: ErrorCode) => {
      if (isNonFatalError(code, err)) return;
      if (settled) return;
      settled = true;
      cleanup();
      ib.cancelNewsBulletins();
      reject(new Error(`News bulletins error (${code}): ${err.message}`));
    };

    const cleanup = () => {
      clearTimeout(timeout);
      clearTimeout(collectionWindow);
      ib.off(EventName.updateNewsBulletin, onBulletin);
      ib.off(EventName.error, onError);
    };

    ib.on(EventName.updateNewsBulletin, onBulletin);
    ib.on(EventName.error, onError);

    log.info("Subscribing to IBKR news bulletins");
    ib.reqNewsBulletins(true);
  });
}

// =====================================================================
// BENZINGA CONVENIENCE FUNCTIONS
// =====================================================================

/**
 * Detect which Benzinga provider code is available in the user's IBKR subscription.
 * Caches the result for the session lifetime.
 */
let cachedBenzingaCode: string | null = null;

export async function detectBenzingaProvider(): Promise<string> {
  if (cachedBenzingaCode) return cachedBenzingaCode;

  const providers = await reqNewsProviders();
  const providerCodes = providers.map((p) => p.code.toUpperCase());

  for (const code of BENZINGA_PROVIDER_CODES) {
    if (providerCodes.includes(code)) {
      cachedBenzingaCode = code;
      log.info({ code }, "Benzinga provider detected");
      return code;
    }
  }

  // Log available providers to help debug
  log.warn(
    { available: providerCodes },
    "No Benzinga provider found — check IBKR subscription"
  );
  throw new Error(
    `Benzinga provider not found. Available providers: ${providers
      .map((p) => `${p.code} (${p.name})`)
      .join(", ")}. Ensure Benzinga is enabled in your IBKR account.`
  );
}

/**
 * Fetch Benzinga news headlines for a contract.
 * Auto-detects the Benzinga provider code from the subscription.
 *
 * @param conId Contract ID
 * @param startDateTime Start time (YYYYMMDD-HH:mm:ss format)
 * @param endDateTime End time (YYYYMMDD-HH:mm:ss format)
 * @returns Promise resolving to Benzinga headlines
 */
export async function reqBenzingaNews(
  conId: number,
  startDateTime: string,
  endDateTime: string
): Promise<HistoricalNewsHeadline[]> {
  const providerCode = await detectBenzingaProvider();
  return reqHistoricalNews(conId, providerCode, startDateTime, endDateTime);
}

/**
 * Fetch a Benzinga article by article ID.
 * Auto-detects the Benzinga provider code from the subscription.
 *
 * @param articleId Article ID from Benzinga headlines
 * @returns Promise resolving to article data
 */
export async function reqBenzingaArticle(
  articleId: string
): Promise<NewsArticleData> {
  const providerCode = await detectBenzingaProvider();
  return reqNewsArticle(providerCode, articleId);
}

/**
 * Build IBKR datetime strings for a lookback window.
 * @param hoursBack Number of hours to look back (default: 24)
 * @returns { startDateTime, endDateTime } in YYYYMMDD-HH:mm:ss format
 */
export function buildNewsDateRange(hoursBack: number = 24): {
  startDateTime: string;
  endDateTime: string;
} {
  const now = new Date();
  const start = new Date(now.getTime() - hoursBack * 60 * 60 * 1000);

  const fmt = (d: Date) =>
    `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(
      d.getDate()
    ).padStart(2, "0")}-${String(d.getHours()).padStart(2, "0")}:${String(
      d.getMinutes()
    ).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;

  return { startDateTime: fmt(start), endDateTime: fmt(now) };
}
