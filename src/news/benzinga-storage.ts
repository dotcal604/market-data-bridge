import {
  upsertBenzingaArticle,
  upsertBenzingaArticleBatch,
  queryBenzingaNewsByTicker,
  queryBenzingaNewsByDateRange,
  countBenzingaNews,
  getBenzingaNewsById,
  type BenzingaNewsRow,
} from "../db/database.js";
import type { BenzingaArticle } from "./benzinga-schema.js";

export interface IngestResult {
  articlesProcessed: number;
  newArticles: number;
  tickerLinks: number;
}

function articleToDbRow(article: BenzingaArticle, importBatch?: string) {
  return {
    benzinga_id: article.id,
    title: article.title,
    published_utc: article.published_utc,
    author: article.author ?? null,
    article_url: article.article_url ?? null,
    description: article.description ?? null,
    tickers: article.tickers,
    channels: article.channels ?? null,
    tags: article.tags ?? null,
    keywords: article.keywords ?? null,
    publisher: article.publisher?.name ?? null,
    image_url: article.image_url ?? null,
    last_updated: null,
    import_batch: importBatch ?? null,
  };
}

export function ingestArticles(
  articles: BenzingaArticle[],
  importBatch?: string
): IngestResult {
  const existingBefore = countBenzingaNews();
  const rows = articles.map((a) => articleToDbRow(a, importBatch));

  let tickerLinks = 0;
  for (const row of rows) {
    tickerLinks += row.tickers.length;
  }

  upsertBenzingaArticleBatch(rows);

  const existingAfter = countBenzingaNews();

  return {
    articlesProcessed: articles.length,
    newArticles: existingAfter - existingBefore,
    tickerLinks,
  };
}

export {
  queryBenzingaNewsByTicker,
  queryBenzingaNewsByDateRange,
  countBenzingaNews,
  getBenzingaNewsById,
  type BenzingaNewsRow,
};
