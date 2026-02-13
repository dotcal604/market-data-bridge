import { EventName, ErrorCode, isNonFatalError, type NewsProvider } from "@stoqey/ib";
import { logger } from "../logging.js";
import { getIBKRClient, getNextReqId, isConnected } from "./connection.js";

const log = logger.child({ subsystem: "ibkr-news" });

const REQUEST_TIMEOUT_MS = 10000;
const BULLETIN_COLLECTION_MS = 3000;

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
