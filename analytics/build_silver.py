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

    df = db.execute("""
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
        )
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
            -- Coverage flags
            CASE WHEN EXISTS (
                SELECT 1 FROM bars b
                WHERE b.symbol = t.symbol
                AND CAST(b.bar_time AS DATE) = CAST(t.entry_time AS DATE)
            ) THEN TRUE ELSE FALSE END AS has_minute_bars,
            CASE WHEN r.trade_id IS NOT NULL
                THEN TRUE ELSE FALSE END AS has_regime_data
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
        ORDER BY t.entry_time
    """).fetchdf()

    db.close()
    logger.info(f"Extracted {len(df):,} trades from Bronze")
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
    logger.info("Step 1/3: Extract from Bronze (holly.ddb)")
    df = extract_from_holly_ddb()

    logger.info(f"Step 2/3: Transform ({len(df):,} rows)")
    df = transform(df)

    logger.info("Step 3/3: Load to Silver")
    result = load_to_silver(df, skip_parquet=args.skip_parquet)

    duration = time.time() - start
    print_stats(df, result, duration)

    # Machine-readable summary for MCP
    summary = {**result, "duration_s": round(duration, 1)}
    print(f"\n{json.dumps(summary)}")


if __name__ == "__main__":
    main()
