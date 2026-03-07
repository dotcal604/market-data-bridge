"""
13_export_analytics.py — Export denormalized analytics file for Tableau/Power BI.

Joins trades + regime features + optimization results + ticker details +
FRED macro data into a single flat Parquet (and CSV) file for BI tool consumption.

Enrichments added post-query:
  - Time-of-day 30-min bucket with conditional win rate & expectancy
  - Strategy-level edge metrics (Bayesian WR, Kelly, edge verdict)
  - Sector-conditional win rates
  - Regime-conditional win rates
  - Macro regime-conditional win rates (VIX, yield curve, rate cycle)
  - Rolling strategy performance (20-trade trailing WR/PnL)

Usage:
    python scripts/13_export_analytics.py
"""

import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).parent.parent))

from config.settings import OUTPUT_DIR, SIM_RISK_PER_TRADE, SIM_MAX_SHARES, SIM_MAX_CAPITAL
from engine.data_loader import get_db

PROB_JSON = Path(__file__).parent.parent.parent / "output" / "statistical_probability.json"


def main():
    db = get_db()

    # ── Build denormalized trade + regime + optimization view ──────────
    df = db.execute("""
        WITH trade_financials AS (
            -- For each trade, find the most recent quarterly filing before trade date
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
            -- For YoY growth: same quarter, prior year
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
            -- News coverage in 24h before trade entry
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
            -- Ticker details (sector, exchange, market cap)
            td.name AS company_name,
            td.sic_code,
            td.sic_description AS sector,
            td.primary_exchange,
            td.market_cap,
            td.total_employees,
            td.address_state,
            td.list_date AS ipo_date,
            -- Fundamental data (most recent quarterly filing before trade date)
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
            -- YoY revenue growth (compare to same quarter prior year)
            CASE WHEN tfp.prev_revenues > 0
                THEN ROUND((tf.revenues - tfp.prev_revenues) / tfp.prev_revenues * 100, 2)
            END AS fin_revenue_growth_yoy,
            -- Days since IPO
            CASE WHEN td.list_date IS NOT NULL AND td.list_date != ''
                THEN CAST(t.entry_time AS DATE) - TRY_CAST(td.list_date AS DATE)
            END AS days_since_ipo,
            -- News features (24h before entry)
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
            -- FRED macro features (100% trade coverage)
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
            -- Bar coverage flag
            CASE WHEN EXISTS (
                SELECT 1 FROM bars b
                WHERE b.symbol = t.symbol
                AND CAST(b.bar_time AS DATE) = CAST(t.entry_time AS DATE)
            ) THEN TRUE ELSE FALSE END AS has_minute_bars,
            -- Daily bar coverage flag
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
        -- Fundamentals: most recent quarterly filing before trade
        LEFT JOIN trade_financials tf ON tf.trade_id = t.trade_id AND tf.rn = 1
        -- YoY revenue comparison
        LEFT JOIN trade_fin_prev tfp ON tfp.trade_id = t.trade_id AND tfp.rn = 1
        -- News coverage
        LEFT JOIN trade_news tn ON tn.trade_id = t.trade_id
        -- FRED macro data
        LEFT JOIN fred_macro_daily m ON m.date = CAST(t.entry_time AS DATE)
        ORDER BY t.entry_time
    """).fetchdf()

    db.close()

    # ── Computed columns ──────────────────────────────────────────────
    df["hold_minutes"] = (
        pd.to_datetime(df["exit_time"]) - pd.to_datetime(df["entry_time"])
    ).dt.total_seconds() / 60
    df["hold_minutes"] = df["hold_minutes"].clip(lower=0).fillna(0).astype(int)

    df["pnl_per_share"] = (df["holly_pnl"] / df["shares"].replace(0, 1)).round(4)

    df["is_winner"] = df["holly_pnl"] > 0
    df["is_loser"] = df["holly_pnl"] < 0

    # R-multiple (if stop_price available)
    risk = (df["entry_price"] - df["stop_price"]).abs()
    df["risk_per_share"] = risk
    df["r_multiple"] = (
        df["pnl_per_share"] / risk.replace(0, float("nan"))
    ).round(2)

    # ── Normalized metrics (separates signal quality from sizing) ──
    # A. % return on deployed capital
    capital_deployed = df["entry_price"] * df["shares"]
    df["pct_return"] = (
        df["holly_pnl"] / capital_deployed.replace(0, float("nan")) * 100
    ).round(4)

    # B. MFE/MAE in R-multiples (excursions normalized by initial risk)
    risk_safe = risk.replace(0, float("nan"))
    df["mfe_r"] = (df["mfe"] / risk_safe).round(2)
    df["mae_r"] = (df["mae"] / risk_safe).round(2)

    # C. Risk-budget sizing simulation
    #    Converts Holly's trade path into user's sizing regime:
    #    fixed $SIM_RISK_PER_TRADE risk, capped by SIM_MAX_SHARES and SIM_MAX_CAPITAL
    shares_from_risk = (SIM_RISK_PER_TRADE / risk_safe).round(0)
    shares_from_capital = (SIM_MAX_CAPITAL / df["entry_price"].replace(0, float("nan"))).round(0)
    df["sim_shares"] = shares_from_risk.clip(upper=SIM_MAX_SHARES)
    df["sim_shares"] = df["sim_shares"].clip(upper=shares_from_capital)
    df["sim_pnl"] = (df["sim_shares"] * df["pnl_per_share"]).round(2)
    df["sim_capital"] = (df["sim_shares"] * df["entry_price"]).round(2)
    df["sim_pct_return"] = (
        df["sim_pnl"] / df["sim_capital"].replace(0, float("nan")) * 100
    ).round(4)

    # ── Time-of-day bucketing (30-min buckets) ─────────────────────
    entry_dt = pd.to_datetime(df["entry_time"])
    entry_minutes = entry_dt.dt.hour * 60 + entry_dt.dt.minute
    df["tod_bucket"] = (entry_minutes // 30 * 30).apply(
        lambda m: f"{m // 60:02d}:{m % 60:02d}"
    )

    # Conditional WR & expectancy per time-of-day bucket
    tod_stats = df.groupby("tod_bucket").agg(
        tod_trades=("holly_pnl", "count"),
        tod_win_rate=("is_winner", "mean"),
        tod_avg_pnl=("holly_pnl", "mean"),
    ).round(4)
    df = df.merge(tod_stats, on="tod_bucket", how="left")

    # ── Strategy-level conditional metrics ─────────────────────────
    strat_stats = df.groupby("strategy").agg(
        strat_trades=("holly_pnl", "count"),
        strat_win_rate=("is_winner", "mean"),
        strat_avg_pnl=("holly_pnl", "mean"),
        strat_total_pnl=("holly_pnl", "sum"),
        strat_std_pnl=("holly_pnl", "std"),
    ).round(4)
    # Sharpe proxy (mean/std annualized by sqrt(trades))
    strat_stats["strat_sharpe"] = np.where(
        strat_stats["strat_std_pnl"] > 0,
        (strat_stats["strat_avg_pnl"] / strat_stats["strat_std_pnl"]).round(4),
        0,
    )
    strat_stats = strat_stats.drop(columns=["strat_std_pnl"])
    df = df.merge(strat_stats, on="strategy", how="left")

    # ── Sector-conditional win rate ────────────────────────────────
    # MIN_SECTOR_TRADES: sectors with fewer trades than this threshold
    # show unreliable WR (100% on 5 trades, etc.) that doesn't persist
    # out-of-sample.  Investigation (equity_curves_investigation.py)
    # found 106/203 passing sectors had <20 trades, causing -11.8pp OOS
    # decay.  n>=50 cuts decay to -10.0pp; n>=100 to -7.8pp.
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

    # ── Regime-conditional win rate (per regime state) ─────────────
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

    # ── Macro regime-conditional win rates ─────────────────────────
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

    # ── Rolling 20-trade trailing metrics per strategy ─────────────
    df = df.sort_values(["strategy", "entry_time"])
    df["strat_rolling_wr_20"] = (
        df.groupby("strategy")["is_winner"]
        .transform(lambda x: x.rolling(20, min_periods=10).mean())
    ).round(4)
    df["strat_rolling_pnl_20"] = (
        df.groupby("strategy")["holly_pnl"]
        .transform(lambda x: x.rolling(20, min_periods=10).mean())
    ).round(2)
    df = df.sort_values("entry_time")  # restore chronological order

    # ── Probability engine results (per strategy) ──────────────────
    if PROB_JSON.exists():
        print(f"  Loading probability results from {PROB_JSON.name}...")
        with open(PROB_JSON) as f:
            prob = json.load(f)
        profiles = prob.get("strategy_profiles", [])
        if profiles:
            prof_df = pd.DataFrame(profiles)[
                ["strategy", "win_rate", "bayesian_wr_mean", "bayesian_ci_95",
                 "prob_wr_gt_50", "prob_wr_gt_60", "t_stat", "t_p_value",
                 "edge_verdict", "cohens_d", "kelly", "var_95", "payoff_ratio"]
            ].rename(columns={
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
            })
            # Bayesian CI -> two columns
            prof_df["prob_bayesian_ci_lo"] = prof_df["bayesian_ci_95"].apply(
                lambda x: x[0] if isinstance(x, list) else np.nan
            )
            prof_df["prob_bayesian_ci_hi"] = prof_df["bayesian_ci_95"].apply(
                lambda x: x[1] if isinstance(x, list) else np.nan
            )
            prof_df = prof_df.drop(columns=["bayesian_ci_95"])
            df = df.merge(prof_df, on="strategy", how="left")
            print(f"    Matched {df['prob_edge_verdict'].notna().sum():,} trades with probability data")
    else:
        print("  No probability JSON found, skipping. Run statistical_probability.py first.")

    # ── Export ─────────────────────────────────────────────────────────
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    parquet_path = OUTPUT_DIR / "holly_analytics.parquet"
    csv_path = OUTPUT_DIR / "holly_analytics.csv"

    df.to_parquet(parquet_path, index=False, engine="pyarrow")
    df.to_csv(csv_path, index=False)

    print(f"Exported {len(df):,} trades")
    print(f"  Parquet: {parquet_path} ({parquet_path.stat().st_size / 1e6:.1f} MB)")
    print(f"  CSV:     {csv_path} ({csv_path.stat().st_size / 1e6:.1f} MB)")
    print(f"  Columns: {len(df.columns)}")
    print(f"  With minute bars: {df['has_minute_bars'].sum():,}")
    print(f"  With regime data: {df['has_regime_data'].sum():,}")
    print(f"  With optimization: {df['opt_exit_rule'].notna().sum():,}")
    print(f"  With sector data:  {df['sector'].notna().sum():,}")
    if "fin_revenue" in df.columns:
        print(f"  With fundamentals: {df['fin_revenue'].notna().sum():,}")
        print(f"  With rev growth:   {df['fin_revenue_growth_yoy'].notna().sum():,}")
    if "news_count_24h" in df.columns:
        has_news = (df["news_count_24h"] > 0).sum()
        has_inst = (df["news_institutional_count"] > 0).sum()
        print(f"  With news (24h):   {has_news:,}")
        print(f"  With institutional: {has_inst:,}")
    if "macro_vix" in df.columns:
        has_macro = df["macro_vix"].notna().sum()
        print(f"  With macro data:   {has_macro:,}")
        if "macro_vix_regime" in df.columns:
            vix_dist = df["macro_vix_regime"].dropna().value_counts()
            for regime, cnt in vix_dist.items():
                print(f"    VIX {regime}: {cnt:,}")
    if "prob_edge_verdict" in df.columns:
        print(f"  With prob data:    {df['prob_edge_verdict'].notna().sum():,}")
        # Show edge verdict distribution
        verdicts = df["prob_edge_verdict"].dropna().value_counts()
        for v, c in verdicts.items():
            print(f"    {v}: {c:,} trades")

    # Column summary by category
    print(f"\nColumns ({len(df.columns)} total):")
    categories = {
        "Trade Core": ["trade_id", "symbol", "strategy", "direction", "entry_time",
                       "entry_price", "exit_time", "exit_price", "real_entry_price",
                       "real_entry_time", "holly_pnl", "shares", "stop_price",
                       "target_price", "mfe", "mae", "stop_buffer_pct"],
        "Time": ["trade_date", "trade_year", "trade_month", "trade_dow",
                 "entry_hour", "tod_bucket"],
        "Regime": ["sma20", "sma5", "trend_slope", "above_sma20", "atr14",
                   "atr_pct", "daily_range_pct", "rsi14", "roc5", "roc20",
                   "trend_regime", "vol_regime", "momentum_regime"],
        "Optimization": ["opt_exit_rule", "opt_params", "opt_avg_pnl",
                        "opt_profit_factor", "opt_win_rate", "opt_sharpe",
                        "opt_max_drawdown", "opt_total_trades"],
        "Ticker": ["company_name", "sic_code", "sector", "primary_exchange",
                   "market_cap", "total_employees", "address_state", "ipo_date",
                   "days_since_ipo"],
        "Fundamentals": ["fin_revenue", "fin_net_income", "fin_eps",
                        "fin_operating_income", "fin_gross_profit",
                        "fin_total_assets", "fin_total_liabilities", "fin_total_equity",
                        "fin_operating_cf", "fin_fiscal_period", "fin_fiscal_year",
                        "fin_filing_date", "fin_debt_to_equity",
                        "fin_operating_margin_pct", "fin_gross_margin_pct",
                        "fin_revenue_growth_yoy"],
        "News": ["news_count_24h", "news_institutional_count",
                 "news_same_day_count", "news_volume_bucket",
                 "news_has_institutional"],
        "Macro": ["macro_vix", "macro_yield_spread", "macro_yield_10y",
                  "macro_yield_2y", "macro_fed_funds", "macro_vix_momentum",
                  "macro_vix_regime", "macro_yield_curve_regime",
                  "macro_rate_regime", "macro_rate_direction"],
        "Computed": ["hold_minutes", "pnl_per_share", "is_winner", "is_loser",
                     "risk_per_share", "r_multiple", "pct_return",
                     "mfe_r", "mae_r", "has_minute_bars", "has_regime_data"],
        "Simulated Sizing": ["sim_shares", "sim_pnl", "sim_capital", "sim_pct_return"],
        "Conditional (new)": [c for c in df.columns if c.startswith(
                             ("tod_", "strat_", "sector_", "trend_cond",
                              "vol_cond", "momentum_cond", "prob_"))
                             or ("_cond_" in c and c.startswith("macro_"))],
    }
    listed = set()
    for cat, cols in categories.items():
        present = [c for c in cols if c in df.columns]
        if present:
            print(f"  [{cat}] ({len(present)})")
            for col in present:
                dtype = df[col].dtype
                nulls = df[col].isna().sum()
                print(f"    {col:<30} {str(dtype):<15} {nulls:>6} nulls")
                listed.add(col)
    # Any unlisted columns
    unlisted = [c for c in df.columns if c not in listed]
    if unlisted:
        print(f"  [Other] ({len(unlisted)})")
        for col in unlisted:
            dtype = df[col].dtype
            nulls = df[col].isna().sum()
            print(f"    {col:<30} {str(dtype):<15} {nulls:>6} nulls")


if __name__ == "__main__":
    main()
