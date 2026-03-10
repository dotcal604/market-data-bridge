"""
Script 80 -- Composite v8: Modern Era (2021+) with Benzinga Features
====================================================================
Addresses the v7 training coverage problem: full 2016-2026 dataset with
60/40 chronological split puts ALL training data in pre-Benzinga era (2016-2021),
giving Benzinga features 0% training coverage.

Solution: Train and test ONLY on 2021+ trades where Benzinga data exists.
  - ~7,056 trades in 2021-01-01 to 2026-03-04 range
  - 44.8% Benzinga coverage within this window
  - 60/40 chronological split within this subset

Tests:
  1. v6_modern_baseline — v6 features on 2021+ data only
  2. v8_with_benzinga  — v6 + 5 Benzinga features on 2021+ data
  3. v8_depth4         — deeper trees for more interaction
  4. v8_more_features  — add more Benzinga features (earnings, movers, 52w)

Also runs v6 on FULL dataset as reference to measure modern-era-only tradeoff.

Walk-forward: 60% train / 40% test (chronological, within 2021+ subset).

Usage:
    python scripts/80_composite_v8_modern_era.py
"""

import sys, time, warnings
from pathlib import Path
import numpy as np
import pandas as pd
import duckdb

sys.path.insert(0, str(Path(__file__).parent.parent))
from config.settings import DUCKDB_PATH

REPORT_DIR = Path(__file__).parent.parent / "output" / "reports"
warnings.filterwarnings("ignore", category=FutureWarning)

MODERN_ERA_START = "2021-01-01"


def load_all_features(con):
    """Load all features (same as v6/v7 pipeline)."""
    t0 = time.time()

    df = con.execute("""
        SELECT t.trade_id, t.symbol, t.strategy, t.direction,
            t.entry_time, t.entry_price, t.holly_pnl,
            CASE WHEN t.holly_pnl > 0 THEN 1 ELSE 0 END AS win,
            EXTRACT(HOUR FROM t.entry_time) AS hour,
            EXTRACT(DOW FROM t.entry_time) AS dow,
            EXTRACT(QUARTER FROM t.entry_time) AS quarter,
            EXTRACT(HOUR FROM t.entry_time) * 60 + EXTRACT(MINUTE FROM t.entry_time) - 570
                AS minutes_since_open,
            CAST(t.entry_time AS DATE) AS trade_date,
            r.vol_regime, r.atr_pct,
            r.rsi14, r.roc5, r.roc20, r.daily_range_pct AS regime_daily_range,
            fm.vix, fm.yield_spread_10y2y,
            fm.put_call_equity, fm.vix_5d_change,
            td.market_cap
        FROM trades t
        LEFT JOIN trade_regime r ON r.trade_id = t.trade_id
        LEFT JOIN fred_macro_daily fm ON fm.date = CAST(t.entry_time AS DATE)
        LEFT JOIN ticker_details td ON td.symbol = t.symbol
    """).fetchdf()

    # Earnings
    earn = con.execute("""
        SELECT t.trade_id,
            COALESCE(MIN(ABS(DATEDIFF('day', CAST(t.entry_time AS DATE), ec.earnings_date))), 999)
                AS days_to_earnings
        FROM trades t LEFT JOIN earnings_calendar ec ON ec.symbol = t.symbol
            AND ec.earnings_date BETWEEN CAST(t.entry_time AS DATE) - 30
                AND CAST(t.entry_time AS DATE) + 30
        GROUP BY t.trade_id
    """).fetchdf()
    df = df.merge(earn, on="trade_id", how="left")

    # Financials
    fin = con.execute("""
        WITH ranked AS (
            SELECT t.trade_id, f.eps_diluted,
                CASE WHEN f.revenues>0 THEN f.operating_income/f.revenues*100 END AS op_margin,
                CASE WHEN f.revenues>0 THEN f.net_income/f.revenues*100 END AS net_margin,
                ROW_NUMBER() OVER (PARTITION BY t.trade_id ORDER BY CAST(f.filing_date AS DATE) DESC) AS rn
            FROM trades t JOIN financials f ON f.ticker=t.symbol
                AND CAST(f.filing_date AS DATE)<CAST(t.entry_time AS DATE)
                AND f.timeframe='quarterly' AND f.revenues IS NOT NULL
        ) SELECT trade_id, eps_diluted, op_margin, net_margin FROM ranked WHERE rn=1
    """).fetchdf()
    df = df.merge(fin, on="trade_id", how="left")

    # Daily bars
    daily = con.execute("""
        WITH dw AS (
            SELECT t.trade_id, d.close, d.high, d.low, d.volume, d.open,
                ROW_NUMBER() OVER (PARTITION BY t.trade_id ORDER BY d.bar_date DESC) AS rn
            FROM trades t JOIN daily_bars d ON d.symbol=t.symbol
                AND d.bar_date<CAST(t.entry_time AS DATE)
                AND d.bar_date>=CAST(t.entry_time AS DATE)-25
        )
        SELECT trade_id,
            MAX(CASE WHEN rn=1 THEN close END) AS prior_close,
            MAX(CASE WHEN rn=1 THEN CASE WHEN close>0 THEN (high-low)/close*100 END END) AS prior_day_range_pct,
            MAX(CASE WHEN rn=1 THEN volume END)/NULLIF(AVG(CASE WHEN rn BETWEEN 2 AND 21 THEN volume END),0) AS volume_ratio,
            CASE WHEN MAX(CASE WHEN rn=2 THEN close END) > 0 THEN
                (MAX(CASE WHEN rn=1 THEN close END) - MAX(CASE WHEN rn=2 THEN close END)) /
                MAX(CASE WHEN rn=2 THEN close END) * 100
            END AS prior_day_return_pct,
            CASE WHEN MAX(CASE WHEN rn=2 THEN close END) > 0 THEN
                (MAX(CASE WHEN rn=1 THEN open END) - MAX(CASE WHEN rn=2 THEN close END)) /
                MAX(CASE WHEN rn=2 THEN close END) * 100
            END AS prior_day_gap_pct,
            MAX(CASE WHEN rn=1 THEN high-low END)/NULLIF(AVG(CASE WHEN rn BETWEEN 1 AND 20 THEN high-low END),0) AS atr_contraction,
            (MAX(CASE WHEN rn=1 THEN close END)-AVG(CASE WHEN rn BETWEEN 1 AND 20 THEN close END))/
                NULLIF(AVG(CASE WHEN rn BETWEEN 1 AND 20 THEN close END),0)*100 AS dist_from_ma20_pct,
            (MAX(CASE WHEN rn=1 THEN close END)-MIN(CASE WHEN rn BETWEEN 1 AND 20 THEN low END))/
                NULLIF(MAX(CASE WHEN rn BETWEEN 1 AND 20 THEN high END)-MIN(CASE WHEN rn BETWEEN 1 AND 20 THEN low END),0)*100 AS range_position_20d,
            CASE WHEN MAX(CASE WHEN rn=5 THEN close END) > 0 THEN
                (MAX(CASE WHEN rn=1 THEN close END) - MAX(CASE WHEN rn=5 THEN close END)) /
                MAX(CASE WHEN rn=5 THEN close END) * 100
            END AS five_day_return_pct,
            AVG(CASE WHEN rn BETWEEN 1 AND 3 THEN volume END)/
                NULLIF(AVG(CASE WHEN rn BETWEEN 4 AND 10 THEN volume END),0) AS vol_trend_3d
        FROM dw WHERE rn<=21 GROUP BY trade_id
    """).fetchdf()
    df = df.merge(daily, on="trade_id", how="left")

    # Intraday microstructure
    intra = con.execute("""
        WITH tb AS (
            SELECT t.trade_id, t.entry_price,
                b.bar_time, b.close AS bc, b.volume AS bv, b.vwap AS bvw,
                b.high AS bh, b.low AS bl,
                ROW_NUMBER() OVER (PARTITION BY t.trade_id ORDER BY b.bar_time DESC) AS rn
            FROM trades t JOIN bars b ON b.symbol = t.symbol
                AND CAST(b.bar_time AS DATE) = CAST(t.entry_time AS DATE)
                AND b.bar_time <= t.entry_time
        ),
        orng AS (
            SELECT symbol, CAST(bar_time AS DATE) AS td,
                MAX(high)-MIN(low) AS or_range, AVG((high+low)/2) AS or_mid,
                MAX(high) AS or_high, MIN(low) AS or_low
            FROM bars WHERE EXTRACT(HOUR FROM bar_time)*60+EXTRACT(MINUTE FROM bar_time) BETWEEN 570 AND 600
            GROUP BY symbol, CAST(bar_time AS DATE)
        ),
        range30 AS (
            SELECT trade_id,
                MAX(CASE WHEN rn<=30 THEN bh END) - MIN(CASE WHEN rn<=30 THEN bl END) AS range_30m,
                AVG(CASE WHEN rn<=30 THEN bh-bl END) AS avg_bar_range_30m
            FROM tb GROUP BY trade_id
        ),
        agg AS (
            SELECT trade_id,
                SUM(bv*bvw)/NULLIF(SUM(bv),0) AS cum_vwap,
                AVG(CASE WHEN rn BETWEEN 1 AND 5 THEN bv END) /
                    NULLIF(AVG(CASE WHEN rn BETWEEN 6 AND 15 THEN bv END),0) AS vol_acceleration
            FROM tb GROUP BY trade_id
        )
        SELECT t.trade_id,
            CASE WHEN a.cum_vwap IS NOT NULL THEN (t.entry_price-a.cum_vwap)/a.cum_vwap*100 END AS vwap_position_pct,
            CASE WHEN o.or_mid>0 THEN o.or_range/o.or_mid*100 END AS opening_range_pct,
            a.vol_acceleration,
            CASE WHEN o.or_mid>0 THEN r30.range_30m/o.or_mid*100 END AS range_30m_pct,
            r30.avg_bar_range_30m
        FROM trades t
        LEFT JOIN agg a ON a.trade_id = t.trade_id
        LEFT JOIN orng o ON o.symbol = t.symbol AND o.td = CAST(t.entry_time AS DATE)
        LEFT JOIN range30 r30 ON r30.trade_id = t.trade_id
    """).fetchdf()
    df = df.merge(intra, on="trade_id", how="left")

    # Relative strength vs QQQ
    qqq = con.execute("SELECT bar_date, close FROM daily_bars WHERE symbol = 'QQQ' ORDER BY bar_date").fetchdf()
    if len(qqq) > 0:
        qqq = qqq.set_index("bar_date").sort_index()
        qqq["qqq_ret_5d"] = qqq["close"].pct_change(5) * 100
        qqq = qqq.reset_index()
        daily_stock = con.execute("""
            SELECT t.trade_id,
                MAX(CASE WHEN rn=1 THEN close END) AS stock_close,
                MAX(CASE WHEN rn=5 THEN close END) AS stock_close_5d,
                MAX(CASE WHEN rn=1 THEN bar_date END) AS bar_date
            FROM (
                SELECT t.trade_id, d.close, d.bar_date,
                    ROW_NUMBER() OVER (PARTITION BY t.trade_id ORDER BY d.bar_date DESC) AS rn
                FROM trades t JOIN daily_bars d ON d.symbol=t.symbol
                    AND d.bar_date<CAST(t.entry_time AS DATE)
                    AND d.bar_date>=CAST(t.entry_time AS DATE)-15
            ) t GROUP BY t.trade_id
        """).fetchdf()
        daily_stock = daily_stock.merge(qqq[["bar_date", "qqq_ret_5d"]], on="bar_date", how="left")
        daily_stock["stock_ret_5d"] = np.where(
            daily_stock["stock_close_5d"] > 0,
            (daily_stock["stock_close"] - daily_stock["stock_close_5d"]) / daily_stock["stock_close_5d"] * 100, np.nan)
        daily_stock["rs_5d"] = daily_stock["stock_ret_5d"] - daily_stock["qqq_ret_5d"]
        daily_stock["rs_5d_abs"] = daily_stock["rs_5d"].abs()
        df = df.merge(daily_stock[["trade_id", "rs_5d", "rs_5d_abs"]], on="trade_id", how="left")
    else:
        df["rs_5d"] = np.nan
        df["rs_5d_abs"] = np.nan

    # daily_bars_flat features
    dbf = con.execute("""
        WITH base AS (
            SELECT ticker, bar_time AS bar_date, close, volume, transactions,
                LAG(close) OVER w AS prev_close,
                LAG(transactions) OVER w AS prev_transactions,
                LN(NULLIF(LAG(volume) OVER w, 0)) AS log_volume_1d
            FROM daily_bars_flat
            WINDOW w AS (PARTITION BY ticker ORDER BY bar_time)
        )
        SELECT t.trade_id,
            b.prev_transactions AS flat_transactions_1d,
            b.log_volume_1d AS flat_log_volume_1d
        FROM trades t
        LEFT JOIN base b
            ON b.ticker = t.symbol
            AND b.bar_date = (
                SELECT MAX(b2.bar_time)
                FROM daily_bars_flat b2
                WHERE b2.ticker = t.symbol AND b2.bar_time < t.entry_time
            )
    """).fetchdf()
    df = df.merge(dbf, on="trade_id", how="left")

    # === Benzinga news features (expanded set for v8) ===
    tables = [r[0] for r in con.execute("SHOW TABLES").fetchall()]
    if "benzinga_news_broad" in tables:
        print("  Loading Benzinga news features (48h window)...")
        t_bz = time.time()
        bz_features = con.execute("""
            WITH bz_tickers AS (
                SELECT
                    benzinga_id,
                    CAST(published AS TIMESTAMP) AS published_ts,
                    channels, tags,
                    TRIM(ticker) AS ticker
                FROM benzinga_news_broad,
                     UNNEST(string_split(tickers, ',')) AS t(ticker)
                WHERE tickers IS NOT NULL
                  AND TRIM(ticker) != ''
            ),
            matched AS (
                SELECT
                    t.trade_id,
                    b.channels,
                    b.tags,
                    EPOCH(t.entry_time - b.published_ts) / 3600.0 AS hours_before
                FROM trades t
                JOIN bz_tickers b ON b.ticker = t.symbol
                WHERE b.published_ts >= t.entry_time - INTERVAL '48 hours'
                  AND b.published_ts < t.entry_time
            )
            SELECT
                trade_id,
                COUNT(*) AS bz_article_count,
                MAX(CASE WHEN LOWER(channels) LIKE '%price target%' THEN 1 ELSE 0 END) AS bz_has_price_target,
                MAX(CASE WHEN LOWER(channels) LIKE '%analyst rat%' THEN 1 ELSE 0 END) AS bz_has_analyst_rating,
                MAX(CASE WHEN LOWER(channels) LIKE '%earnings%' THEN 1 ELSE 0 END) AS bz_has_earnings,
                MAX(CASE WHEN LOWER(channels) LIKE '%movers%' THEN 1 ELSE 0 END) AS bz_has_movers,
                MAX(CASE WHEN LOWER(tags) LIKE '%why it%' THEN 1 ELSE 0 END) AS bz_has_why_moving,
                MAX(CASE WHEN LOWER(tags) LIKE '%52-week%' THEN 1 ELSE 0 END) AS bz_has_52w_low,
                SUM(
                    CASE WHEN LENGTH(COALESCE(channels, '')) > 0
                    THEN LENGTH(channels) - LENGTH(REPLACE(channels, ',', '')) + 1
                    ELSE 0 END
                ) AS bz_channel_count,
                SUM(
                    CASE WHEN LENGTH(COALESCE(tags, '')) > 0
                    THEN LENGTH(tags) - LENGTH(REPLACE(tags, ',', '')) + 1
                    ELSE 0 END
                ) AS bz_tag_count,
                MIN(hours_before) AS bz_recency_hours
            FROM matched
            GROUP BY trade_id
        """).fetchdf()
        df = df.merge(bz_features, on="trade_id", how="left")
        bz_coverage = bz_features["trade_id"].nunique()
        print(f"  Benzinga features: {bz_coverage:,} trades covered ({bz_coverage/len(df)*100:.1f}%) ({time.time()-t_bz:.1f}s)")
    else:
        print("  WARNING: benzinga_news_broad table not found, skipping Benzinga features")
        for col in ["bz_article_count", "bz_has_price_target", "bz_has_analyst_rating",
                     "bz_has_earnings", "bz_has_movers", "bz_has_why_moving",
                     "bz_has_52w_low", "bz_channel_count", "bz_tag_count", "bz_recency_hours"]:
            df[col] = np.nan

    print(f"  All features loaded: {len(df):,} trades ({time.time()-t0:.1f}s)")
    return df


def compute_ticker_features(df):
    """Compute ticker history features (no look-ahead)."""
    df = df.sort_values("entry_time").reset_index(drop=True)
    n = len(df)
    ticker_prior_wr = np.full(n, np.nan)
    ticker_prior_streak = np.zeros(n, dtype=int)
    ticker_prior_avg_pnl = np.full(n, np.nan)

    ticker_history = {}
    for i in range(n):
        sym = df.iloc[i]["symbol"]
        win = df.iloc[i]["win"]
        pnl = df.iloc[i]["holly_pnl"]
        hist = ticker_history.get(sym, [])
        if len(hist) >= 3:
            ticker_prior_wr[i] = sum(h[0] for h in hist) / len(hist) * 100
            ticker_prior_avg_pnl[i] = sum(h[1] for h in hist) / len(hist)
            streak = 0
            for h in reversed(hist):
                if h[0] == 1:
                    if streak >= 0: streak += 1
                    else: break
                else:
                    if streak <= 0: streak -= 1
                    else: break
            ticker_prior_streak[i] = streak
        if sym not in ticker_history:
            ticker_history[sym] = []
        ticker_history[sym].append((win, pnl))

    df["ticker_prior_wr"] = ticker_prior_wr
    df["ticker_prior_streak"] = ticker_prior_streak
    df["ticker_prior_avg_pnl"] = ticker_prior_avg_pnl
    return df


def compute_strategy_meta_features(df):
    """Compute strategy-level meta features (no look-ahead)."""
    df = df.sort_values("entry_time").reset_index(drop=True)
    n = len(df)
    strategy_recent_wr = np.full(n, np.nan)
    strategy_recent_streak = np.zeros(n, dtype=int)
    strategy_vol_regime_wr = np.full(n, np.nan)

    strat_history = {}
    strat_vol_history = {}
    for i in range(n):
        strat = df.iloc[i]["strategy"]
        win = df.iloc[i]["win"]
        vol = df.iloc[i].get("vol_regime", None)
        hist = strat_history.get(strat, [])
        if len(hist) >= 10:
            recent = hist[-20:] if len(hist) >= 20 else hist
            strategy_recent_wr[i] = sum(recent) / len(recent) * 100
            streak = 0
            for h in reversed(hist):
                if h == 1:
                    if streak >= 0: streak += 1
                    else: break
                else:
                    if streak <= 0: streak -= 1
                    else: break
            strategy_recent_streak[i] = streak
        if vol is not None and not (isinstance(vol, float) and np.isnan(vol)):
            key = (strat, vol)
            if key in strat_vol_history and strat_vol_history[key][1] >= 10:
                strategy_vol_regime_wr[i] = strat_vol_history[key][0] / strat_vol_history[key][1] * 100
        if strat not in strat_history:
            strat_history[strat] = []
        strat_history[strat].append(win)
        if vol is not None and not (isinstance(vol, float) and np.isnan(vol)):
            key = (strat, vol)
            if key not in strat_vol_history:
                strat_vol_history[key] = [0, 0]
            strat_vol_history[key][0] += win
            strat_vol_history[key][1] += 1

    df["strategy_recent_wr"] = strategy_recent_wr
    df["strategy_recent_streak"] = strategy_recent_streak
    df["strategy_vol_regime_wr"] = strategy_vol_regime_wr
    return df


def main():
    from sklearn.ensemble import HistGradientBoostingClassifier
    from sklearn.metrics import roc_auc_score
    from sklearn.inspection import permutation_importance

    t0 = time.time()
    con = duckdb.connect(str(DUCKDB_PATH), read_only=True)
    print(f"Connected to {DUCKDB_PATH.name}")

    # Load ALL trades first (ticker/strategy features need full history)
    df_all = load_all_features(con)
    con.close()

    print("  Computing ticker history features (full history)...")
    df_all = compute_ticker_features(df_all)
    print("  Computing strategy meta-features (full history)...")
    df_all = compute_strategy_meta_features(df_all)

    # Derived features
    df_all["gap_pct"] = np.where(df_all["prior_close"].notna() & (df_all["prior_close"] > 0),
        (df_all["entry_price"] - df_all["prior_close"]) / df_all["prior_close"] * 100, np.nan)
    df_all["is_short"] = (df_all["direction"].str.lower() == "short").astype(int)
    df_all["log_market_cap"] = np.log10(df_all["market_cap"].clip(lower=1e6))

    # Strategy dummies
    top_strats = df_all["strategy"].value_counts().head(10).index.tolist()
    for s in top_strats:
        col_name = "strat_" + s.lower().replace(" ", "_")[:20]
        df_all[col_name] = (df_all["strategy"] == s).astype(int)

    # Sort chronologically
    df_all = df_all.sort_values("entry_time").reset_index(drop=True)
    y_all = df_all["win"].values
    pnl_all = df_all["holly_pnl"].values

    # === MODERN ERA FILTER ===
    modern_mask = df_all["entry_time"] >= MODERN_ERA_START
    df_modern = df_all[modern_mask].reset_index(drop=True)
    y_modern = df_modern["win"].values
    pnl_modern = df_modern["holly_pnl"].values

    print(f"\n  Full dataset: {len(df_all):,} trades")
    print(f"  Modern era (>={MODERN_ERA_START}): {len(df_modern):,} trades")
    print(f"  Modern era WR: {y_modern.mean()*100:.1f}%")

    # Modern era split
    modern_split = int(len(df_modern) * 0.6)
    y_mtr, y_mte = y_modern[:modern_split], y_modern[modern_split:]
    pnl_mte = pnl_modern[modern_split:]

    # Full dataset split (for reference)
    full_split = int(len(df_all) * 0.6)

    print(f"  Modern train: {modern_split:,} | Modern test: {len(df_modern)-modern_split:,}")
    print(f"  Modern train period: {df_modern.iloc[0]['entry_time'].strftime('%Y-%m-%d')} — "
          f"{df_modern.iloc[modern_split-1]['entry_time'].strftime('%Y-%m-%d')}")
    print(f"  Modern test period:  {df_modern.iloc[modern_split]['entry_time'].strftime('%Y-%m-%d')} — "
          f"{df_modern.iloc[-1]['entry_time'].strftime('%Y-%m-%d')}")

    # Check Benzinga coverage in modern splits
    bz_mtrain = df_modern.iloc[:modern_split]["bz_article_count"].notna().sum()
    bz_mtest = df_modern.iloc[modern_split:]["bz_article_count"].notna().sum()
    print(f"  Benzinga coverage: train={bz_mtrain:,}/{modern_split:,} ({bz_mtrain/modern_split*100:.1f}%) "
          f"test={bz_mtest:,}/{len(df_modern)-modern_split:,} ({bz_mtest/(len(df_modern)-modern_split)*100:.1f}%)")

    # Feature sets
    V6_FEATURES = [
        "is_short", "log_market_cap",
        "ticker_prior_avg_pnl", "ticker_prior_streak", "ticker_prior_wr",
        "flat_transactions_1d", "flat_log_volume_1d",
        "strategy_recent_wr", "gap_pct", "atr_pct",
        "strategy_vol_regime_wr", "prior_day_gap_pct",
        "rs_5d", "vix", "vwap_position_pct",
        "opening_range_pct", "rs_5d_abs", "prior_day_range_pct",
        "vol_trend_3d", "yield_spread_10y2y",
        "prior_day_return_pct", "net_margin", "op_margin",
    ]
    if "strat_mighty_mouse" in df_all.columns:
        V6_FEATURES.append("strat_mighty_mouse")

    BENZINGA_5 = [
        "bz_article_count", "bz_channel_count",
        "bz_has_price_target", "bz_has_analyst_rating",
        "bz_has_why_moving",
    ]

    BENZINGA_ALL = BENZINGA_5 + [
        "bz_has_earnings", "bz_has_movers", "bz_has_52w_low",
        "bz_tag_count", "bz_recency_hours",
    ]

    best_params = dict(max_iter=800, max_depth=3, learning_rate=0.02,
                       min_samples_leaf=100, l2_regularization=5.0)

    # Adjust min_samples_leaf for smaller dataset
    modern_params = dict(max_iter=800, max_depth=3, learning_rate=0.02,
                         min_samples_leaf=50, l2_regularization=5.0)

    configs = {
        # Reference: v6 on full dataset (original result)
        "v6_full_reference": {
            "features": [c for c in V6_FEATURES if c in df_all.columns],
            "params": best_params,
            "data": "full",
        },
        # v6 on modern era only (to measure signal loss from less data)
        "v6_modern_baseline": {
            "features": [c for c in V6_FEATURES if c in df_all.columns],
            "params": modern_params,
            "data": "modern",
        },
        # v8: v6 + 5 Benzinga features on modern era
        "v8_with_benzinga": {
            "features": [c for c in V6_FEATURES + BENZINGA_5 if c in df_all.columns],
            "params": modern_params,
            "data": "modern",
        },
        # v8 with deeper trees
        "v8_depth4": {
            "features": [c for c in V6_FEATURES + BENZINGA_5 if c in df_all.columns],
            "params": dict(max_iter=800, max_depth=4, learning_rate=0.02,
                          min_samples_leaf=50, l2_regularization=5.0),
            "data": "modern",
        },
        # v8 with ALL Benzinga features
        "v8_all_benzinga": {
            "features": [c for c in V6_FEATURES + BENZINGA_ALL if c in df_all.columns],
            "params": modern_params,
            "data": "modern",
        },
    }

    results = []
    best_model = None
    best_d = -999

    for name, cfg in configs.items():
        feats = cfg["features"]
        is_full = cfg["data"] == "full"

        if is_full:
            X = df_all[feats].copy()
            X_tr, X_te = X.iloc[:full_split], X.iloc[full_split:]
            y_tr_c, y_te_c = y_all[:full_split], y_all[full_split:]
            pnl_te_c = pnl_all[full_split:]
        else:
            X = df_modern[feats].copy()
            X_tr, X_te = X.iloc[:modern_split], X.iloc[modern_split:]
            y_tr_c, y_te_c = y_mtr, y_mte
            pnl_te_c = pnl_mte

        print(f"\n  Training {name} ({len(feats)} features, {'full' if is_full else 'modern'} data, "
              f"train={len(X_tr):,} test={len(X_te):,})...")
        model = HistGradientBoostingClassifier(
            **cfg["params"],
            early_stopping=True, n_iter_no_change=20,
            validation_fraction=0.15, random_state=42,
        )
        model.fit(X_tr, y_tr_c)

        tr_proba = model.predict_proba(X_tr)[:, 1]
        te_proba = model.predict_proba(X_te)[:, 1]
        tr_auc = roc_auc_score(y_tr_c, tr_proba)
        te_auc = roc_auc_score(y_te_c, te_proba)

        te_df = pd.DataFrame({"proba": te_proba, "win": y_te_c, "pnl": pnl_te_c})
        te_df["decile"] = pd.qcut(te_df["proba"].rank(pct=True).mul(100), 10,
                                   labels=[f"D{i}" for i in range(1, 11)])
        dec = te_df.groupby("decile", observed=True).agg(
            n=("win", "count"), wr=("win", "mean"), avg_pnl=("pnl", "mean"),
        ).reset_index()
        dec["wr"] *= 100

        d10 = te_df[te_df["decile"] == "D10"]["pnl"]
        d1 = te_df[te_df["decile"] == "D1"]["pnl"]
        d10_wr = te_df[te_df["decile"] == "D10"]["win"].mean() * 100
        d1_wr = te_df[te_df["decile"] == "D1"]["win"].mean() * 100
        pooled = np.sqrt((d10.std()**2 + d1.std()**2) / 2)
        cohens_d = (d10.mean() - d1.mean()) / pooled if pooled > 0 else 0

        wrs = dec["wr"].values
        monotonic = sum(1 for i in range(len(wrs)-1) if wrs[i] < wrs[i+1])

        r = {
            "name": name, "features": len(feats), "iters": model.n_iter_,
            "data": cfg["data"], "train_n": len(X_tr), "test_n": len(X_te),
            "tr_auc": tr_auc, "te_auc": te_auc, "overfit": tr_auc - te_auc,
            "d": cohens_d, "d10_wr": d10_wr, "d1_wr": d1_wr,
            "monotonic": monotonic,
            "d10_avg_pnl": d10.mean(), "d1_avg_pnl": d1.mean(),
        }
        results.append(r)
        print(f"    iters={model.n_iter_} AUC={te_auc:.4f} d={cohens_d:.3f} "
              f"D10={d10_wr:.1f}% D1={d1_wr:.1f}% overfit={tr_auc-te_auc:.4f}")

        # Track best MODERN model
        if not is_full and cohens_d > best_d:
            best_d = cohens_d
            best_model = (name, model, feats, te_proba, dec)

    # Feature importance for best modern model
    best_name, best_mdl, best_feats, best_proba, best_dec = best_model
    print(f"\n  Best modern model: {best_name} (d={best_d:.3f})")
    print("  Computing permutation importance...")
    X_te_best = df_modern[best_feats].iloc[modern_split:]
    perm = permutation_importance(best_mdl, X_te_best, y_mte, n_repeats=10, random_state=42, n_jobs=-1)
    feat_imp = pd.Series(perm.importances_mean, index=best_feats).sort_values(ascending=False)

    # Check Benzinga feature rankings
    print("\n  Benzinga feature importance:")
    for f in BENZINGA_ALL:
        if f in feat_imp.index:
            rank = (feat_imp > feat_imp[f]).sum() + 1
            print(f"    {f:28s} imp={feat_imp[f]:.4f}  rank={rank}/{len(feat_imp)}")

    # === Build report ===
    report = []
    report.append("# Composite v8 -- Modern Era (2021+) with Benzinga Features")
    report.append("")
    report.append(f"Generated: {pd.Timestamp.now().strftime('%Y-%m-%d %H:%M')}")
    report.append(f"Full dataset: {len(df_all):,} trades")
    report.append(f"Modern era (>={MODERN_ERA_START}): {len(df_modern):,} trades")
    report.append(f"Modern train: {modern_split:,} ({df_modern.iloc[0]['entry_time'].strftime('%Y-%m-%d')} — "
                  f"{df_modern.iloc[modern_split-1]['entry_time'].strftime('%Y-%m-%d')})")
    report.append(f"Modern test: {len(df_modern)-modern_split:,} ({df_modern.iloc[modern_split]['entry_time'].strftime('%Y-%m-%d')} — "
                  f"{df_modern.iloc[-1]['entry_time'].strftime('%Y-%m-%d')})")
    report.append(f"Benzinga coverage: train={bz_mtrain:,}/{modern_split:,} ({bz_mtrain/modern_split*100:.1f}%) "
                  f"test={bz_mtest:,}/{len(df_modern)-modern_split:,} ({bz_mtest/(len(df_modern)-modern_split)*100:.1f}%)")
    report.append("")

    report.append("## 1. Model Comparison")
    report.append("")
    report.append("| Config | Data | Train | Test | Feats | Iters | OOS AUC | OOS d | D10 WR | D1 WR | Overfit |")
    report.append("|--------|------|-------|------|-------|-------|---------|-------|--------|-------|---------|")
    for r in results:
        marker = " **BEST**" if r["name"] == best_name else ""
        report.append(f"| {r['name']}{marker} | {r['data']} | {r['train_n']:,} | {r['test_n']:,} | "
                      f"{r['features']} | {r['iters']} | {r['te_auc']:.4f} | {r['d']:.3f} | "
                      f"{r['d10_wr']:.1f}% | {r['d1_wr']:.1f}% | {r['overfit']:.4f} |")
    report.append("")

    report.append("## 2. Best Model Decile Breakdown")
    report.append("")
    report.append("| Decile | n | Win Rate | Avg P&L |")
    report.append("|--------|---|----------|---------|")
    for _, row in best_dec.iterrows():
        report.append(f"| {row['decile']} | {row['n']:,.0f} | {row['wr']:.1f}% | ${row['avg_pnl']:.0f} |")
    report.append("")

    report.append("## 3. Feature Importance (Best Modern Model)")
    report.append("")
    report.append("| Rank | Feature | Importance | Source |")
    report.append("|------|---------|------------|--------|")
    for rank, (feat, imp) in enumerate(feat_imp.items(), 1):
        source = "Benzinga" if feat.startswith("bz_") else "v6"
        report.append(f"| {rank} | {feat} | {imp:.4f} | {source} |")
    report.append("")

    # Benzinga impact assessment
    report.append("## 4. Benzinga Impact Assessment")
    report.append("")
    v6_modern = [r for r in results if r["name"] == "v6_modern_baseline"][0]
    v8_bz = [r for r in results if r["name"] == "v8_with_benzinga"][0]
    delta_d = v8_bz["d"] - v6_modern["d"]
    delta_auc = v8_bz["te_auc"] - v6_modern["te_auc"]
    report.append(f"Modern baseline (v6 on 2021+ only): d={v6_modern['d']:.3f}, AUC={v6_modern['te_auc']:.4f}")
    report.append(f"With Benzinga (v8): d={v8_bz['d']:.3f}, AUC={v8_bz['te_auc']:.4f}")
    report.append(f"Delta d: {delta_d:+.3f}")
    report.append(f"Delta AUC: {delta_auc:+.4f}")
    report.append("")
    if delta_d > 0.02:
        report.append(f"**VERDICT: Benzinga features ADD signal** (+{delta_d:.3f} d)")
    elif delta_d > -0.02:
        report.append(f"**VERDICT: Benzinga features neutral** ({delta_d:+.3f} d)")
    else:
        report.append(f"**VERDICT: Benzinga features hurt** ({delta_d:+.3f} d)")
    report.append("")

    # Data reduction impact
    report.append("## 5. Data Reduction Impact")
    report.append("")
    v6_full = [r for r in results if r["name"] == "v6_full_reference"][0]
    report.append(f"v6 full (28K trades): d={v6_full['d']:.3f}, AUC={v6_full['te_auc']:.4f}")
    report.append(f"v6 modern (7K trades): d={v6_modern['d']:.3f}, AUC={v6_modern['te_auc']:.4f}")
    data_loss = v6_full["d"] - v6_modern["d"]
    report.append(f"Signal loss from data reduction: {data_loss:+.3f} d")
    if delta_d > 0:
        net = delta_d - abs(data_loss) if data_loss > 0 else delta_d
        report.append(f"Net effect (Benzinga gain - data loss): {net:+.3f} d")
    report.append("")

    report.append("## 6. Model Progression")
    report.append("")
    report.append("| Model | Dataset | Features | OOS d | AUC | D10 WR | Overfit |")
    report.append("|-------|---------|----------|-------|-----|--------|---------|")
    report.append("| Linear v3 (59) | full | 14 | 0.592 | -- | -- | -- |")
    report.append("| GBT v1 (60) | full | 21 | 0.767 | 0.7202 | 81.0% | -- |")
    report.append("| Enhanced GBT (64) | full | 45 | 0.784 | 0.7234 | 80.2% | -- |")
    report.append("| Composite v4 (68) | full | 46 | 1.180 | 0.7936 | 94.4% | 0.1127 |")
    report.append("| Composite v5 (73) | full | 56 | 1.190 | 0.8029 | 94.5% | 0.1087 |")
    report.append("| Composite v6 (75) | full | 24 | 1.198 | 0.7950 | -- | 0.0722 |")
    report.append("| Composite v7 (79) | full | 29 | 1.198 | 0.7950 | -- | 0.0722 |")
    best_r = [r for r in results if r["name"] == best_name][0]
    report.append(f"| **Composite v8** (80) | modern | {best_r['features']} | **{best_r['d']:.3f}** | "
                  f"**{best_r['te_auc']:.4f}** | **{best_r['d10_wr']:.1f}%** | {best_r['overfit']:.4f} |")
    report.append("")

    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    path = REPORT_DIR / "composite-v8-modern-era.md"
    path.write_text("\n".join(report), encoding="utf-8")
    elapsed = time.time() - t0
    print(f"\nReport: {path}")
    print(f"Done in {elapsed:.1f}s")


if __name__ == "__main__":
    main()
