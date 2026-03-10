"""
build_silver.py — Medallion Silver Layer Builder
=================================================
Reads Bronze sources (holly.ddb DuckDB + bridge.db SQLite), builds one
canonical denormalized analytics table, and writes it to:

  data/silver/holly_trades.duckdb   (canonical Silver store)
  data/silver/holly_trades.parquet  (PBI / portable export)

This replaces the old pipeline of 13_export_analytics.py → CSV → xlsx
with a single-source-of-truth that all consumers read:
  - statistical_probability.py → DuckDB
  - Power BI Desktop → Parquet
  - MCP eval engine → DuckDB (future)

Usage:
    python analytics/build_silver.py
    python analytics/build_silver.py --skip-parquet
    python analytics/build_silver.py --stats-only

Called via MCP: run_analytics script="build_silver"
"""

import argparse
import json
import logging
import sys
import time
from pathlib import Path

import duckdb
import numpy as np
import pandas as pd

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

ANALYTICS_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = ANALYTICS_DIR.parent
DATA_DIR = PROJECT_ROOT / "data"
SILVER_DIR = DATA_DIR / "silver"

# Bronze sources
HOLLY_DDB = ANALYTICS_DIR / "holly_exit" / "data" / "duckdb" / "holly.ddb"
BRIDGE_DB = DATA_DIR / "bridge.db"

# Silver outputs
SILVER_DDB = SILVER_DIR / "holly_trades.duckdb"
SILVER_PARQUET = SILVER_DIR / "holly_trades.parquet"

# Polygon enrichment sources
INDICATOR_DIR = ANALYTICS_DIR / "holly_exit" / "data" / "indicators"
SNAPSHOT_DIR = ANALYTICS_DIR / "holly_exit" / "data" / "snapshots"

# Optional: probability engine JSON (enrichment)
PROB_JSON = ANALYTICS_DIR / "output" / "statistical_probability.json"

# Sizing simulation parameters (match 13_export_analytics.py)
SIM_RISK_PER_TRADE = 100.0
SIM_MAX_SHARES = 2000
SIM_MAX_CAPITAL = 25_000

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# 1. Extract from Bronze (DuckDB holly.ddb)
# ---------------------------------------------------------------------------

def extract_from_holly_ddb() -> pd.DataFrame:
    """
    Run the big denormalized query against holly.ddb.
    Joins: trades + trade_regime + optimization_results + ticker_details +
           financials + news + fred_macro_daily
    """
    if not HOLLY_DDB.exists():
        logger.error(f"Bronze DuckDB not found: {HOLLY_DDB}")
        sys.exit(1)

    logger.info(f"Connecting to Bronze: {HOLLY_DDB}")
    db = duckdb.connect(str(HOLLY_DDB), read_only=True)

    # Check which optional Bronze tables exist
    existing_tables = {r[0] for r in db.execute("SHOW TABLES").fetchall()}
    has_etf_bars = "etf_bars" in existing_tables
    has_market_daily = "market_daily" in existing_tables
    has_daily_bars_flat = "daily_bars_flat" in existing_tables
    has_benzinga_news = "benzinga_news" in existing_tables
    has_analyst_ratings = "analyst_ratings" in existing_tables
    has_corporate_guidance = "corporate_guidance" in existing_tables
    has_massive_daily_bars = "massive_daily_bars" in existing_tables
    has_trade_nbbo_quotes = "trade_nbbo_quotes" in existing_tables
    has_massive_float = "massive_float" in existing_tables
    has_massive_short_interest = "massive_short_interest" in existing_tables
    has_massive_short_volume = "massive_short_volume" in existing_tables
    has_benzinga_earnings = "benzinga_earnings" in existing_tables
    has_massive_dividends = "massive_dividends" in existing_tables
    has_massive_splits = "massive_splits" in existing_tables
    has_massive_ipos = "massive_ipos" in existing_tables
    has_massive_ratios = "massive_ratios" in existing_tables
    has_benzinga_consensus = "benzinga_consensus_ratings" in existing_tables
    has_related_tickers = "massive_related_tickers" in existing_tables
    logger.info(f"Optional tables: etf_bars={has_etf_bars}, market_daily={has_market_daily}, "
                f"daily_bars_flat={has_daily_bars_flat}, benzinga_news={has_benzinga_news}, "
                f"analyst_ratings={has_analyst_ratings}, corporate_guidance={has_corporate_guidance}, "
                f"massive_daily_bars={has_massive_daily_bars}, trade_nbbo={has_trade_nbbo_quotes}, "
                f"float={has_massive_float}, short_interest={has_massive_short_interest}, "
                f"short_volume={has_massive_short_volume}, earnings={has_benzinga_earnings}, "
                f"dividends={has_massive_dividends}, splits={has_massive_splits}, "
                f"ipos={has_massive_ipos}, ratios={has_massive_ratios}, "
                f"consensus={has_benzinga_consensus}, related={has_related_tickers}")

    # Build optional CTE stubs for missing tables
    spy_cte = """
        -- SPY open price per day (first bar of the day)
        spy_daily_open AS (
            SELECT DISTINCT ON (CAST(bar_time AS DATE))
                CAST(bar_time AS DATE) AS spy_date,
                open AS spy_open_price
            FROM etf_bars
            WHERE symbol = 'SPY'
            ORDER BY CAST(bar_time AS DATE), bar_time ASC
        ),
        -- SPY bar closest to (but not after) each trade entry
        trade_spy AS (
            SELECT
                t.trade_id,
                e.close AS spy_price_at_entry,
                sdo.spy_open_price,
                ROUND((e.close - sdo.spy_open_price)
                    / NULLIF(sdo.spy_open_price, 0) * 100, 4) AS spy_intraday_pct_at_entry,
                e.volume AS spy_volume_at_entry
            FROM trades t
            LEFT JOIN (
                SELECT trade_id, close, volume
                FROM (
                    SELECT t2.trade_id, eb.close, eb.volume,
                        ROW_NUMBER() OVER (PARTITION BY t2.trade_id ORDER BY eb.bar_time DESC) AS rn
                    FROM trades t2
                    JOIN etf_bars eb
                        ON eb.symbol = 'SPY'
                        AND CAST(eb.bar_time AS DATE) = CAST(t2.entry_time AS DATE)
                        AND eb.bar_time <= t2.entry_time
                )
                WHERE rn = 1
            ) e ON e.trade_id = t.trade_id
            LEFT JOIN spy_daily_open sdo
                ON sdo.spy_date = CAST(t.entry_time AS DATE)
        ),
    """ if has_etf_bars else """
        trade_spy AS (
            SELECT trade_id,
                NULL::DOUBLE AS spy_price_at_entry,
                NULL::DOUBLE AS spy_open_price,
                NULL::DOUBLE AS spy_intraday_pct_at_entry,
                NULL::BIGINT AS spy_volume_at_entry
            FROM trades
        ),
    """

    breadth_cte = """
        -- Market breadth from grouped daily bars (advance/decline on trade date)
        trade_breadth AS (
            SELECT
                t.trade_id,
                COUNT(*) AS mkt_total_stocks,
                COUNT(CASE WHEN md.close > md.open THEN 1 END) AS mkt_advancers,
                COUNT(CASE WHEN md.close < md.open THEN 1 END) AS mkt_decliners,
                ROUND(
                    COUNT(CASE WHEN md.close > md.open THEN 1 END) * 1.0
                    / NULLIF(COUNT(*), 0), 4
                ) AS mkt_advance_ratio,
                SUM(md.volume) AS mkt_total_volume
            FROM trades t
            LEFT JOIN market_daily md
                ON md.bar_date = CAST(t.entry_time AS DATE)
            GROUP BY t.trade_id
        ),
    """ if has_market_daily else """
        trade_breadth AS (
            SELECT trade_id,
                NULL::BIGINT AS mkt_total_stocks,
                NULL::BIGINT AS mkt_advancers,
                NULL::BIGINT AS mkt_decliners,
                NULL::DOUBLE AS mkt_advance_ratio,
                NULL::BIGINT AS mkt_total_volume
            FROM trades
        ),
    """

    daily_context_cte = """
        -- Same-symbol daily bar for prior day (for gap calculation + relative perf)
        trade_daily_context AS (
            SELECT
                t.trade_id,
                dbf.close AS prior_day_close,
                dbf.volume AS prior_day_volume,
                dbf.high AS prior_day_high,
                dbf.low AS prior_day_low,
                ROUND((t.entry_price - dbf.close) / NULLIF(dbf.close, 0) * 100, 4)
                    AS entry_gap_pct,
                spy_daily.close AS spy_prior_close
            FROM trades t
            LEFT JOIN daily_bars_flat dbf
                ON dbf.ticker = t.symbol
                AND dbf.bar_time = (
                    SELECT MAX(bar_time) FROM daily_bars_flat
                    WHERE ticker = t.symbol
                    AND CAST(bar_time AS DATE) < CAST(t.entry_time AS DATE)
                )
            LEFT JOIN daily_bars_flat spy_daily
                ON spy_daily.ticker = 'SPY'
                AND spy_daily.bar_time = (
                    SELECT MAX(bar_time) FROM daily_bars_flat
                    WHERE ticker = 'SPY'
                    AND CAST(bar_time AS DATE) < CAST(t.entry_time AS DATE)
                )
        ),
    """ if has_daily_bars_flat else """
        trade_daily_context AS (
            SELECT trade_id,
                NULL::DOUBLE AS prior_day_close,
                NULL::BIGINT AS prior_day_volume,
                NULL::DOUBLE AS prior_day_high,
                NULL::DOUBLE AS prior_day_low,
                NULL::DOUBLE AS entry_gap_pct,
                NULL::DOUBLE AS spy_prior_close
            FROM trades
        ),
    """

    benzinga_cte = """
        trade_benzinga AS (
            SELECT
                t.trade_id,
                COUNT(bn.benzinga_id) AS bz_article_count_24h,
                COUNT(CASE WHEN CAST(bn.published AS TIMESTAMPTZ) >=
                    (t.entry_time AT TIME ZONE 'America/New_York') - INTERVAL '2 hours'
                    THEN 1 END) AS bz_article_count_2h,
                COUNT(CASE WHEN CAST(bn.published AS TIMESTAMPTZ) >=
                    (t.entry_time AT TIME ZONE 'America/New_York') - INTERVAL '30 minutes'
                    THEN 1 END) AS bz_article_count_30m,
                COUNT(CASE WHEN
                    CAST(CAST(bn.published AS TIMESTAMPTZ) AS DATE) = CAST(t.entry_time AS DATE)
                    AND CAST(bn.published AS TIMESTAMPTZ) <=
                        (t.entry_time AT TIME ZONE 'America/New_York')
                    THEN 1 END) AS bz_same_day_count,
                EXTRACT(EPOCH FROM (
                    (t.entry_time AT TIME ZONE 'America/New_York') -
                    MAX(CAST(bn.published AS TIMESTAMPTZ))
                )) / 60 AS bz_minutes_since_last,
                COUNT(CASE WHEN
                    bn.channels LIKE '%analyst-ratings%' OR
                    bn.channels LIKE '%upgrades%' OR
                    bn.channels LIKE '%downgrades%' OR
                    bn.channels LIKE '%initiates%' OR
                    bn.channels LIKE '%price-target%' OR
                    bn.channels LIKE '%m-a%' OR
                    bn.channels LIKE '%insider-trades%' OR
                    bn.channels LIKE '%sec-filings%'
                THEN 1 END) AS bz_institutional_count,
                first(bn.channels ORDER BY CAST(bn.published AS TIMESTAMPTZ) DESC)
                    AS bz_nearest_channels
            FROM trades t
            LEFT JOIN benzinga_news bn
                ON ',' || bn.tickers || ',' LIKE '%,' || t.symbol || ',%'
                AND CAST(bn.published AS TIMESTAMPTZ) <=
                    (t.entry_time AT TIME ZONE 'America/New_York')
                AND CAST(bn.published AS TIMESTAMPTZ) >=
                    (t.entry_time AT TIME ZONE 'America/New_York') - INTERVAL '24 hours'
            GROUP BY t.trade_id, t.entry_time
        )
    """ if has_benzinga_news else """
        trade_benzinga AS (
            SELECT trade_id,
                0::BIGINT AS bz_article_count_24h,
                0::BIGINT AS bz_article_count_2h,
                0::BIGINT AS bz_article_count_30m,
                0::BIGINT AS bz_same_day_count,
                NULL::DOUBLE AS bz_minutes_since_last,
                0::BIGINT AS bz_institutional_count,
                NULL::VARCHAR AS bz_nearest_channels
            FROM trades
        )
    """

    # ── Analyst ratings CTE (30-day lookback) ─────────────────────
    analyst_cte = """
        trade_analyst AS (
            SELECT
                t.trade_id,
                COUNT(ar.rating_id) AS ar_rating_count_30d,
                COUNT(CASE WHEN ar.action_type IN ('Upgrade', 'upgrade', 'Initiate', 'initiate')
                    THEN 1 END) AS ar_upgrades_30d,
                COUNT(CASE WHEN ar.action_type IN ('Downgrade', 'downgrade')
                    THEN 1 END) AS ar_downgrades_30d,
                COUNT(DISTINCT ar.firm) AS ar_distinct_firms_30d,
                (COUNT(CASE WHEN ar.action_type IN ('Upgrade', 'upgrade', 'Initiate', 'initiate') THEN 1 END)
                 - COUNT(CASE WHEN ar.action_type IN ('Downgrade', 'downgrade') THEN 1 END)
                ) AS ar_momentum_30d,
                AVG(ar.pt_current) AS ar_avg_pt,
                ROUND(
                    (AVG(ar.pt_current) - t.entry_price)
                    / NULLIF(t.entry_price, 0) * 100, 2
                ) AS ar_pt_upside_pct,
                FIRST(ar.action_type ORDER BY CAST(ar.date AS DATE) DESC) AS ar_latest_action,
                FIRST(ar.rating_current ORDER BY CAST(ar.date AS DATE) DESC) AS ar_latest_rating,
                FIRST(ar.firm ORDER BY CAST(ar.date AS DATE) DESC) AS ar_latest_firm,
                CAST(t.entry_time AS DATE) - MAX(CAST(ar.date AS DATE))
                    AS ar_days_since_latest
            FROM trades t
            LEFT JOIN analyst_ratings ar
                ON ar.ticker = t.symbol
                AND CAST(ar.date AS DATE) BETWEEN CAST(t.entry_time AS DATE) - 30
                    AND CAST(t.entry_time AS DATE)
            GROUP BY t.trade_id, t.entry_time, t.entry_price
        ),
    """ if has_analyst_ratings else """
        trade_analyst AS (
            SELECT trade_id,
                0::BIGINT AS ar_rating_count_30d,
                0::BIGINT AS ar_upgrades_30d,
                0::BIGINT AS ar_downgrades_30d,
                0::BIGINT AS ar_distinct_firms_30d,
                0::BIGINT AS ar_momentum_30d,
                NULL::DOUBLE AS ar_avg_pt,
                NULL::DOUBLE AS ar_pt_upside_pct,
                NULL::VARCHAR AS ar_latest_action,
                NULL::VARCHAR AS ar_latest_rating,
                NULL::VARCHAR AS ar_latest_firm,
                NULL::BIGINT AS ar_days_since_latest
            FROM trades
        ),
    """

    # ── Corporate guidance CTE (60-day lookback) ─────────────────
    guidance_cte = """
        trade_guidance AS (
            SELECT
                t.trade_id,
                COUNT(cg.guidance_id) AS cg_changes_60d,
                COUNT(CASE WHEN cg.direction = 'raised' THEN 1 END) AS cg_raised_count,
                COUNT(CASE WHEN cg.direction = 'lowered' THEN 1 END) AS cg_lowered_count,
                (COUNT(CASE WHEN cg.direction = 'raised' THEN 1 END)
                 - COUNT(CASE WHEN cg.direction = 'lowered' THEN 1 END)
                ) AS cg_net_direction,
                FIRST(cg.direction ORDER BY CAST(cg.date AS DATE) DESC) AS cg_latest_direction,
                FIRST(cg.guidance_type ORDER BY CAST(cg.date AS DATE) DESC) AS cg_latest_type,
                FIRST(cg.change_pct ORDER BY CAST(cg.date AS DATE) DESC) AS cg_latest_change_pct,
                CAST(t.entry_time AS DATE) - MAX(CAST(cg.date AS DATE))
                    AS cg_days_since_latest
            FROM trades t
            LEFT JOIN corporate_guidance cg
                ON cg.ticker = t.symbol
                AND CAST(cg.date AS DATE) BETWEEN CAST(t.entry_time AS DATE) - 60
                    AND CAST(t.entry_time AS DATE)
            GROUP BY t.trade_id, t.entry_time
        ),
    """ if has_corporate_guidance else """
        trade_guidance AS (
            SELECT trade_id,
                0::BIGINT AS cg_changes_60d,
                0::BIGINT AS cg_raised_count,
                0::BIGINT AS cg_lowered_count,
                0::BIGINT AS cg_net_direction,
                NULL::VARCHAR AS cg_latest_direction,
                NULL::VARCHAR AS cg_latest_type,
                NULL::DOUBLE AS cg_latest_change_pct,
                NULL::BIGINT AS cg_days_since_latest
            FROM trades
        ),
    """

    # ── Massive daily bars CTE (same-day VWAP) ──────────────────
    massive_bars_cte = """
        trade_massive_bar AS (
            SELECT
                t.trade_id,
                mdb.vwap AS massive_vwap,
                mdb.num_trades AS massive_num_trades,
                mdb.volume AS massive_volume,
                ROUND((t.entry_price - mdb.vwap) / NULLIF(mdb.vwap, 0) * 100, 4)
                    AS entry_vs_vwap_pct
            FROM trades t
            LEFT JOIN massive_daily_bars mdb
                ON mdb.ticker = t.symbol
                AND CAST(mdb.bar_date AS DATE) = CAST(t.entry_time AS DATE)
        ),
    """ if has_massive_daily_bars else """
        trade_massive_bar AS (
            SELECT trade_id,
                NULL::DOUBLE AS massive_vwap,
                NULL::BIGINT AS massive_num_trades,
                NULL::BIGINT AS massive_volume,
                NULL::DOUBLE AS entry_vs_vwap_pct
            FROM trades
        ),
    """

    # ── NBBO spread quality CTE (at trade entry) ──────────────────
    nbbo_cte = """
        trade_nbbo AS (
            SELECT
                t.trade_id,
                tnq.bid AS nbbo_bid,
                tnq.ask AS nbbo_ask,
                tnq.spread AS nbbo_spread,
                tnq.spread_pct AS nbbo_spread_pct,
                tnq.midpoint AS nbbo_midpoint,
                tnq.bid_size AS nbbo_bid_size,
                tnq.ask_size AS nbbo_ask_size,
                ROUND((t.entry_price - tnq.midpoint) / NULLIF(tnq.midpoint, 0) * 100, 4)
                    AS entry_vs_midpoint_pct
            FROM trades t
            LEFT JOIN trade_nbbo_quotes tnq
                ON tnq.ticker = t.symbol
                AND tnq.entry_time = CAST(t.entry_time AS VARCHAR)
        )
    """ if has_trade_nbbo_quotes else """
        trade_nbbo AS (
            SELECT trade_id,
                NULL::DOUBLE AS nbbo_bid,
                NULL::DOUBLE AS nbbo_ask,
                NULL::DOUBLE AS nbbo_spread,
                NULL::DOUBLE AS nbbo_spread_pct,
                NULL::DOUBLE AS nbbo_midpoint,
                NULL::BIGINT AS nbbo_bid_size,
                NULL::BIGINT AS nbbo_ask_size,
                NULL::DOUBLE AS entry_vs_midpoint_pct
            FROM trades
        )
    """

    # ── Float data CTE (latest free float per symbol at trade time) ──
    float_cte = """
        trade_float AS (
            SELECT
                t.trade_id,
                mf.free_float,
                mf.free_float_percent,
                CASE WHEN mf.free_float > 0 AND t.entry_price > 0
                    THEN ROUND(CAST(t.shares AS DOUBLE) / mf.free_float * 100, 6)
                    ELSE NULL
                END AS float_rotation_pct
            FROM trades t
            LEFT JOIN (
                SELECT ticker, effective_date, free_float, free_float_percent,
                    ROW_NUMBER() OVER (PARTITION BY ticker ORDER BY effective_date DESC) AS rn
                FROM massive_float
            ) mf ON mf.ticker = t.symbol AND mf.rn = 1
        ),
    """ if has_massive_float else """
        trade_float AS (
            SELECT trade_id,
                NULL::BIGINT AS free_float,
                NULL::DOUBLE AS free_float_percent,
                NULL::DOUBLE AS float_rotation_pct
            FROM trades
        ),
    """

    # ── Short interest CTE (latest settlement before trade) ──────────
    short_interest_cte = """
        trade_short_interest AS (
            SELECT
                t.trade_id,
                si.short_interest,
                si.avg_daily_volume AS si_avg_daily_volume,
                si.days_to_cover,
                si.settlement_date AS si_settlement_date,
                CASE WHEN si.short_interest IS NOT NULL AND mf.free_float > 0
                    THEN ROUND(CAST(si.short_interest AS DOUBLE) / mf.free_float * 100, 2)
                    ELSE NULL
                END AS short_pct_float
            FROM trades t
            LEFT JOIN (
                SELECT ticker, short_interest, avg_daily_volume, days_to_cover, settlement_date,
                    ROW_NUMBER() OVER (PARTITION BY ticker ORDER BY settlement_date DESC) AS rn
                FROM massive_short_interest
            ) si ON si.ticker = t.symbol AND si.rn = 1
            LEFT JOIN (
                SELECT ticker, free_float,
                    ROW_NUMBER() OVER (PARTITION BY ticker ORDER BY effective_date DESC) AS rn
                FROM massive_float
            ) mf ON mf.ticker = t.symbol AND mf.rn = 1
        ),
    """ if has_massive_short_interest else """
        trade_short_interest AS (
            SELECT trade_id,
                NULL::BIGINT AS short_interest,
                NULL::BIGINT AS si_avg_daily_volume,
                NULL::DOUBLE AS days_to_cover,
                NULL::VARCHAR AS si_settlement_date,
                NULL::DOUBLE AS short_pct_float
            FROM trades
        ),
    """

    # ── Short volume CTE (trade-day short volume ratio) ──────────────
    short_volume_cte = """
        trade_short_volume AS (
            SELECT
                t.trade_id,
                sv.short_volume,
                sv.total_volume AS sv_total_volume,
                sv.short_volume_ratio,
                sv.exempt_volume,
                sv.non_exempt_volume
            FROM trades t
            LEFT JOIN massive_short_volume sv
                ON sv.ticker = t.symbol
                AND sv.date = CAST(t.entry_time AS DATE)
        ),
    """ if has_massive_short_volume else """
        trade_short_volume AS (
            SELECT trade_id,
                NULL::BIGINT AS short_volume,
                NULL::BIGINT AS sv_total_volume,
                NULL::DOUBLE AS short_volume_ratio,
                NULL::BIGINT AS exempt_volume,
                NULL::BIGINT AS non_exempt_volume
            FROM trades
        ),
    """

    # ── Benzinga earnings CTE (most recent earnings before trade) ────
    earnings_cte = """
        trade_earnings AS (
            SELECT
                t.trade_id,
                be.actual_eps,
                be.estimated_eps,
                be.eps_surprise,
                be.eps_surprise_percent,
                be.actual_revenue,
                be.estimated_revenue,
                be.revenue_surprise_percent,
                be.date AS earnings_report_date,
                DATEDIFF('day', TRY_CAST(be.date AS DATE), CAST(t.entry_time AS DATE))
                    AS days_since_earnings,
                be.importance AS earnings_importance
            FROM trades t
            LEFT JOIN (
                SELECT ticker, date, actual_eps, estimated_eps, eps_surprise,
                    eps_surprise_percent, actual_revenue, estimated_revenue,
                    revenue_surprise_percent, importance,
                    ROW_NUMBER() OVER (
                        PARTITION BY ticker, date ORDER BY importance DESC
                    ) AS rn
                FROM benzinga_earnings
                WHERE actual_eps IS NOT NULL
            ) be ON be.ticker = t.symbol
                AND TRY_CAST(be.date AS DATE) <= CAST(t.entry_time AS DATE)
                AND TRY_CAST(be.date AS DATE) >= CAST(t.entry_time AS DATE) - INTERVAL 7 DAY
                AND be.rn = 1
        ),
    """ if has_benzinga_earnings else """
        trade_earnings AS (
            SELECT trade_id,
                NULL::DOUBLE AS actual_eps,
                NULL::DOUBLE AS estimated_eps,
                NULL::DOUBLE AS eps_surprise,
                NULL::DOUBLE AS eps_surprise_percent,
                NULL::DOUBLE AS actual_revenue,
                NULL::DOUBLE AS estimated_revenue,
                NULL::DOUBLE AS revenue_surprise_percent,
                NULL::VARCHAR AS earnings_report_date,
                NULL::INTEGER AS days_since_earnings,
                NULL::INTEGER AS earnings_importance
            FROM trades
        ),
    """

    # ── Dividends CTE (nearest ex-div date relative to trade) ────────
    dividends_cte = """
        trade_dividends AS (
            SELECT
                t.trade_id,
                md.ex_dividend_date,
                md.cash_amount AS div_cash_amount,
                md.frequency AS div_frequency,
                md.distribution_type AS div_type,
                DATEDIFF('day', TRY_CAST(md.ex_dividend_date AS DATE), CAST(t.entry_time AS DATE))
                    AS days_since_ex_div,
                CASE WHEN DATEDIFF('day', TRY_CAST(md.ex_dividend_date AS DATE),
                    CAST(t.entry_time AS DATE)) BETWEEN 0 AND 5 THEN TRUE ELSE FALSE
                END AS near_ex_div
            FROM trades t
            LEFT JOIN (
                SELECT ticker, ex_dividend_date, cash_amount, frequency, distribution_type,
                    ROW_NUMBER() OVER (PARTITION BY ticker ORDER BY ex_dividend_date DESC) AS rn
                FROM massive_dividends
            ) md ON md.ticker = t.symbol
                AND TRY_CAST(md.ex_dividend_date AS DATE) <= CAST(t.entry_time AS DATE)
                AND md.rn = 1
        ),
    """ if has_massive_dividends else """
        trade_dividends AS (
            SELECT trade_id,
                NULL::VARCHAR AS ex_dividend_date,
                NULL::DOUBLE AS div_cash_amount,
                NULL::INTEGER AS div_frequency,
                NULL::VARCHAR AS div_type,
                NULL::INTEGER AS days_since_ex_div,
                FALSE AS near_ex_div
            FROM trades
        ),
    """

    # ── Splits CTE (nearest split relative to trade) ─────────────────
    splits_cte = """
        trade_splits AS (
            SELECT
                t.trade_id,
                ms.execution_date AS split_date,
                ms.split_from,
                ms.split_to,
                ms.adjustment_type AS split_type,
                DATEDIFF('day', TRY_CAST(ms.execution_date AS DATE), CAST(t.entry_time AS DATE))
                    AS days_since_split
            FROM trades t
            LEFT JOIN (
                SELECT ticker, execution_date, split_from, split_to, adjustment_type,
                    ROW_NUMBER() OVER (PARTITION BY ticker ORDER BY execution_date DESC) AS rn
                FROM massive_splits
            ) ms ON ms.ticker = t.symbol
                AND TRY_CAST(ms.execution_date AS DATE) <= CAST(t.entry_time AS DATE)
                AND ms.rn = 1
        ),
    """ if has_massive_splits else """
        trade_splits AS (
            SELECT trade_id,
                NULL::VARCHAR AS split_date,
                NULL::INTEGER AS split_from,
                NULL::INTEGER AS split_to,
                NULL::VARCHAR AS split_type,
                NULL::INTEGER AS days_since_split
            FROM trades
        ),
    """

    # ── IPO CTE (days since listing) ─────────────────────────────────
    ipo_cte = """
        trade_ipo AS (
            SELECT
                t.trade_id,
                mi.listing_date,
                mi.final_issue_price AS ipo_price,
                DATEDIFF('day', TRY_CAST(mi.listing_date AS DATE), CAST(t.entry_time AS DATE))
                    AS days_since_ipo,
                CASE WHEN DATEDIFF('day', TRY_CAST(mi.listing_date AS DATE),
                    CAST(t.entry_time AS DATE)) <= 90 THEN TRUE ELSE FALSE
                END AS is_recent_ipo
            FROM trades t
            LEFT JOIN massive_ipos mi ON mi.ticker = t.symbol
        ),
    """ if has_massive_ipos else """
        trade_ipo AS (
            SELECT trade_id,
                NULL::VARCHAR AS listing_date,
                NULL::DOUBLE AS ipo_price,
                NULL::INTEGER AS days_since_ipo,
                FALSE AS is_recent_ipo
            FROM trades
        ),
    """

    # ── Financial ratios CTE (latest ratios at trade time) ───────────
    ratios_cte = """
        trade_ratios AS (
            SELECT
                t.trade_id,
                mr.price_to_earnings,
                mr.price_to_book,
                mr.ev_to_ebitda,
                mr.return_on_equity,
                mr.return_on_assets,
                mr.current_ratio,
                mr.free_cash_flow
            FROM trades t
            LEFT JOIN (
                SELECT ticker, price_to_earnings, price_to_book, ev_to_ebitda,
                    return_on_equity, return_on_assets,
                    current AS current_ratio, free_cash_flow,
                    ROW_NUMBER() OVER (PARTITION BY ticker ORDER BY date DESC) AS rn
                FROM massive_ratios
            ) mr ON mr.ticker = t.symbol AND mr.rn = 1
        ),
    """ if has_massive_ratios else """
        trade_ratios AS (
            SELECT trade_id,
                NULL::DOUBLE AS price_to_earnings,
                NULL::DOUBLE AS price_to_book,
                NULL::DOUBLE AS ev_to_ebitda,
                NULL::DOUBLE AS return_on_equity,
                NULL::DOUBLE AS return_on_assets,
                NULL::DOUBLE AS current_ratio,
                NULL::DOUBLE AS free_cash_flow
            FROM trades
        ),
    """

    # ── Consensus ratings CTE (aggregated analyst consensus) ─────────
    consensus_cte = """
        trade_consensus AS (
            SELECT
                t.trade_id,
                cr.consensus_rating,
                cr.consensus_rating_value,
                cr.strong_buy AS cr_strong_buy,
                cr.buy AS cr_buy,
                cr.hold AS cr_hold,
                cr.sell AS cr_sell,
                cr.strong_sell AS cr_strong_sell,
                cr.consensus_pt,
                cr.pt_high AS cr_pt_high,
                cr.pt_low AS cr_pt_low,
                CASE WHEN cr.consensus_pt > 0 AND t.entry_price > 0
                    THEN ROUND((cr.consensus_pt - t.entry_price) / t.entry_price * 100, 2)
                    ELSE NULL
                END AS cr_pt_upside_pct
            FROM trades t
            LEFT JOIN benzinga_consensus_ratings cr ON cr.ticker = t.symbol
        ),
    """ if has_benzinga_consensus else """
        trade_consensus AS (
            SELECT trade_id,
                NULL::VARCHAR AS consensus_rating,
                NULL::DOUBLE AS consensus_rating_value,
                NULL::INTEGER AS cr_strong_buy,
                NULL::INTEGER AS cr_buy,
                NULL::INTEGER AS cr_hold,
                NULL::INTEGER AS cr_sell,
                NULL::INTEGER AS cr_strong_sell,
                NULL::DOUBLE AS consensus_pt,
                NULL::DOUBLE AS cr_pt_high,
                NULL::DOUBLE AS cr_pt_low,
                NULL::DOUBLE AS cr_pt_upside_pct
            FROM trades
        ),
    """

    # ── Related tickers CTE (count of related companies) ─────────────
    related_cte = """
        trade_related AS (
            SELECT
                t.trade_id,
                COUNT(rt.related_ticker) AS related_ticker_count
            FROM trades t
            LEFT JOIN massive_related_tickers rt ON rt.source_ticker = t.symbol
            GROUP BY t.trade_id
        )
    """ if has_related_tickers else """
        trade_related AS (
            SELECT trade_id,
                0 AS related_ticker_count
            FROM trades
        )
    """

    df = db.execute(f"""
        WITH trade_financials AS (
            SELECT
                t.trade_id,
                f.revenues,
                f.net_income,
                f.eps_diluted,
                f.operating_income,
                f.gross_profit,
                f.total_assets,
                f.total_liabilities,
                f.total_equity,
                f.operating_cash_flow,
                f.fiscal_period,
                f.fiscal_year,
                f.filing_date,
                ROW_NUMBER() OVER (
                    PARTITION BY t.trade_id
                    ORDER BY TRY_CAST(f.filing_date AS DATE) DESC
                ) AS rn
            FROM trades t
            JOIN financials f
                ON f.ticker = t.symbol
                AND f.timeframe = 'quarterly'
                AND TRY_CAST(f.filing_date AS DATE) <= CAST(t.entry_time AS DATE)
        ),
        trade_fin_prev AS (
            SELECT
                tf.trade_id,
                fp.revenues AS prev_revenues,
                ROW_NUMBER() OVER (
                    PARTITION BY tf.trade_id
                    ORDER BY TRY_CAST(fp.filing_date AS DATE) DESC
                ) AS rn
            FROM trade_financials tf
            JOIN financials fp
                ON fp.ticker = (SELECT t2.symbol FROM trades t2 WHERE t2.trade_id = tf.trade_id)
                AND fp.timeframe = 'quarterly'
                AND fp.fiscal_period = tf.fiscal_period
                AND TRY_CAST(fp.fiscal_year AS INTEGER) = TRY_CAST(tf.fiscal_year AS INTEGER) - 1
            WHERE tf.rn = 1
        ),
        trade_news AS (
            SELECT
                t.trade_id,
                COUNT(n.id) AS news_count_24h,
                COUNT(CASE WHEN n.publisher_name IN (
                    'Benzinga', 'MarketWatch', 'Reuters', 'Bloomberg',
                    'The Wall Street Journal', 'CNBC', 'Barron''s'
                ) THEN 1 END) AS news_institutional_count,
                COUNT(CASE WHEN CAST(n.published_utc AS DATE) = CAST(t.entry_time AS DATE)
                    THEN 1 END) AS news_same_day_count
            FROM trades t
            LEFT JOIN news n
                ON n.tickers LIKE '%' || t.symbol || '%'
                AND CAST(n.published_utc AS TIMESTAMP) BETWEEN
                    CAST(t.entry_time AS TIMESTAMP) - INTERVAL 24 HOUR
                    AND CAST(t.entry_time AS TIMESTAMP)
            GROUP BY t.trade_id
        ),
        {spy_cte}
        {breadth_cte}
        {daily_context_cte}
        {benzinga_cte},
        {analyst_cte}
        {guidance_cte}
        {massive_bars_cte}
        {nbbo_cte}
        {float_cte}
        {short_interest_cte}
        {short_volume_cte}
        {earnings_cte}
        {dividends_cte}
        {splits_cte}
        {ipo_cte}
        {ratios_cte}
        {consensus_cte}
        {related_cte}
        SELECT
            t.trade_id,
            t.symbol,
            t.strategy,
            t.direction,
            t.entry_time,
            t.entry_price,
            t.exit_time,
            t.exit_price,
            t.real_entry_price,
            t.real_entry_time,
            t.holly_pnl,
            t.shares,
            t.stop_price,
            t.target_price,
            t.mfe,
            t.mae,
            t.stop_buffer_pct,
            CAST(t.entry_time AS DATE) AS trade_date,
            EXTRACT(YEAR FROM t.entry_time) AS trade_year,
            EXTRACT(MONTH FROM t.entry_time) AS trade_month,
            EXTRACT(DOW FROM t.entry_time) AS trade_dow,
            EXTRACT(HOUR FROM t.entry_time) AS entry_hour,
            -- Regime features
            r.sma20,
            r.sma5,
            r.trend_slope,
            r.above_sma20,
            r.atr14,
            r.atr_pct,
            r.daily_range_pct,
            r.rsi14,
            r.roc5,
            r.roc20,
            r.trend_regime,
            r.vol_regime,
            r.momentum_regime,
            -- Optimization results (best params per strategy)
            o.exit_rule AS opt_exit_rule,
            o.param_json AS opt_params,
            o.avg_pnl AS opt_avg_pnl,
            o.profit_factor AS opt_profit_factor,
            o.win_rate AS opt_win_rate,
            o.sharpe AS opt_sharpe,
            o.max_drawdown AS opt_max_drawdown,
            o.total_trades AS opt_total_trades,
            -- Ticker details
            td.name AS company_name,
            td.sic_code,
            td.sic_description AS sector,
            td.primary_exchange,
            td.market_cap,
            td.total_employees,
            td.address_state,
            td.list_date AS ipo_date,
            -- Fundamentals
            tf.revenues AS fin_revenue,
            tf.net_income AS fin_net_income,
            tf.eps_diluted AS fin_eps,
            tf.operating_income AS fin_operating_income,
            tf.gross_profit AS fin_gross_profit,
            tf.total_assets AS fin_total_assets,
            tf.total_liabilities AS fin_total_liabilities,
            tf.total_equity AS fin_total_equity,
            tf.operating_cash_flow AS fin_operating_cf,
            tf.fiscal_period AS fin_fiscal_period,
            tf.fiscal_year AS fin_fiscal_year,
            tf.filing_date AS fin_filing_date,
            -- Derived fundamental ratios
            CASE WHEN tf.total_equity > 0
                THEN ROUND(tf.total_liabilities / tf.total_equity, 2)
            END AS fin_debt_to_equity,
            CASE WHEN tf.revenues > 0
                THEN ROUND(tf.operating_income / tf.revenues * 100, 2)
            END AS fin_operating_margin_pct,
            CASE WHEN tf.revenues > 0
                THEN ROUND(tf.gross_profit / tf.revenues * 100, 2)
            END AS fin_gross_margin_pct,
            -- YoY revenue growth
            CASE WHEN tfp.prev_revenues > 0
                THEN ROUND((tf.revenues - tfp.prev_revenues) / tfp.prev_revenues * 100, 2)
            END AS fin_revenue_growth_yoy,
            -- Days since IPO
            CASE WHEN td.list_date IS NOT NULL AND td.list_date != ''
                THEN CAST(t.entry_time AS DATE) - TRY_CAST(td.list_date AS DATE)
            END AS days_since_ipo,
            -- News features
            COALESCE(tn.news_count_24h, 0) AS news_count_24h,
            COALESCE(tn.news_institutional_count, 0) AS news_institutional_count,
            COALESCE(tn.news_same_day_count, 0) AS news_same_day_count,
            CASE WHEN COALESCE(tn.news_count_24h, 0) >= 6 THEN 'high'
                 WHEN COALESCE(tn.news_count_24h, 0) >= 3 THEN 'medium'
                 WHEN COALESCE(tn.news_count_24h, 0) >= 1 THEN 'low'
                 ELSE 'none'
            END AS news_volume_bucket,
            CASE WHEN COALESCE(tn.news_institutional_count, 0) > 0
                THEN TRUE ELSE FALSE
            END AS news_has_institutional,
            -- FRED macro features
            m.vix AS macro_vix,
            m.yield_spread_10y2y AS macro_yield_spread,
            m.yield_10y AS macro_yield_10y,
            m.yield_2y AS macro_yield_2y,
            m.fed_funds_rate AS macro_fed_funds,
            m.vix_5d_change AS macro_vix_momentum,
            m.vix_regime AS macro_vix_regime,
            m.yield_curve_regime AS macro_yield_curve_regime,
            m.rate_regime AS macro_rate_regime,
            m.rate_direction AS macro_rate_direction,
            m.put_call_equity AS macro_put_call_equity,
            m.put_call_total AS macro_put_call_total,
            m.put_call_regime AS macro_put_call_regime,
            m.put_call_5d_change AS macro_put_call_momentum,
            -- Economic event flags
            COALESCE(ev.is_fomc_day, 0) AS is_fomc_day,
            COALESCE(ev.is_nfp_day, 0) AS is_nfp_day,
            COALESCE(ev.is_event_day, 0) AS is_event_day,
            -- Earnings proximity (windowed: prev + next earnings date)
            (SELECT MAX(ec.earnings_date) FROM earnings_calendar ec
             WHERE ec.symbol = t.symbol
             AND ec.earnings_date <= CAST(t.entry_time AS DATE)
            ) AS prev_earnings_date,
            (SELECT MIN(ec.earnings_date) FROM earnings_calendar ec
             WHERE ec.symbol = t.symbol
             AND ec.earnings_date > CAST(t.entry_time AS DATE)
            ) AS next_earnings_date,
            -- SPY relative strength at entry
            ts.spy_price_at_entry,
            ts.spy_open_price,
            ts.spy_intraday_pct_at_entry,
            ts.spy_volume_at_entry,
            -- Market breadth (trade date)
            tb.mkt_total_stocks,
            tb.mkt_advancers,
            tb.mkt_decliners,
            tb.mkt_advance_ratio,
            tb.mkt_total_volume,
            -- Prior-day context (gap, volume, range)
            tdc.prior_day_close,
            tdc.prior_day_volume,
            tdc.prior_day_high,
            tdc.prior_day_low,
            tdc.entry_gap_pct,
            tdc.spy_prior_close,
            -- Benzinga news features
            COALESCE(tbz.bz_article_count_24h, 0) AS bz_article_count_24h,
            COALESCE(tbz.bz_article_count_2h, 0) AS bz_article_count_2h,
            COALESCE(tbz.bz_article_count_30m, 0) AS bz_article_count_30m,
            COALESCE(tbz.bz_same_day_count, 0) AS bz_same_day_count,
            tbz.bz_minutes_since_last,
            COALESCE(tbz.bz_institutional_count, 0) AS bz_institutional_count,
            tbz.bz_nearest_channels,
            -- Analyst ratings features (30-day lookback)
            COALESCE(tar.ar_rating_count_30d, 0) AS ar_rating_count_30d,
            COALESCE(tar.ar_upgrades_30d, 0) AS ar_upgrades_30d,
            COALESCE(tar.ar_downgrades_30d, 0) AS ar_downgrades_30d,
            COALESCE(tar.ar_distinct_firms_30d, 0) AS ar_distinct_firms_30d,
            COALESCE(tar.ar_momentum_30d, 0) AS ar_momentum_30d,
            tar.ar_avg_pt,
            tar.ar_pt_upside_pct,
            tar.ar_latest_action,
            tar.ar_latest_rating,
            tar.ar_latest_firm,
            tar.ar_days_since_latest,
            -- Corporate guidance features (60-day lookback)
            COALESCE(tcg.cg_changes_60d, 0) AS cg_changes_60d,
            COALESCE(tcg.cg_raised_count, 0) AS cg_raised_count,
            COALESCE(tcg.cg_lowered_count, 0) AS cg_lowered_count,
            COALESCE(tcg.cg_net_direction, 0) AS cg_net_direction,
            tcg.cg_latest_direction,
            tcg.cg_latest_type,
            tcg.cg_latest_change_pct,
            tcg.cg_days_since_latest,
            -- Massive daily bars (same-day VWAP)
            tmb.massive_vwap,
            tmb.massive_num_trades,
            tmb.massive_volume,
            tmb.entry_vs_vwap_pct,
            -- NBBO spread quality at entry
            tnbbo.nbbo_bid,
            tnbbo.nbbo_ask,
            tnbbo.nbbo_spread,
            tnbbo.nbbo_spread_pct,
            tnbbo.nbbo_midpoint,
            tnbbo.nbbo_bid_size,
            tnbbo.nbbo_ask_size,
            tnbbo.entry_vs_midpoint_pct,
            -- Float data
            tfl.free_float,
            tfl.free_float_percent,
            tfl.float_rotation_pct,
            -- Short interest
            tsi.short_interest,
            tsi.si_avg_daily_volume,
            tsi.days_to_cover,
            tsi.si_settlement_date,
            tsi.short_pct_float,
            -- Short volume (trade day)
            tsv.short_volume,
            tsv.sv_total_volume,
            tsv.short_volume_ratio,
            tsv.exempt_volume,
            tsv.non_exempt_volume,
            -- Benzinga earnings (most recent before trade)
            tearns.actual_eps,
            tearns.estimated_eps,
            tearns.eps_surprise,
            tearns.eps_surprise_percent,
            tearns.actual_revenue,
            tearns.estimated_revenue,
            tearns.revenue_surprise_percent,
            tearns.earnings_report_date,
            tearns.days_since_earnings,
            tearns.earnings_importance,
            -- Dividends
            tdiv.ex_dividend_date,
            tdiv.div_cash_amount,
            tdiv.div_frequency,
            tdiv.div_type,
            tdiv.days_since_ex_div,
            tdiv.near_ex_div,
            -- Splits
            tspl.split_date,
            tspl.split_from,
            tspl.split_to,
            tspl.split_type,
            tspl.days_since_split,
            -- IPO
            tipo.listing_date,
            tipo.ipo_price,
            tipo.days_since_ipo,
            tipo.is_recent_ipo,
            -- Financial ratios
            trat.price_to_earnings,
            trat.price_to_book,
            trat.ev_to_ebitda,
            trat.return_on_equity,
            trat.return_on_assets,
            trat.current_ratio,
            trat.free_cash_flow,
            -- Consensus ratings
            tcon.consensus_rating,
            tcon.consensus_rating_value,
            tcon.cr_strong_buy,
            tcon.cr_buy,
            tcon.cr_hold,
            tcon.cr_sell,
            tcon.cr_strong_sell,
            tcon.consensus_pt,
            tcon.cr_pt_high,
            tcon.cr_pt_low,
            tcon.cr_pt_upside_pct,
            -- Related tickers
            trel.related_ticker_count,
            -- Coverage flags
            CASE WHEN EXISTS (
                SELECT 1 FROM bars b
                WHERE b.symbol = t.symbol
                AND CAST(b.bar_time AS DATE) = CAST(t.entry_time AS DATE)
            ) THEN TRUE ELSE FALSE END AS has_minute_bars,
            CASE WHEN r.trade_id IS NOT NULL
                THEN TRUE ELSE FALSE END AS has_regime_data,
            CASE WHEN ts.spy_price_at_entry IS NOT NULL
                THEN TRUE ELSE FALSE END AS has_spy_context,
            CASE WHEN tb.mkt_total_stocks IS NOT NULL
                THEN TRUE ELSE FALSE END AS has_breadth_data,
            CASE WHEN tdc.prior_day_close IS NOT NULL
                THEN TRUE ELSE FALSE END AS has_prior_day
        FROM trades t
        LEFT JOIN trade_regime r ON t.trade_id = r.trade_id
        LEFT JOIN ticker_details td ON t.symbol = td.symbol
        LEFT JOIN (
            SELECT strategy_filter, exit_rule, param_json,
                   avg_pnl, profit_factor, win_rate, sharpe, max_drawdown, total_trades,
                   ROW_NUMBER() OVER (PARTITION BY strategy_filter ORDER BY profit_factor DESC) AS rn
            FROM optimization_results
        ) o ON t.strategy = o.strategy_filter AND o.rn = 1
        LEFT JOIN trade_financials tf ON tf.trade_id = t.trade_id AND tf.rn = 1
        LEFT JOIN trade_fin_prev tfp ON tfp.trade_id = t.trade_id AND tfp.rn = 1
        LEFT JOIN trade_news tn ON tn.trade_id = t.trade_id
        LEFT JOIN fred_macro_daily m ON m.date = CAST(t.entry_time AS DATE)
        -- New Bronze sources
        LEFT JOIN trade_spy ts ON ts.trade_id = t.trade_id
        LEFT JOIN trade_breadth tb ON tb.trade_id = t.trade_id
        LEFT JOIN trade_daily_context tdc ON tdc.trade_id = t.trade_id
        -- Economic event flags
        LEFT JOIN economic_event_flags ev ON ev.date = CAST(t.entry_time AS DATE)
        -- Benzinga news (aggregated by trade)
        LEFT JOIN trade_benzinga tbz ON tbz.trade_id = t.trade_id
        -- Massive.com enrichment sources
        LEFT JOIN trade_analyst tar ON tar.trade_id = t.trade_id
        LEFT JOIN trade_guidance tcg ON tcg.trade_id = t.trade_id
        LEFT JOIN trade_massive_bar tmb ON tmb.trade_id = t.trade_id
        LEFT JOIN trade_nbbo tnbbo ON tnbbo.trade_id = t.trade_id
        LEFT JOIN trade_float tfl ON tfl.trade_id = t.trade_id
        LEFT JOIN trade_short_interest tsi ON tsi.trade_id = t.trade_id
        LEFT JOIN trade_short_volume tsv ON tsv.trade_id = t.trade_id
        LEFT JOIN trade_earnings tearns ON tearns.trade_id = t.trade_id
        LEFT JOIN trade_dividends tdiv ON tdiv.trade_id = t.trade_id
        LEFT JOIN trade_splits tspl ON tspl.trade_id = t.trade_id
        LEFT JOIN trade_ipo tipo ON tipo.trade_id = t.trade_id
        LEFT JOIN trade_ratios trat ON trat.trade_id = t.trade_id
        LEFT JOIN trade_consensus tcon ON tcon.trade_id = t.trade_id
        LEFT JOIN trade_related trel ON trel.trade_id = t.trade_id
        ORDER BY t.entry_time
    """).fetchdf()

    db.close()
    logger.info(f"Extracted {len(df):,} trades from Bronze")
    return df


# ---------------------------------------------------------------------------
# 1b. Enrich with Polygon technical indicators (parquet)
# ---------------------------------------------------------------------------

def enrich_with_indicators(df: pd.DataFrame) -> pd.DataFrame:
    """
    Join Polygon pre-computed indicator values to each trade on (symbol, date).
    Reads parquet files from INDICATOR_DIR, filters to trade symbols, merges.
    Adds: ind_sma_20, ind_sma_50, ind_ema_9, ind_ema_21, ind_rsi_14,
          ind_macd_value, ind_macd_signal, ind_macd_histogram
    """
    if not INDICATOR_DIR.exists():
        logger.info("No indicator directory found, skipping indicator enrichment")
        return df

    # Build join key matching parquet date type (datetime.date)
    df["_ind_date"] = pd.to_datetime(df["entry_time"]).dt.date
    trade_symbols = set(df["symbol"].unique())

    indicator_files = [
        ("ind_sma_20",  "sma_20.parquet"),
        ("ind_sma_50",  "sma_50.parquet"),
        ("ind_ema_9",   "ema_9.parquet"),
        ("ind_ema_21",  "ema_21.parquet"),
        ("ind_rsi_14",  "rsi_14.parquet"),
    ]

    for col_name, filename in indicator_files:
        path = INDICATOR_DIR / filename
        if not path.exists():
            df[col_name] = np.nan
            continue
        ind = pd.read_parquet(path, columns=["ticker", "date", "value"])
        ind = ind[ind["ticker"].isin(trade_symbols)]
        ind = ind.rename(columns={"ticker": "symbol", "date": "_ind_date", "value": col_name})
        ind = ind.drop_duplicates(subset=["symbol", "_ind_date"], keep="first")
        df = df.merge(ind[["symbol", "_ind_date", col_name]],
                       on=["symbol", "_ind_date"], how="left")

    # MACD has 3 value columns
    macd_path = INDICATOR_DIR / "macd.parquet"
    if macd_path.exists():
        macd = pd.read_parquet(macd_path,
                               columns=["ticker", "date", "value", "signal", "histogram"])
        macd = macd[macd["ticker"].isin(trade_symbols)]
        macd = macd.rename(columns={
            "ticker": "symbol", "date": "_ind_date",
            "value": "ind_macd_value", "signal": "ind_macd_signal",
            "histogram": "ind_macd_histogram",
        })
        macd = macd.drop_duplicates(subset=["symbol", "_ind_date"], keep="first")
        df = df.merge(
            macd[["symbol", "_ind_date", "ind_macd_value", "ind_macd_signal", "ind_macd_histogram"]],
            on=["symbol", "_ind_date"], how="left",
        )
    else:
        for c in ["ind_macd_value", "ind_macd_signal", "ind_macd_histogram"]:
            df[c] = np.nan

    df = df.drop(columns=["_ind_date"])

    matched = df["ind_sma_20"].notna().sum()
    logger.info(f"Indicator enrichment: {matched:,}/{len(df):,} trades matched "
                f"({matched / len(df) * 100:.1f}%)")
    return df


# ---------------------------------------------------------------------------
# 1c. Enrich with Polygon market snapshots (parquet)
# ---------------------------------------------------------------------------

def enrich_with_snapshots(df: pd.DataFrame) -> pd.DataFrame:
    """
    Join Polygon full-market snapshot data to each trade on (symbol, date).
    Reads daily parquet files from SNAPSHOT_DIR.
    Adds: snap_day_vwap, snap_prev_close, snap_prev_volume,
          snap_change_pct, snap_day_volume, snap_day_open/high/low/close
    """
    if not SNAPSHOT_DIR.exists():
        logger.info("No snapshot directory found, skipping snapshot enrichment")
        return df

    files = sorted(SNAPSHOT_DIR.glob("*.parquet"))
    if not files:
        logger.info("No snapshot files found, skipping")
        return df

    # Read all daily snapshot files, tag with date from filename
    frames = []
    for f in files:
        sdf = pd.read_parquet(f)
        sdf["_snap_date"] = pd.to_datetime(f.stem).date()  # datetime.date
        frames.append(sdf)

    snaps = pd.concat(frames, ignore_index=True)

    # Rename to Silver conventions
    rename_map = {
        "ticker": "symbol",
        "day_vw": "snap_day_vwap",
        "prev_c": "snap_prev_close",
        "prev_v": "snap_prev_volume",
        "todays_change_pct": "snap_change_pct",
        "day_v": "snap_day_volume",
        "day_o": "snap_day_open",
        "day_h": "snap_day_high",
        "day_l": "snap_day_low",
        "day_c": "snap_day_close",
    }
    snaps = snaps.rename(columns=rename_map)

    keep_cols = ["symbol", "_snap_date"] + [v for v in rename_map.values() if v != "symbol"]
    snaps = snaps[[c for c in keep_cols if c in snaps.columns]]
    snaps = snaps.drop_duplicates(subset=["symbol", "_snap_date"], keep="first")

    # Merge
    df["_snap_date"] = pd.to_datetime(df["entry_time"]).dt.date
    df = df.merge(snaps, on=["symbol", "_snap_date"], how="left")
    df = df.drop(columns=["_snap_date"])

    # Ensure all snapshot columns exist
    for col in rename_map.values():
        if col != "symbol" and col not in df.columns:
            df[col] = np.nan

    matched = df["snap_day_vwap"].notna().sum()
    logger.info(f"Snapshot enrichment: {matched:,}/{len(df):,} trades matched "
                f"({matched / len(df) * 100:.1f}%)")
    return df


# ---------------------------------------------------------------------------
# 2. Transform — computed columns + conditional metrics
# ---------------------------------------------------------------------------

def transform(df: pd.DataFrame) -> pd.DataFrame:
    """Add all computed columns, conditional metrics, and enrichments."""

    # ── Core computed columns ────────────────────────────────────
    df["hold_minutes"] = (
        pd.to_datetime(df["exit_time"]) - pd.to_datetime(df["entry_time"])
    ).dt.total_seconds() / 60
    df["hold_minutes"] = df["hold_minutes"].clip(lower=0).fillna(0).astype(int)

    df["pnl_per_share"] = (df["holly_pnl"] / df["shares"].replace(0, 1)).round(4)
    df["is_winner"] = df["holly_pnl"] > 0
    df["is_loser"] = df["holly_pnl"] < 0

    # R-multiple
    risk = (df["entry_price"] - df["stop_price"]).abs()
    df["risk_per_share"] = risk
    df["r_multiple"] = (df["pnl_per_share"] / risk.replace(0, float("nan"))).round(2)

    # ── Normalized metrics ───────────────────────────────────────
    capital_deployed = df["entry_price"] * df["shares"]
    df["pct_return"] = (
        df["holly_pnl"] / capital_deployed.replace(0, float("nan")) * 100
    ).round(4)

    risk_safe = risk.replace(0, float("nan"))
    df["mfe_r"] = (df["mfe"] / risk_safe).round(2)
    df["mae_r"] = (df["mae"] / risk_safe).round(2)

    # ── Dual-track normalization (vendor vs price) ────────────────
    # Price track: direction-adjusted entry→exit math
    is_long = df["direction"] == "Long"
    df["signed_exit_move_ps"] = np.where(
        is_long,
        df["exit_price"] - df["entry_price"],
        df["entry_price"] - df["exit_price"],
    ).round(4)
    df["risk_pct"] = (risk / df["entry_price"].replace(0, float("nan")) * 100).round(4)
    df["price_return_pct"] = (
        df["signed_exit_move_ps"] / df["entry_price"].replace(0, float("nan")) * 100
    ).round(4)
    df["price_exit_R"] = (df["signed_exit_move_ps"] / risk_safe).round(4)

    # Vendor track: holly_pnl-derived (may differ from price track)
    df["vendor_pnl_ps"] = df["pnl_per_share"]  # already computed above
    df["vendor_R"] = (df["vendor_pnl_ps"] / risk_safe).round(4)

    # Per-share excursions
    shares_safe = df["shares"].replace(0, 1)
    df["mfe_ps"] = (df["mfe"] / shares_safe).round(4)
    df["mae_ps"] = (df["mae"] / shares_safe).round(4)
    df["mfe_R"] = df["mfe_r"]  # alias for clarity in dual-track reports
    df["mae_R"] = df["mae_r"]

    # Capture ratios: how much of MFE was actually captured?
    mfe_r_safe = df["mfe_r"].replace(0, float("nan"))
    df["vendor_capture_ratio"] = np.where(
        df["mfe_r"] > 0,
        (df["vendor_R"] / mfe_r_safe).round(4),
        np.nan,
    )
    df["price_capture_ratio"] = np.where(
        df["mfe_r"] > 0,
        (df["price_exit_R"] / mfe_r_safe).round(4),
        np.nan,
    )

    # Capital-efficiency on 100-share baseline
    baseline_notional = df["shares"] * df["entry_price"]
    notional_safe = baseline_notional.replace(0, float("nan"))
    df["baseline_notional"] = baseline_notional.round(2)
    df["baseline_vendor_ron"] = (df["holly_pnl"] / notional_safe * 100).round(4)
    df["baseline_price_ron"] = (
        (df["signed_exit_move_ps"] * df["shares"]) / notional_safe * 100
    ).round(4)

    # Vendor vs price track disagreement
    df["vendor_price_delta_R"] = (df["vendor_R"] - df["price_exit_R"]).abs().round(4)
    df["vendor_price_disagree"] = df["vendor_price_delta_R"] > 0.25

    # ── Quality-control flags ─────────────────────────────────────
    df["bad_risk_flag"] = (risk <= 0) | risk.isna()
    df["penny_flag"] = df["entry_price"] < 2
    df["low_price_flag"] = df["entry_price"] < 5
    df["high_risk_pct_flag"] = df["risk_pct"] > 8.0  # >8% risk-to-entry
    df["small_cap_flag"] = (
        df["market_cap"].notna() & (df["market_cap"] < 300_000_000)
    ) if "market_cap" in df.columns else False

    # ── Relative strength vs SPY ────────────────────────────────
    if "spy_price_at_entry" in df.columns and "spy_prior_close" in df.columns:
        spy_prior_safe = df["spy_prior_close"].replace(0, float("nan"))
        # SPY daily return through entry time
        df["spy_daily_return_pct"] = (
            (df["spy_price_at_entry"] - df["spy_prior_close"]) / spy_prior_safe * 100
        ).round(4)
        # Relative return vs SPY (trade return minus SPY return)
        df["relative_return_vs_spy"] = (df["pct_return"] - df["spy_daily_return_pct"]).round(4)

    # ── Market breadth derived metrics ────────────────────────────
    if "mkt_advancers" in df.columns and "mkt_decliners" in df.columns:
        adv_safe = df["mkt_advancers"].replace(0, float("nan"))
        dec_safe = df["mkt_decliners"].replace(0, float("nan"))
        df["mkt_ad_ratio"] = (df["mkt_advancers"] / dec_safe).round(2)
        df["mkt_breadth_regime"] = pd.cut(
            df["mkt_advance_ratio"],
            bins=[0, 0.35, 0.45, 0.55, 0.65, 1.0],
            labels=["bearish", "weak", "neutral", "strong", "bullish"],
            right=True,
        )

    # ── Gap context ──────────────────────────────────────────────
    if "entry_gap_pct" in df.columns:
        df["gap_bucket"] = pd.cut(
            df["entry_gap_pct"].abs(),
            bins=[0, 1, 3, 5, 10, float("inf")],
            labels=["<1%", "1-3%", "3-5%", "5-10%", "10%+"],
            right=False,
        )
        df["gap_direction"] = np.where(
            df["entry_gap_pct"] > 0.1, "gap_up",
            np.where(df["entry_gap_pct"] < -0.1, "gap_down", "flat")
        )

    # ── Price buckets for stratification ──────────────────────────
    df["price_bucket"] = pd.cut(
        df["entry_price"],
        bins=[0, 2, 5, 10, 20, 50, 100, float("inf")],
        labels=["<$2", "$2-5", "$5-10", "$10-20", "$20-50", "$50-100", "$100+"],
        right=False,
    )
    df["hold_bucket"] = pd.cut(
        df["hold_minutes"],
        bins=[0, 15, 30, 60, 120, float("inf")],
        labels=["0-15m", "15-30m", "30-60m", "1-2h", "2h+"],
        right=False,
    )

    # ── Risk-budget sizing simulation ────────────────────────────
    shares_from_risk = (SIM_RISK_PER_TRADE / risk_safe).round(0)
    shares_from_capital = (SIM_MAX_CAPITAL / df["entry_price"].replace(0, float("nan"))).round(0)
    df["sim_shares"] = shares_from_risk.clip(upper=SIM_MAX_SHARES)
    df["sim_shares"] = df["sim_shares"].clip(upper=shares_from_capital)
    df["sim_pnl"] = (df["sim_shares"] * df["pnl_per_share"]).round(2)
    df["sim_capital"] = (df["sim_shares"] * df["entry_price"]).round(2)
    df["sim_pct_return"] = (
        df["sim_pnl"] / df["sim_capital"].replace(0, float("nan")) * 100
    ).round(4)

    # ── Time-of-day bucketing (30-min) ───────────────────────────
    entry_dt = pd.to_datetime(df["entry_time"])
    entry_minutes = entry_dt.dt.hour * 60 + entry_dt.dt.minute
    df["tod_bucket"] = (entry_minutes // 30 * 30).apply(
        lambda m: f"{m // 60:02d}:{m % 60:02d}"
    )

    tod_stats = df.groupby("tod_bucket").agg(
        tod_trades=("holly_pnl", "count"),
        tod_win_rate=("is_winner", "mean"),
        tod_avg_pnl=("holly_pnl", "mean"),
    ).round(4)
    df = df.merge(tod_stats, on="tod_bucket", how="left")

    # ── Strategy-level conditional metrics ───────────────────────
    strat_stats = df.groupby("strategy").agg(
        strat_trades=("holly_pnl", "count"),
        strat_win_rate=("is_winner", "mean"),
        strat_avg_pnl=("holly_pnl", "mean"),
        strat_total_pnl=("holly_pnl", "sum"),
        strat_std_pnl=("holly_pnl", "std"),
    ).round(4)
    strat_stats["strat_sharpe"] = np.where(
        strat_stats["strat_std_pnl"] > 0,
        (strat_stats["strat_avg_pnl"] / strat_stats["strat_std_pnl"]).round(4),
        0,
    )
    strat_stats = strat_stats.drop(columns=["strat_std_pnl"])
    df = df.merge(strat_stats, on="strategy", how="left")

    # ── Sector-conditional win rate ──────────────────────────────
    MIN_SECTOR_TRADES = 50
    if "sector" in df.columns:
        sector_mask = df["sector"].notna()
        sector_stats = df.loc[sector_mask].groupby("sector").agg(
            sector_trades=("holly_pnl", "count"),
            sector_win_rate=("is_winner", "mean"),
            sector_avg_pnl=("holly_pnl", "mean"),
        ).round(4)
        sector_stats["sector_reliable"] = (
            (sector_stats["sector_trades"] >= MIN_SECTOR_TRADES)
            & (sector_stats["sector_win_rate"] > 0.52)
        )
        df = df.merge(sector_stats, on="sector", how="left")
    else:
        df["sector_trades"] = np.nan
        df["sector_win_rate"] = np.nan
        df["sector_avg_pnl"] = np.nan
        df["sector_reliable"] = False

    # ── Regime-conditional win rate ──────────────────────────────
    for regime_col in ["trend_regime", "vol_regime", "momentum_regime"]:
        prefix = regime_col.replace("_regime", "")
        if regime_col in df.columns:
            regime_mask = df[regime_col].notna()
            regime_stats = df.loc[regime_mask].groupby(regime_col).agg(
                **{f"{prefix}_cond_wr": ("is_winner", "mean"),
                   f"{prefix}_cond_avg_pnl": ("holly_pnl", "mean"),
                   f"{prefix}_cond_trades": ("holly_pnl", "count")},
            ).round(4)
            df = df.merge(regime_stats, left_on=regime_col, right_index=True, how="left")

    # ── Macro regime-conditional win rates ───────────────────────
    macro_cond_map = {
        "macro_vix_regime": "vix",
        "macro_yield_curve_regime": "yield_curve",
        "macro_rate_regime": "rate_level",
        "macro_rate_direction": "rate_dir",
    }
    for macro_col, prefix in macro_cond_map.items():
        if macro_col in df.columns:
            mask = df[macro_col].notna()
            mstats = df.loc[mask].groupby(macro_col).agg(
                **{f"macro_{prefix}_cond_wr": ("is_winner", "mean"),
                   f"macro_{prefix}_cond_avg_pnl": ("holly_pnl", "mean"),
                   f"macro_{prefix}_cond_trades": ("holly_pnl", "count")},
            ).round(4)
            df = df.merge(mstats, left_on=macro_col, right_index=True, how="left")

    # ── Technical indicator derived features ────────────────────
    if "ind_sma_20" in df.columns:
        sma20_safe = df["ind_sma_20"].replace(0, float("nan"))
        sma50_safe = df["ind_sma_50"].replace(0, float("nan"))
        df["ind_above_sma20"] = df["entry_price"] > df["ind_sma_20"]
        df["ind_above_sma50"] = df["entry_price"] > df["ind_sma_50"]
        df["ind_sma_golden_cross"] = df["ind_sma_20"] > df["ind_sma_50"]
        df["ind_ema_bullish"] = df["ind_ema_9"] > df["ind_ema_21"]
        df["ind_price_vs_sma20_pct"] = (
            (df["entry_price"] - df["ind_sma_20"]) / sma20_safe * 100
        ).round(2)
        df["ind_price_vs_sma50_pct"] = (
            (df["entry_price"] - df["ind_sma_50"]) / sma50_safe * 100
        ).round(2)

    if "ind_rsi_14" in df.columns:
        df["ind_rsi_zone"] = pd.cut(
            df["ind_rsi_14"],
            bins=[0, 30, 70, 100],
            labels=["oversold", "neutral", "overbought"],
            right=True,
        )

    if "ind_macd_histogram" in df.columns:
        df["ind_macd_trend"] = np.where(
            df["ind_macd_histogram"] > 0, "bullish",
            np.where(df["ind_macd_histogram"] < 0, "bearish", "neutral")
        )

    # ── Snapshot derived features ────────────────────────────────
    if "snap_day_vwap" in df.columns:
        vwap_safe = df["snap_day_vwap"].replace(0, float("nan"))
        df["snap_price_vs_vwap"] = np.where(
            df["entry_price"] > df["snap_day_vwap"], "above",
            np.where(df["entry_price"] < df["snap_day_vwap"], "below", "at")
        )
        df["snap_price_vs_vwap_pct"] = (
            (df["entry_price"] - df["snap_day_vwap"]) / vwap_safe * 100
        ).round(2)

    # ── Earnings proximity (windowed) ────────────────────────────
    entry_date = pd.to_datetime(df["entry_time"]).dt.normalize()
    if "prev_earnings_date" in df.columns:
        prev_earn = pd.to_datetime(df["prev_earnings_date"])
        next_earn = pd.to_datetime(df["next_earnings_date"])
        df["earnings_days_since"] = (entry_date - prev_earn).dt.days
        df["earnings_days_until"] = (next_earn - entry_date).dt.days
        df["is_earnings_day"] = df["earnings_days_since"] == 0
        df["earnings_proximity"] = np.select(
            [df["earnings_days_since"] == 0,
             df["earnings_days_until"].between(1, 3),
             df["earnings_days_since"].between(1, 3)],
            ["earnings_day", "pre_earnings_3d", "post_earnings_3d"],
            default="normal",
        )
    else:
        df["earnings_days_since"] = np.nan
        df["earnings_days_until"] = np.nan
        df["is_earnings_day"] = False
        df["earnings_proximity"] = "normal"

    # ── Benzinga derived features ────────────────────────────────
    if "bz_article_count_24h" in df.columns:
        df["bz_has_article_24h"] = df["bz_article_count_24h"] > 0
        df["bz_has_institutional_tag"] = df["bz_institutional_count"] > 0
        df["bz_news_volume_bucket"] = pd.cut(
            df["bz_article_count_24h"],
            bins=[-1, 0, 2, 5, float("inf")],
            labels=["none", "low", "medium", "high"],
            right=True,
        )

    # ── Analyst ratings derived features ────────────────────────
    if "ar_rating_count_30d" in df.columns:
        df["ar_has_activity_30d"] = df["ar_rating_count_30d"] > 0
        df["ar_consensus_direction"] = np.select(
            [df["ar_momentum_30d"] >= 2,
             df["ar_momentum_30d"] <= -2,
             df["ar_momentum_30d"].between(-1, 1)],
            ["bullish", "bearish", "neutral"],
            default="none",
        )
        df["ar_pt_upside_bucket"] = pd.cut(
            df["ar_pt_upside_pct"],
            bins=[-float("inf"), -10, 0, 10, 25, float("inf")],
            labels=["deep_below", "below_pt", "near_pt", "above_pt", "well_above"],
            right=True,
        )

    # ── Guidance derived features ────────────────────────────────
    if "cg_changes_60d" in df.columns:
        df["cg_has_guidance_60d"] = df["cg_changes_60d"] > 0
        df["cg_sentiment"] = np.select(
            [df["cg_net_direction"] > 0,
             df["cg_net_direction"] < 0,
             df["cg_net_direction"] == 0],
            ["positive", "negative", "neutral"],
            default="none",
        )

    # ── Massive VWAP derived features ────────────────────────────
    if "entry_vs_vwap_pct" in df.columns:
        df["massive_above_vwap"] = df["entry_vs_vwap_pct"] > 0
        df["massive_vwap_distance_bucket"] = pd.cut(
            df["entry_vs_vwap_pct"].abs(),
            bins=[0, 0.5, 1, 2, 5, float("inf")],
            labels=["<0.5%", "0.5-1%", "1-2%", "2-5%", "5%+"],
            right=True,
        )

    # ── Float / short interest derived features ────────────────
    if "short_pct_float" in df.columns:
        df["short_squeeze_risk"] = np.select(
            [df["short_pct_float"] >= 20,
             df["short_pct_float"] >= 10,
             df["short_pct_float"] >= 5],
            ["high", "medium", "low"],
            default="none",
        )
        df["days_to_cover_bucket"] = pd.cut(
            df["days_to_cover"],
            bins=[0, 1, 3, 5, 10, float("inf")],
            labels=["<1d", "1-3d", "3-5d", "5-10d", "10d+"],
            right=True,
        )

    if "short_volume_ratio" in df.columns:
        df["short_volume_elevated"] = df["short_volume_ratio"] > 0.5

    # ── Earnings derived features ────────────────────────────────
    if "eps_surprise_percent" in df.columns:
        df["earnings_beat"] = df["eps_surprise_percent"] > 0
        df["earnings_surprise_bucket"] = pd.cut(
            df["eps_surprise_percent"],
            bins=[-float("inf"), -10, -2, 2, 10, float("inf")],
            labels=["big_miss", "miss", "inline", "beat", "big_beat"],
            right=True,
        )
        df["traded_on_earnings"] = df["days_since_earnings"].fillna(999) <= 1

    # ── Splits / IPO derived features ────────────────────────────
    if "days_since_split" in df.columns:
        df["recent_split"] = df["days_since_split"].fillna(999) <= 30

    if "days_since_ipo" in df.columns:
        df["ipo_age_bucket"] = pd.cut(
            df["days_since_ipo"],
            bins=[0, 30, 90, 365, float("inf")],
            labels=["<30d", "30-90d", "90d-1y", "1y+"],
            right=True,
        )

    # ── Event day interaction (FOMC or NFP on trade day) ──────
    if "is_event_day" in df.columns:
        df["event_type"] = np.where(
            df["is_fomc_day"] == 1, "FOMC",
            np.where(df["is_nfp_day"] == 1, "NFP", "none")
        )

    # ── Put/call regime conditional metrics ────────────────────
    if "macro_put_call_regime" in df.columns:
        mask = df["macro_put_call_regime"].notna()
        pcstats = df.loc[mask].groupby("macro_put_call_regime").agg(
            **{"macro_pc_cond_wr": ("is_winner", "mean"),
               "macro_pc_cond_avg_pnl": ("holly_pnl", "mean"),
               "macro_pc_cond_trades": ("holly_pnl", "count")},
        ).round(4)
        df = df.merge(pcstats, left_on="macro_put_call_regime", right_index=True, how="left")

    # ── Coverage flags for new enrichments ────────────────────────
    df["has_indicators"] = df.get("ind_sma_20", pd.Series(dtype=float)).notna()
    df["has_snapshot"] = df.get("snap_day_vwap", pd.Series(dtype=float)).notna()
    df["has_put_call"] = df.get("macro_put_call_equity", pd.Series(dtype=float)).notna()
    df["has_event_flags"] = df.get("is_event_day", pd.Series(dtype=int)).isin([1])
    df["has_benzinga"] = df.get("bz_article_count_24h", pd.Series(dtype=int)) > 0
    df["has_earnings_proximity"] = df.get("earnings_days_since", pd.Series(dtype=float)).notna()
    df["has_analyst_ratings"] = df.get("ar_rating_count_30d", pd.Series(dtype=int)) > 0
    df["has_guidance"] = df.get("cg_changes_60d", pd.Series(dtype=int)) > 0
    df["has_massive_vwap"] = df.get("massive_vwap", pd.Series(dtype=float)).notna()
    df["has_nbbo"] = df.get("nbbo_spread_pct", pd.Series(dtype=float)).notna()
    df["has_float"] = df.get("free_float", pd.Series(dtype=float)).notna()
    df["has_short_interest"] = df.get("short_interest", pd.Series(dtype=float)).notna()
    df["has_short_volume"] = df.get("short_volume_ratio", pd.Series(dtype=float)).notna()
    df["has_bz_earnings"] = df.get("actual_eps", pd.Series(dtype=float)).notna()
    df["has_dividends"] = df.get("ex_dividend_date", pd.Series(dtype=object)).notna()
    df["has_ratios"] = df.get("price_to_earnings", pd.Series(dtype=float)).notna()
    df["has_consensus"] = df.get("consensus_rating", pd.Series(dtype=object)).notna()
    df["has_related"] = df.get("related_ticker_count", pd.Series(dtype=int)) > 0

    # ── Rolling 20-trade trailing metrics per strategy ───────────
    df = df.sort_values(["strategy", "entry_time"])
    df["strat_rolling_wr_20"] = (
        df.groupby("strategy")["is_winner"]
        .transform(lambda x: x.rolling(20, min_periods=10).mean())
    ).round(4)
    df["strat_rolling_pnl_20"] = (
        df.groupby("strategy")["holly_pnl"]
        .transform(lambda x: x.rolling(20, min_periods=10).mean())
    ).round(2)
    df = df.sort_values("entry_time")

    # ── Probability engine enrichment ────────────────────────────
    if PROB_JSON.exists():
        logger.info(f"Enriching with probability data from {PROB_JSON.name}")
        with open(PROB_JSON) as f:
            prob = json.load(f)
        profiles = prob.get("strategy_profiles", [])
        if profiles:
            prof_df = pd.DataFrame(profiles)
            keep_cols = ["strategy", "win_rate", "bayesian_wr_mean", "bayesian_ci_95",
                         "prob_wr_gt_50", "prob_wr_gt_60", "t_stat", "t_p_value",
                         "edge_verdict", "cohens_d", "kelly", "var_95", "payoff_ratio"]
            prof_df = prof_df[[c for c in keep_cols if c in prof_df.columns]]
            rename_map = {
                "win_rate": "prob_win_rate",
                "bayesian_wr_mean": "prob_bayesian_wr",
                "prob_wr_gt_50": "prob_wr_above_50",
                "prob_wr_gt_60": "prob_wr_above_60",
                "t_stat": "prob_t_stat",
                "t_p_value": "prob_t_pvalue",
                "edge_verdict": "prob_edge_verdict",
                "cohens_d": "prob_cohens_d",
                "kelly": "prob_kelly",
                "var_95": "prob_var95",
                "payoff_ratio": "prob_payoff_ratio",
            }
            prof_df = prof_df.rename(columns=rename_map)
            if "bayesian_ci_95" in prof_df.columns:
                prof_df["prob_bayesian_ci_lo"] = prof_df["bayesian_ci_95"].apply(
                    lambda x: x[0] if isinstance(x, list) else np.nan
                )
                prof_df["prob_bayesian_ci_hi"] = prof_df["bayesian_ci_95"].apply(
                    lambda x: x[1] if isinstance(x, list) else np.nan
                )
                prof_df = prof_df.drop(columns=["bayesian_ci_95"])
            df = df.merge(prof_df, on="strategy", how="left")
            logger.info(f"  Matched {df['prob_edge_verdict'].notna().sum():,} trades")
    else:
        logger.info("No probability JSON found, skipping enrichment")

    return df


# ---------------------------------------------------------------------------
# 3. Load — write to Silver DuckDB + Parquet
# ---------------------------------------------------------------------------

def load_to_silver(df: pd.DataFrame, skip_parquet: bool = False) -> dict:
    """Write the canonical Silver table to DuckDB and Parquet."""
    SILVER_DIR.mkdir(parents=True, exist_ok=True)

    # ── Write Silver DuckDB ──────────────────────────────────────
    # Remove old file to avoid schema conflicts on column changes
    if SILVER_DDB.exists():
        SILVER_DDB.unlink()

    silver_db = duckdb.connect(str(SILVER_DDB))
    silver_db.execute("CREATE TABLE holly_trades AS SELECT * FROM df")

    # Add indexes for common query patterns
    silver_db.execute("CREATE INDEX idx_silver_strategy ON holly_trades (strategy)")
    silver_db.execute("CREATE INDEX idx_silver_trade_date ON holly_trades (trade_date)")
    silver_db.execute("CREATE INDEX idx_silver_symbol ON holly_trades (symbol)")

    row_count = silver_db.execute("SELECT COUNT(*) FROM holly_trades").fetchone()[0]
    col_count = silver_db.execute("SELECT COUNT(*) FROM information_schema.columns WHERE table_name = 'holly_trades'").fetchone()[0]
    silver_db.close()

    ddb_size = SILVER_DDB.stat().st_size

    result = {
        "duckdb_path": str(SILVER_DDB),
        "duckdb_size_mb": round(ddb_size / 1e6, 1),
        "rows": row_count,
        "columns": col_count,
    }

    # ── Write Parquet (for PBI Desktop) ──────────────────────────
    if not skip_parquet:
        df.to_parquet(SILVER_PARQUET, index=False, engine="pyarrow")
        pq_size = SILVER_PARQUET.stat().st_size
        result["parquet_path"] = str(SILVER_PARQUET)
        result["parquet_size_mb"] = round(pq_size / 1e6, 1)

    return result


# ---------------------------------------------------------------------------
# 4. Print stats summary
# ---------------------------------------------------------------------------

def print_stats(df: pd.DataFrame, load_result: dict, duration_s: float) -> None:
    """Print build summary to stdout."""
    print(f"\n{'='*60}")
    print(f"SILVER LAYER BUILD COMPLETE")
    print(f"{'='*60}")
    print(f"Duration: {duration_s:.1f}s")
    print(f"Rows:     {load_result['rows']:,}")
    print(f"Columns:  {load_result['columns']}")
    print(f"DuckDB:   {load_result['duckdb_path']} ({load_result['duckdb_size_mb']} MB)")
    if "parquet_path" in load_result:
        print(f"Parquet:  {load_result['parquet_path']} ({load_result['parquet_size_mb']} MB)")

    # Coverage stats
    print(f"\nCoverage:")
    print(f"  With minute bars:  {df['has_minute_bars'].sum():,}")
    print(f"  With regime data:  {df['has_regime_data'].sum():,}")
    print(f"  With optimization: {df['opt_exit_rule'].notna().sum():,}")
    print(f"  With sector data:  {df['sector'].notna().sum():,}")
    if "fin_revenue" in df.columns:
        print(f"  With fundamentals: {df['fin_revenue'].notna().sum():,}")
    if "news_count_24h" in df.columns:
        print(f"  With news (24h):   {(df['news_count_24h'] > 0).sum():,}")
    if "macro_vix" in df.columns:
        print(f"  With macro data:   {df['macro_vix'].notna().sum():,}")
    if "prob_edge_verdict" in df.columns:
        print(f"  With prob data:    {df['prob_edge_verdict'].notna().sum():,}")
    if "has_spy_context" in df.columns:
        print(f"  With SPY context:  {df['has_spy_context'].sum():,}")
    if "has_breadth_data" in df.columns:
        print(f"  With breadth data: {df['has_breadth_data'].sum():,}")
    if "has_prior_day" in df.columns:
        print(f"  With prior day:    {df['has_prior_day'].sum():,}")
    if "has_indicators" in df.columns:
        print(f"  With indicators:   {df['has_indicators'].sum():,}")
    if "has_snapshot" in df.columns:
        print(f"  With snapshots:    {df['has_snapshot'].sum():,}")
    if "has_put_call" in df.columns:
        print(f"  With put/call:     {df['has_put_call'].sum():,}")
    if "has_event_flags" in df.columns:
        print(f"  On event days:     {df['has_event_flags'].sum():,}")
    if "is_earnings_day" in df.columns:
        print(f"  On earnings day:   {df['is_earnings_day'].sum():,}")
    if "has_earnings_proximity" in df.columns:
        print(f"  With earnings prox:{df['has_earnings_proximity'].sum():,}")
    if "has_benzinga" in df.columns:
        print(f"  With Benzinga 24h: {df['has_benzinga'].sum():,}")

    # Date range
    dates = pd.to_datetime(df["trade_date"])
    print(f"\nDate range: {dates.min().date()} to {dates.max().date()}")
    print(f"Strategies: {df['strategy'].nunique()}")
    print(f"Symbols:    {df['symbol'].nunique()}")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="Build Silver Layer")
    parser.add_argument("--skip-parquet", action="store_true", help="Skip Parquet export")
    parser.add_argument("--stats-only", action="store_true", help="Print stats from existing Silver")
    args = parser.parse_args()

    if args.stats_only:
        if not SILVER_DDB.exists():
            logger.error("Silver DuckDB not found. Run build first.")
            sys.exit(1)
        db = duckdb.connect(str(SILVER_DDB), read_only=True)
        df = db.execute("SELECT * FROM holly_trades").fetchdf()
        db.close()
        result = {
            "duckdb_path": str(SILVER_DDB),
            "duckdb_size_mb": round(SILVER_DDB.stat().st_size / 1e6, 1),
            "rows": len(df),
            "columns": len(df.columns),
        }
        if SILVER_PARQUET.exists():
            result["parquet_path"] = str(SILVER_PARQUET)
            result["parquet_size_mb"] = round(SILVER_PARQUET.stat().st_size / 1e6, 1)
        print_stats(df, result, 0)
        return

    start = time.time()

    # ETL pipeline
    logger.info("=== Silver Layer Build ===")
    logger.info("Step 1/5: Extract from Bronze (holly.ddb)")
    df = extract_from_holly_ddb()

    logger.info("Step 2/5: Enrich with Polygon indicators")
    df = enrich_with_indicators(df)

    logger.info("Step 3/5: Enrich with Polygon snapshots")
    df = enrich_with_snapshots(df)

    logger.info(f"Step 4/5: Transform ({len(df):,} rows)")
    df = transform(df)

    logger.info("Step 5/5: Load to Silver")
    result = load_to_silver(df, skip_parquet=args.skip_parquet)

    duration = time.time() - start
    print_stats(df, result, duration)

    # Machine-readable summary for MCP
    summary = {**result, "duration_s": round(duration, 1)}
    print(f"\n{json.dumps(summary)}")


if __name__ == "__main__":
    main()
