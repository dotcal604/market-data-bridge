# Benzinga News Integration — Revised Fetch Spec

> **Status:** Approved for implementation (pending Massive subscription)
> **Scope:** News-only experiment — archive first, evaluate lift, then decide on live poller
> **Data source:** Massive (formerly Polygon) → Benzinga News v2 endpoint

---

## 1. Goal

Enrich Holly trade history with pre-trade news/catalyst data to answer:
- Did a news catalyst exist before entry?
- Does news presence correlate with better Holly outcomes (win rate, R-multiple, giveback)?
- Can we build a simple "catalyst present" binary feature that improves the eval ensemble?

**This is not NLP.** Phase 0–1 is purely: was there a Benzinga headline for this symbol in the window before entry? Count, recency, channel classification — nothing fancier until we prove lift.

---

## 2. API Contract — Massive Benzinga News v2

### Endpoint

```
GET https://api.massive.io/v2/reference/news?apiKey={KEY}
```

> Massive rebranded from Polygon in late 2025. Existing API keys continue to work.
> Benzinga News is a **separate add-on** (~$99/mo personal tier), not bundled with stock data plans.

### Query Parameters

| Parameter | Type | Notes |
|-----------|------|-------|
| `tickers.any_of` | string | **Comma-separated symbols** (e.g., `AAPL,TSLA,NVDA`). NOT bare `tickers=`. |
| `published_utc.gte` | string | ISO 8601 lower bound (inclusive) |
| `published_utc.lte` | string | ISO 8601 upper bound (inclusive) |
| `order` | string | `asc` or `desc` |
| `limit` | integer | Results per page (max 1000) |
| `apiKey` | string | API key |

**Critical:** Multi-symbol filtering uses `tickers.any_of=SYM1,SYM2,...`, not bare `tickers=SYM1,SYM2,...`. The bare `tickers` parameter filters for arrays that contain a single value.

### Response Shape (Massive v2)

```jsonc
{
  "results": [
    {
      "id": "benzinga-uuid-string",
      "publisher": { "name": "Benzinga", "homepage_url": "...", "logo_url": "..." },
      "title": "Article headline",
      "author": "Author Name",
      "published_utc": "2025-03-10T14:30:00Z",
      "article_url": "https://...",
      "tickers": ["AAPL", "MSFT"],       // array[string] — already flat
      "channels": ["News", "Markets"],     // array[string] — already flat (NOT [{name: "..."}])
      "tags": ["Earnings", "Technology"],   // array[string] — already flat (NOT [{name: "..."}])
      "keywords": ["apple", "revenue"],
      "description": "First paragraph / summary",
      "image_url": "https://..."
    }
  ],
  "next_url": "https://api.massive.io/v2/reference/news?cursor=...",
  "count": 10,
  "status": "OK"
}
```

**Schema note:** In the Massive v2 response, `channels`, `tags`, and `tickers` are **already `array[string]`**. Do NOT parse them as `array[{name: string}]` — that's native Benzinga API v2 shape, not the Massive partner response.

### Pagination — `next_url`

**Treat `next_url` as an opaque cursor.** Follow it verbatim. Only append `apiKey` if Massive does not include it in the returned URL. Do NOT rebuild paginated URLs manually or strip/modify query parameters.

### Rate Limits

Massive personal tier: 5 req/min. Backfill fetcher must respect this with a delay between calls.

---

## 3. Storage Schema

### Table: `benzinga_news`

```sql
CREATE TABLE IF NOT EXISTS benzinga_news (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  benzinga_id   TEXT NOT NULL UNIQUE,      -- from response id field
  title         TEXT NOT NULL,
  published_utc TEXT NOT NULL,             -- ISO 8601, always UTC
  author        TEXT,
  article_url   TEXT,
  description   TEXT,                       -- first paragraph / summary
  tickers_json  TEXT NOT NULL,             -- JSON array of ticker strings
  channels_json TEXT,                       -- JSON array of channel strings
  tags_json     TEXT,                       -- JSON array of tag strings
  keywords_json TEXT,                       -- JSON array of keyword strings
  publisher     TEXT,                       -- publisher name
  image_url     TEXT,
  last_updated  TEXT,                       -- for future upsert versioning
  import_batch  TEXT,                       -- batch ID for tracking
  imported_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Query indexes
CREATE INDEX IF NOT EXISTS idx_benzinga_news_published ON benzinga_news(published_utc);
CREATE INDEX IF NOT EXISTS idx_benzinga_news_batch ON benzinga_news(import_batch);
```

**Ticker association table** (for efficient joins):

```sql
CREATE TABLE IF NOT EXISTS benzinga_news_tickers (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  benzinga_id   TEXT NOT NULL,             -- FK to benzinga_news
  symbol        TEXT NOT NULL,
  UNIQUE(benzinga_id, symbol)
);

CREATE INDEX IF NOT EXISTS idx_bnt_symbol ON benzinga_news_tickers(symbol);
CREATE INDEX IF NOT EXISTS idx_bnt_benzinga_id ON benzinga_news_tickers(benzinga_id);
```

### Versioning — v1 Rules

- **Upsert** latest article state by `benzinga_id` (INSERT OR REPLACE on unique constraint)
- Persist `last_updated` timestamp if available in response
- Do NOT build full article-version history in v1
- If we observe meaningful update churn later, add a `benzinga_news_versions` table then

---

## 4. Backfill Strategy

### Scope: 2021+ Holly Trades First

From holly_analytics.csv / holly_trades table:
- **7,056 rows**, 3,206 unique symbols, 1,233 trade dates
- Average 5.65 unique symbols per trade date
- 95th percentile: 12 symbols/day
- Maximum: 22 symbols/day

This means daily batches are small and predictable.

### Backfill Algorithm

```
For each unique trade_date in holly_trades (2021+), ordered ascending:
  1. Get unique symbols traded that day
  2. Compute fetch window:
     - start: trade_date - 1 calendar day, 00:00:00 UTC
     - end:   trade_date, 23:59:59 UTC
  3. Batch symbols into groups of ≤20 (stay well under any limit)
  4. For each batch:
     - GET /v2/reference/news?tickers.any_of={batch}&published_utc.gte={start}&published_utc.lte={end}&limit=1000&order=asc
     - Follow next_url if paginated
     - Respect 5 req/min rate limit (12s delay between requests)
  5. Upsert articles into benzinga_news
  6. Populate benzinga_news_tickers junction table
  7. Log: date, symbols_fetched, articles_found, api_calls_made
```

### Time Window Rationale

Fetching `[trade_date - 1 day, trade_date end]` captures:
- After-hours news from prior session
- Pre-market news on trade day
- Same-day catalysts published before entry

The join (below) enforces `published_utc <= entry_time_utc`, so fetching a wider window doesn't leak future data.

### History Note

Massive markets Benzinga News with history back to 2009. **Verify actual coverage depth during backfill** — treat 2009 as a marketing claim until confirmed by data. Start with 2021+ and only backfill 2016–2020 if the feature proves lift.

---

## 5. Join Logic — Anti-Leakage Rule

### Normalize Entry Time Once

Holly `entry_time` values are naïve Eastern timestamps. Normalize once in a staging step:

```sql
-- Add column to holly_trades (one-time migration)
ALTER TABLE holly_trades ADD COLUMN entry_time_utc TEXT;

-- Populate (Eastern → UTC, handles EST/EDT correctly)
-- In Node.js, use Intl/Temporal or luxon for correct DST handling
-- Do NOT use inline SQL timezone math — SQLite doesn't have timezone support
```

Compute `entry_time_utc` in application code (Node.js or Python) where timezone libraries are reliable, then write back to the column.

### Join Rule

```sql
SELECT
  t.symbol,
  t.entry_time_utc,
  t.strategy,
  t.actual_pnl,
  t.r_multiple,
  COUNT(n.id) AS news_count_before_entry,
  MIN(
    (julianday(t.entry_time_utc) - julianday(n.published_utc)) * 24 * 60
  ) AS most_recent_news_minutes_before,
  GROUP_CONCAT(DISTINCT n_channels.value) AS channels_before_entry
FROM holly_trades t
LEFT JOIN benzinga_news_tickers bnt ON bnt.symbol = t.symbol
LEFT JOIN benzinga_news n ON n.benzinga_id = bnt.benzinga_id
  AND n.published_utc <= t.entry_time_utc                -- STRICT: no future data
  AND n.published_utc >= datetime(t.entry_time_utc, '-24 hours')  -- 24h lookback
LEFT JOIN json_each(n.channels_json) n_channels ON TRUE
GROUP BY t.id;
```

**The cardinal rule:** `published_utc <= entry_time_utc`. This is what separates a useful feature from a backtest with lipstick.

---

## 6. Derived Features (Phase 0)

Start with these 8 simple features — no NLP, no embeddings:

| Feature | Type | Derivation |
|---------|------|------------|
| `has_news` | boolean | `news_count_before_entry > 0` |
| `news_count_24h` | integer | Count of articles in 24h before entry |
| `news_recency_min` | float | Minutes between most recent article and entry |
| `has_earnings_news` | boolean | Any tag/channel contains "Earnings" |
| `has_analyst_news` | boolean | Any tag/channel contains "Analyst" or "Rating" |
| `news_velocity` | float | `news_count_24h / 24` (articles per hour) |
| `multi_source` | boolean | More than one unique publisher in window |
| `pre_market_news` | boolean | Any article published between 04:00–09:30 ET on trade day |

### Evaluation

Compare Holly trade outcomes (win rate, avg R-multiple, avg giveback_ratio) across:
1. `has_news = true` vs `has_news = false`
2. `has_earnings_news = true` vs rest
3. `news_recency_min` buckets (< 30 min, 30–120 min, > 120 min)
4. Strategy × has_news interaction

**Success criteria:** If any feature shows >5% win rate delta or >0.3 R-multiple improvement with p < 0.05, proceed to Phase 1 (add to eval ensemble as a feature).

---

## 7. Mode Separation

### Backfill Mode (Phase 0 — this spec)

- Batch fetch by Holly trade dates + unique symbol sets
- Published window: `[trade_date - 1 day, trade_date end]`
- Run once, idempotent (upsert by benzinga_id)
- Rate-limited: 5 req/min max

### Live Mode (Phase 1 — future spec, separate implementation)

- Rolling incremental poller on `published_utc` with overlap
- Poll interval: every 60s during market hours
- Overlap: re-fetch last 5 minutes to catch delayed publications
- **Do NOT use `updatedSince`** — that's native Benzinga API, not available in Massive v2
- Store new articles, trigger re-evaluation if symbol matches active Holly alert
- Separate fetcher process / scheduled task, not inline with trade pipeline

---

## 8. File Placement

```
src/
  news/
    benzinga-client.ts       -- Massive API client (fetch, paginate, rate limit)
    benzinga-schema.ts       -- Zod schemas for API response + DB records
    benzinga-storage.ts      -- SQLite upsert, junction table, queries
    benzinga-backfill.ts     -- Backfill orchestrator (trade dates → fetch → store)
    benzinga-features.ts     -- Derive 8 features from joined data
    __tests__/
      benzinga-client.test.ts
      benzinga-storage.test.ts
      benzinga-features.test.ts
analytics/
  holly_news/
    news_lift_analysis.py    -- Statistical comparison: news vs no-news outcomes
```

Follows existing patterns: Zod schemas, named exports, Pino logging, prepared SQL.

---

## 9. Implementation Order

1. **Schema + storage** — Create tables, upsert logic, Zod validation
2. **API client** — Massive v2 fetcher with pagination, rate limiting, retry
3. **Backfill orchestrator** — Query holly_trades dates → batch fetch → store
4. **Entry time UTC migration** — Normalize holly_trades.entry_time to UTC
5. **Join + feature derivation** — Compute 8 features per trade
6. **Lift analysis** — Statistical comparison in Python notebook
7. **Evaluate** — Decide: add to ensemble, extend to live, or kill

---

## 10. Subscription Strategy

1. **Buy** Benzinga News add-on from Massive (~$99/mo personal tier)
2. **Archive** 2021+ Holly trade windows (~1,233 days × ~6 symbols/day)
3. **Evaluate** lift within 1 billing cycle
4. **Downgrade** if no lift — Massive allows self-service downgrade in dashboard, access continues through end of billing period

---

## Corrections Applied (from ChatGPT review)

1. **`tickers.any_of`** — Fixed from bare `tickers=` to `tickers.any_of=` for multi-symbol queries
2. **Response shape** — `channels`/`tags` are `array[string]` in Massive v2, not `array[{name: string}]`
3. **`next_url` handling** — Treat as opaque cursor, follow verbatim
4. **2009 history** — Reclassified from "verified" to "marketing claim, verify during backfill"
5. **Mode separation** — Explicit backfill vs live poller split (this spec covers backfill only)
6. **Version history** — Deferred from v1; upsert latest + persist `last_updated` only
7. **Timezone normalization** — Compute `entry_time_utc` once in staging, not ad-hoc in every query
