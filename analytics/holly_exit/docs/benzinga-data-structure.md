# Benzinga News Data Structure

## Endpoint
`GET /benzinga/v2/news` via Massive.com / Polygon marketplace

## Single Article (API Response Shape)
```
{
  "benzinga_id":   "12345678"          ← unique ID (NOT "id")
  "published":     "2026-03-09T14:30:00Z"
  "last_updated":  "2026-03-09T15:00:00Z"  ← (NOT "updated")
  "author":        "John Smith"
  "title":         "NVDA Surges on AI Chip Demand"
  "teaser":        "Short preview paragraph..."
  "body":          "<p>Full HTML article text...</p>"
  "url":           "https://benzinga.com/..."

  "tickers":       ["NVDA", "AMD", "INTC"]    ← flat string list
  "channels":      ["news", "tech", "movers"]  ← flat string list
  "tags":          ["why it's moving"]          ← flat string list
  "images":        ["https://cdn.bz/img.jpg"]  ← flat URL list
  "stocks":        null                         ← deprecated, use tickers
}
```

## Flattened Parquet Schema (what we store)
```
benzinga_id   string   ← primary key, dedup field
published     string   ← ISO timestamp, sort field
updated       string   ← from last_updated
title         string
teaser        string   ← 1-2 sentence preview
body          string   ← full HTML article (biggest column, ~1KB avg)
url           string
author        string
channels      string   ← comma-joined: "news,tech,movers"
tags          string   ← comma-joined: "why it's moving"
tickers       string   ← comma-joined: "NVDA,AMD,INTC"
ticker_count  int      ← len(tickers) for quick filtering
image_url     string   ← first image URL only
```

## Data Flow
```
Benzinga API ──(1000/page)──► Script 43 ──► news.parquet ──► DuckDB
   │                            │               │           (benzinga_news)
   │  pagination walks          │  client-side  │
   │  newest → oldest           │  date trim    │
   │  via next_url cursor       │  + dedup      │
   │                            │               │
   └── date params IGNORED      └── ~1,100      └── ~1.5 KB/article
       by endpoint                  articles/day     with body text
```

## Volume & Coverage
```
Daily volume:    ~1,100 articles/day
Full history:    2010-01-01 → present
Full backfill:   ~6M+ articles, ~6K pages, ~2-3 GB parquet
1-year slice:    ~400K articles, ~600 MB
With body:       ~82% of articles have body text
With tickers:    ~98% of articles have ticker tags
```

## Channels (top 10 from 2026-03-09 sample)
```
news              749   ← general market news
analyst ratings   277   ← rating actions (upgrade/downgrade)
price target      211   ← PT changes
earnings          156   ← earnings reports & previews
trading ideas     125   ← trade setups
markets            89   ← broad market commentary
movers             85   ← price movers
general            60   ← misc
top stories        49   ← editorial picks
biotech            34   ← sector-specific
```

## Holly Feature Engineering Uses
```
Article → Ticker Match → Join to trade entry timestamp
  ├── channels[]  → catalyst type (rating, earnings, movers)
  ├── tags[]      → sentiment signal ("why it's moving")
  ├── ticker_count → news breadth (1 ticker = focused, 10+ = broad)
  ├── body text   → NLP sentiment / keyword extraction
  └── published   → time-to-trade (minutes from news to entry)
```
