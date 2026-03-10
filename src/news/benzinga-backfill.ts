import { getDb } from "../db/database.js";
import { BenzingaClient, type BenzingaQueryParams } from "./benzinga-client.js";
import { ingestArticles } from "./benzinga-storage.js";
import type { BenzingaArticle } from "./benzinga-schema.js";

export interface BackfillDay {
  tradeDate: string;
  symbols: string[];
}

export interface BackfillProgress {
  date: string;
  symbolsFetched: number;
  articlesFound: number;
  apiCalls: number;
}

export interface BackfillOptions {
  apiKey: string;
  batchSize?: number;
  dryRun?: boolean;
  onProgress?: (progress: BackfillProgress) => void;
  rateLimitRpm?: number;
}

/**
 * Query Holly trade dates and unique symbols per date from the database.
 * Returns only dates >= startDate (ISO format YYYY-MM-DD).
 */
export function getHollyTradeDays(startDate: string = "2021-01-01"): BackfillDay[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT DISTINCT DATE(alert_time) as trade_date, GROUP_CONCAT(DISTINCT symbol) as symbols
       FROM holly_alerts
       WHERE DATE(alert_time) >= ?
       GROUP BY DATE(alert_time)
       ORDER BY trade_date ASC`
    )
    .all(startDate) as Array<{ trade_date: string; symbols: string }>;

  return rows.map((r) => ({
    tradeDate: r.trade_date,
    symbols: r.symbols.split(","),
  }));
}

/**
 * Run the Benzinga news backfill for Holly trade dates.
 * Fetches news for each trade date's symbols and stores in the database.
 */
export async function runBackfill(opts: BackfillOptions): Promise<BackfillProgress[]> {
  const { apiKey, batchSize = 20, dryRun = false, onProgress, rateLimitRpm } = opts;

  const client = new BenzingaClient({ apiKey, rateLimitRpm });
  const tradeDays = getHollyTradeDays();
  const results: BackfillProgress[] = [];

  for (const day of tradeDays) {
    let articlesFound = 0;
    let apiCalls = 0;

    // Compute fetch window: trade_date - 1 day to trade_date end
    const startDate = new Date(day.tradeDate);
    startDate.setDate(startDate.getDate() - 1);
    const fetchStart = startDate.toISOString().replace("T", "T") + "T00:00:00Z";
    const fetchEnd = day.tradeDate + "T23:59:59Z";

    // Batch symbols into groups
    for (let i = 0; i < day.symbols.length; i += batchSize) {
      const batch = day.symbols.slice(i, i + batchSize);

      const params: BenzingaQueryParams = {
        tickers: batch,
        publishedUtcGte: fetchStart,
        publishedUtcLte: fetchEnd,
        order: "asc",
        limit: 1000,
      };

      if (dryRun) {
        apiCalls++;
        continue;
      }

      const allArticles: BenzingaArticle[] = [];

      for await (const page of client.fetchAllPages(params)) {
        apiCalls++;
        allArticles.push(...page.results);
      }

      if (allArticles.length > 0) {
        const importBatch = `backfill-${day.tradeDate}`;
        ingestArticles(allArticles, importBatch);
        articlesFound += allArticles.length;
      }
    }

    const progress: BackfillProgress = {
      date: day.tradeDate,
      symbolsFetched: day.symbols.length,
      articlesFound,
      apiCalls,
    };

    results.push(progress);
    onProgress?.(progress);
  }

  return results;
}
