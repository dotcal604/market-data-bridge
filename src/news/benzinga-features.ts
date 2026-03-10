import { getDb } from "../db/database.js";

export interface NewsFeatures {
  has_news: boolean;
  news_count_24h: number;
  news_recency_min: number | null;
  has_earnings_news: boolean;
  has_analyst_news: boolean;
  news_velocity: number;
  multi_source: boolean;
  pre_market_news: boolean;
}

export interface TradeWithFeatures {
  holly_alert_id: number;
  symbol: string;
  alert_time: string;
  strategy: string | null;
  features: NewsFeatures;
}

/**
 * Compute the 8 news features for a single trade.
 * Looks back 24 hours from entry_time_utc for Benzinga articles.
 */
export function computeNewsFeatures(
  symbol: string,
  entryTimeUtc: string
): NewsFeatures {
  const db = getDb();

  // Query articles published within 24h before entry, strictly <= entry time
  const articles = db
    .prepare(
      `SELECT n.*, n.channels_json, n.tags_json, n.publisher
       FROM benzinga_news n
       JOIN benzinga_news_tickers t ON t.benzinga_id = n.benzinga_id
       WHERE t.symbol = ?
         AND n.published_utc <= ?
         AND n.published_utc >= datetime(?, '-24 hours')
       ORDER BY n.published_utc DESC`
    )
    .all(symbol, entryTimeUtc, entryTimeUtc) as Array<{
    published_utc: string;
    channels_json: string | null;
    tags_json: string | null;
    publisher: string | null;
  }>;

  const newsCount = articles.length;

  if (newsCount === 0) {
    return {
      has_news: false,
      news_count_24h: 0,
      news_recency_min: null,
      has_earnings_news: false,
      has_analyst_news: false,
      news_velocity: 0,
      multi_source: false,
      pre_market_news: false,
    };
  }

  // Recency: minutes between most recent article and entry
  const entryMs = new Date(entryTimeUtc).getTime();
  const mostRecentMs = new Date(articles[0].published_utc).getTime();
  const recencyMin = (entryMs - mostRecentMs) / 60_000;

  // Check channels/tags for earnings and analyst content
  let hasEarnings = false;
  let hasAnalyst = false;
  let hasPreMarket = false;
  const publishers = new Set<string>();

  for (const article of articles) {
    // Collect publishers for multi_source check
    if (article.publisher) publishers.add(article.publisher);

    // Parse channels and tags
    const channels: string[] = article.channels_json
      ? JSON.parse(article.channels_json)
      : [];
    const tags: string[] = article.tags_json
      ? JSON.parse(article.tags_json)
      : [];
    const allLabels = [...channels, ...tags].map((l) => l.toLowerCase());

    if (allLabels.some((l) => l.includes("earning"))) hasEarnings = true;
    if (allLabels.some((l) => l.includes("analyst") || l.includes("rating")))
      hasAnalyst = true;

    // Pre-market check: published between 04:00-09:30 ET on entry date
    // We approximate by checking 09:00-14:30 UTC (EST) / 08:00-13:30 UTC (EDT)
    // Simplified: check if hour is between 8 and 14 UTC
    const pubDate = new Date(article.published_utc);
    const pubHour = pubDate.getUTCHours();
    const pubMin = pubDate.getUTCMinutes();
    const utcMinutes = pubHour * 60 + pubMin;
    // 04:00 ET = 09:00 UTC (EST) or 08:00 UTC (EDT)
    // 09:30 ET = 14:30 UTC (EST) or 13:30 UTC (EDT)
    // Conservative: 08:00-14:30 UTC covers both
    if (utcMinutes >= 480 && utcMinutes <= 870) {
      hasPreMarket = true;
    }
  }

  return {
    has_news: true,
    news_count_24h: newsCount,
    news_recency_min: Math.round(recencyMin * 100) / 100,
    has_earnings_news: hasEarnings,
    has_analyst_news: hasAnalyst,
    news_velocity: Math.round((newsCount / 24) * 1000) / 1000,
    multi_source: publishers.size > 1,
    pre_market_news: hasPreMarket,
  };
}

/**
 * Compute news features for all Holly trades.
 * Returns features joined with trade data.
 */
export function computeAllTradeFeatures(
  startDate: string = "2021-01-01"
): TradeWithFeatures[] {
  const db = getDb();

  const trades = db
    .prepare(
      `SELECT id, symbol, alert_time, strategy
       FROM holly_alerts
       WHERE DATE(alert_time) >= ?
       ORDER BY alert_time ASC`
    )
    .all(startDate) as Array<{
    id: number;
    symbol: string;
    alert_time: string;
    strategy: string | null;
  }>;

  const results: TradeWithFeatures[] = [];

  for (const trade of trades) {
    // For now, use alert_time as-is (will need UTC normalization in production)
    const features = computeNewsFeatures(trade.symbol, trade.alert_time);
    results.push({
      holly_alert_id: trade.id,
      symbol: trade.symbol,
      alert_time: trade.alert_time,
      strategy: trade.strategy,
      features,
    });
  }

  return results;
}
