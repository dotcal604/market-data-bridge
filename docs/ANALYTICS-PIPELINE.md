# Holly Analytics Pipeline

End-to-end research pipeline for Holly AI trade analysis. 122 scripts, 28,875 trades, 89 DuckDB tables.

## Architecture

```
Holly AI Trades (CSV)
    │
    ▼
┌─────────────────────────────────────────────────────┐
│  PHASE A: Ingest & Data Collection (scripts 01-44)  │
│                                                     │
│  01-07  Core pipeline: ingest → bars → optimize     │
│  08-16  Analysis, export, benchmarks, regime bars   │
│  17-26  Reference data: financials, news, FRED,     │
│         events, holidays, sectors                   │
│  27-44  Deep analysis: MAE/MFE, sizing, snapshots,  │
│         indicators, Benzinga, analyst ratings       │
└──────────────────────┬──────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────┐
│  PHASE B: Feature Engineering (scripts 45-78)       │
│                                                     │
│  45-51  Lift analysis: Benzinga, regime, earnings,  │
│         economic events, fundamentals, temporal     │
│  52-55  Composite edge scores v1-v2                 │
│  56-59  Prior-day, fundamentals, news/dividends,    │
│         composite v3                                │
│  60-68  GBT models, per-strategy GBT, composite v4  │
│  69-78  Intraday, pruned v6, Benzinga broad fetch,  │
│         ratings/earnings fetch, composite v7         │
└──────────────────────┬──────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────┐
│  PHASE C: Research & Validation (scripts 79-101)    │
│                                                     │
│  79-87  Modern-era composites v8-v12, macro lift,   │
│         sector-temporal, gapfill tuning             │
│  88-92  Extended data: FRED, Polygon shorts/insiders│
│         /indicators                                 │
│  93-97  Indicator lift, composite v14-v15,          │
│         remaining datasets, broad features          │
│  98     Mega-fetch: hoard all API data              │
│  99     SSP overlay: hierarchical Bayes shrinkage   │
│  100    Adversarial validation (5/5 PASS)           │
│  101    Holly Analysis Lab Workbook v1              │
└──────────────────────┬──────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────┐
│  OUTPUT                                             │
│                                                     │
│  holly.ddb            89 tables, Bronze layer       │
│  holly_trades.duckdb  Silver layer, 250+ columns    │
│  holly_analytics.xlsx Flat 140-col export (legacy)  │
│  holly_analysis_lab.xlsx  6-sheet analytical workbook│
└─────────────────────────────────────────────────────┘
```

## Data Flow

```
Sources                   Bronze (DuckDB)              Silver              Output
────────                  ──────────────               ──────              ──────
Holly CSV ──────────────► trades (28,875)     ──┐
Polygon bars ───────────► bars (2.7M)         ──┤
Polygon indicators ─────► indicators (6 pq)   ──┤
Polygon reference ──────► ticker_details       ──┤
Polygon financials ─────► financials           ──┤
Benzinga news ──────────► benzinga_news (2.7M) ──┼──► holly_trades.duckdb ──► .xlsx
Benzinga ratings ───────► analyst_ratings      ──┤      (250+ columns)       .parquet
FRED macro ─────────────► fred_macro_daily     ──┤
SEC filings ────────────► sec_index (2M)       ──┤
Massive.com ────────────► short_interest/vol   ──┤
Economic events ────────► economic_event_flags ──┘
```

## Key Findings

| Signal | Cohen's d | OOS Stable? | Status |
|--------|-----------|-------------|--------|
| SSP overlay (strat-sector shrunk WR) | +0.647*** | YES | **Tier 1 — LIVE SAFE** |
| market_cap | +0.103 | YES | Tier 2 — conditional |
| All Benzinga news counting features | < 0.025 | N/A | **NOISE — killed** |
| sector_prior_wr (raw) | +0.257 | sign flips | **DEAD — killed** |

## SSP Overlay (Script 99)

Hierarchical Bayes shrinkage for strategy-sector win rate:

```
Cell WR ──shrink──► Strategy Prior ──shrink──► Global Prior (50%)

alpha = min_cell / (min_cell + cell_n)
shrunk_wr = (1 - alpha) * raw_wr + alpha * target
```

- Applied as capped +/-10 bonus on AQS v2 score
- Adversarially validated: permutation (p=0.005), walk-forward (5/5), worst-regime (0/6 hurt), param sensitivity (CV=0.05), bootstrap CI [$634, $1,299]

## Workbook (Script 101)

`holly_analysis_lab.xlsx` — 6 sheets:

| Sheet | Content |
|-------|---------|
| README | Metadata, timing class key, significance guide |
| DATA_DICTIONARY | Feature registry with timing_class and coverage |
| PRETRADE_FEATURES | 31 features ranked by \|Cohen's d\| with OOS validation |
| STRATEGY_LAB | 152 strategy-direction combos, Bayesian WR, temporal decay |
| REGIME_LAB | Trend/vol regime heatmap, macro regime matrix, top/bottom 5 |
| SCORECARD | Signal tiers, SSP summary, kill/monitor lists, data coverage |

## Timing Classes

| Class | Meaning | Safe for Live? |
|-------|---------|----------------|
| `pretrade` | Available before trade entry | YES |
| `posttrade` | Uses outcome data (P&L, MFE) | NO — training only |
| `leaky` | Full-sample stats that look pretrade | NO — will overfit |

## Running Scripts

Scripts read from DuckDB at `analytics/holly_exit/data/duckdb/holly.ddb`. Most are standalone:

```bash
cd analytics/holly_exit
python scripts/101_build_workbook.py
```

Data fetch scripts (17-44, 77-78, 88-92, 98) require API keys configured in `.env`.
