"""
Script 79 -- Composite v7: v6 Pruned + Benzinga News Features
==============================================================
Adds 5 Benzinga news features (from 1.19M broad articles) to the
v6 pruned model (24 features, d=1.198, overfit=0.0722).

New features from benzinga_news_broad (48h window before entry):
  - bz_article_count (d=+0.125, p=0.0004)
  - bz_channel_count (d=+0.124, p=0.0005)
  - bz_has_price_target (d=+0.108, p=0.0025)
  - bz_has_analyst_rating (d=+0.091, p=0.0103)
  - bz_has_why_moving (d=+0.074, p=0.0367)

Coverage: 10.9% overall, 44.8% within article date range (2021+).
GBT handles NaN natively so sparse features still contribute.

Walk-forward: 60% train / 40% test (chronological).

Usage:
    python scripts/79_composite_v7_benzinga.py
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


def load_all_features(con):
    """Load all features (same as v6 + Benzinga)."""
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

    # === NEW: Benzinga news features (from broad dataset) ===
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
                    b.tags
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
                MAX(CASE WHEN LOWER(tags) LIKE '%why it%' THEN 1 ELSE 0 END) AS bz_has_why_moving,
                SUM(
                    CASE WHEN LENGTH(COALESCE(channels, '')) > 0
                    THEN LENGTH(channels) - LENGTH(REPLACE(channels, ',', '')) + 1
                    ELSE 0 END
                ) AS bz_channel_count
            FROM matched
            GROUP BY trade_id
        """).fetchdf()
        df = df.merge(bz_features, on="trade_id", how="left")
        bz_coverage = bz_features["trade_id"].nunique()
        print(f"  Benzinga features: {bz_coverage:,} trades covered ({bz_coverage/len(df)*100:.1f}%) ({time.time()-t_bz:.1f}s)")
    else:
        print("  WARNING: benzinga_news_broad table not found, skipping Benzinga features")
        for col in ["bz_article_count", "bz_has_price_target", "bz_has_analyst_rating",
                     "bz_has_why_moving", "bz_channel_count"]:
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
    df = load_all_features(con)
    con.close()

    print("  Computing ticker history features...")
    df = compute_ticker_features(df)
    print("  Computing strategy meta-features...")
    df = compute_strategy_meta_features(df)

    # Derived
    df["gap_pct"] = np.where(df["prior_close"].notna() & (df["prior_close"] > 0),
        (df["entry_price"] - df["prior_close"]) / df["prior_close"] * 100, np.nan)
    df["is_short"] = (df["direction"].str.lower() == "short").astype(int)
    df["log_market_cap"] = np.log10(df["market_cap"].clip(lower=1e6))

    # Strategy dummies
    if "strat_mighty_mouse" not in df.columns:
        top_strats = df["strategy"].value_counts().head(10).index.tolist()
        for s in top_strats:
            col_name = "strat_" + s.lower().replace(" ", "_")[:20]
            df[col_name] = (df["strategy"] == s).astype(int)

    # v6 pruned features (24 features, d=1.198)
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
    if "strat_mighty_mouse" in df.columns:
        V6_FEATURES.append("strat_mighty_mouse")

    # v7: v6 + Benzinga features
    BENZINGA_FEATURES = [
        "bz_article_count", "bz_channel_count",
        "bz_has_price_target", "bz_has_analyst_rating",
        "bz_has_why_moving",
    ]
    V7_FEATURES = V6_FEATURES + BENZINGA_FEATURES

    # Sort chronologically
    df = df.sort_values("entry_time").reset_index(drop=True)
    y = df["win"].values
    pnl = df["holly_pnl"].values
    split = int(len(df) * 0.6)
    y_tr, y_te = y[:split], y[split:]
    pnl_te = pnl[split:]

    print(f"\n  Train: {split:,} | Test: {len(df)-split:,}")
    print(f"  Train WR: {y_tr.mean()*100:.1f}% | Test WR: {y_te.mean()*100:.1f}%")

    # Check Benzinga coverage in train/test
    bz_train = df.iloc[:split]["bz_article_count"].notna().sum()
    bz_test = df.iloc[split:]["bz_article_count"].notna().sum()
    print(f"  Benzinga coverage: train={bz_train:,}/{split:,} ({bz_train/split*100:.1f}%) "
          f"test={bz_test:,}/{len(df)-split:,} ({bz_test/(len(df)-split)*100:.1f}%)")

    # Best v6 hyperparams (depth=3, d=1.198)
    best_params = dict(max_iter=800, max_depth=3, learning_rate=0.02,
                       min_samples_leaf=100, l2_regularization=5.0)

    configs = {
        "v6_baseline": {
            "features": [c for c in V6_FEATURES if c in df.columns],
            "params": best_params,
        },
        "v7_with_benzinga": {
            "features": [c for c in V7_FEATURES if c in df.columns],
            "params": best_params,
        },
        "v7_benzinga_depth4": {
            "features": [c for c in V7_FEATURES if c in df.columns],
            "params": dict(max_iter=800, max_depth=4, learning_rate=0.02,
                          min_samples_leaf=100, l2_regularization=5.0),
        },
        "v7_benzinga_more_trees": {
            "features": [c for c in V7_FEATURES if c in df.columns],
            "params": dict(max_iter=1200, max_depth=3, learning_rate=0.015,
                          min_samples_leaf=100, l2_regularization=5.0),
        },
    }

    results = []
    best_model = None
    best_d = -999

    for name, cfg in configs.items():
        feats = cfg["features"]
        X = df[feats].copy()
        X_tr, X_te = X.iloc[:split], X.iloc[split:]

        print(f"\n  Training {name} ({len(feats)} features)...")
        model = HistGradientBoostingClassifier(
            **cfg["params"],
            early_stopping=True, n_iter_no_change=20,
            validation_fraction=0.15, random_state=42,
        )
        model.fit(X_tr, y_tr)

        tr_proba = model.predict_proba(X_tr)[:, 1]
        te_proba = model.predict_proba(X_te)[:, 1]
        tr_auc = roc_auc_score(y_tr, tr_proba)
        te_auc = roc_auc_score(y_te, te_proba)

        te_df = pd.DataFrame({"proba": te_proba, "win": y_te, "pnl": pnl_te})
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
            "tr_auc": tr_auc, "te_auc": te_auc, "overfit": tr_auc - te_auc,
            "d": cohens_d, "d10_wr": d10_wr, "d1_wr": d1_wr,
            "monotonic": monotonic,
            "d10_avg_pnl": d10.mean(), "d1_avg_pnl": d1.mean(),
        }
        results.append(r)
        print(f"    iters={model.n_iter_} AUC={te_auc:.4f} d={cohens_d:.3f} "
              f"D10={d10_wr:.1f}% D1={d1_wr:.1f}% overfit={tr_auc-te_auc:.4f}")

        if cohens_d > best_d:
            best_d = cohens_d
            best_model = (name, model, feats, te_proba, dec)

    # Feature importance for best model
    best_name, best_mdl, best_feats, best_proba, best_dec = best_model
    print(f"\n  Best model: {best_name} (d={best_d:.3f})")
    print("  Computing permutation importance for best model...")
    X_te_best = df[best_feats].iloc[split:]
    perm = permutation_importance(best_mdl, X_te_best, y_te, n_repeats=10, random_state=42, n_jobs=-1)
    feat_imp = pd.Series(perm.importances_mean, index=best_feats).sort_values(ascending=False)

    # Check where Benzinga features rank
    print("\n  Benzinga feature importance:")
    for f in BENZINGA_FEATURES:
        if f in feat_imp.index:
            rank = (feat_imp > feat_imp[f]).sum() + 1
            print(f"    {f:28s} imp={feat_imp[f]:.4f}  rank={rank}/{len(feat_imp)}")

    # Build report
    report = []
    report.append("# Composite v7 -- v6 Pruned + Benzinga News Features")
    report.append("")
    report.append(f"Generated: {pd.Timestamp.now().strftime('%Y-%m-%d %H:%M')}")
    report.append(f"Total trades: {len(df):,}")
    report.append(f"Train: {split:,} | Test: {len(df)-split:,}")
    report.append(f"Benzinga coverage: train={bz_train:,}/{split:,} ({bz_train/split*100:.1f}%) "
                  f"test={bz_test:,}/{len(df)-split:,} ({bz_test/(len(df)-split)*100:.1f}%)")
    report.append("")

    report.append("## 1. Model Comparison")
    report.append("")
    report.append("| Config | Features | Iters | OOS AUC | OOS d | D10 WR | D1 WR | Overfit |")
    report.append("|--------|----------|-------|---------|-------|--------|-------|---------|")
    for r in results:
        marker = " **BEST**" if r["name"] == best_name else ""
        report.append(f"| {r['name']}{marker} | {r['features']} | {r['iters']} | "
                      f"{r['te_auc']:.4f} | {r['d']:.3f} | {r['d10_wr']:.1f}% | "
                      f"{r['d1_wr']:.1f}% | {r['overfit']:.4f} |")
    report.append("")

    report.append("## 2. Best Model Decile Breakdown")
    report.append("")
    report.append("| Decile | n | Win Rate | Avg P&L |")
    report.append("|--------|---|----------|---------|")
    for _, row in best_dec.iterrows():
        report.append(f"| {row['decile']} | {row['n']:,.0f} | {row['wr']:.1f}% | ${row['avg_pnl']:.0f} |")
    report.append("")

    report.append("## 3. Feature Importance (All)")
    report.append("")
    report.append("| Rank | Feature | Importance | Source |")
    report.append("|------|---------|------------|--------|")
    for rank, (feat, imp) in enumerate(feat_imp.items(), 1):
        source = "Benzinga" if feat.startswith("bz_") else "v6"
        report.append(f"| {rank} | {feat} | {imp:.4f} | {source} |")
    report.append("")

    report.append("## 4. Model Progression")
    report.append("")
    report.append("| Model | Features | OOS d | AUC | D10 WR | Overfit |")
    report.append("|-------|----------|-------|-----|--------|---------|")
    report.append("| Linear v3 (59) | 14 | 0.592 | -- | -- | -- |")
    report.append("| GBT v1 (60) | 21 | 0.767 | 0.7202 | 81.0% | -- |")
    report.append("| Enhanced GBT (64) | 45 | 0.784 | 0.7234 | 80.2% | -- |")
    report.append("| Composite v4 (68) | 46 | 1.180 | 0.7936 | 94.4% | 0.1127 |")
    report.append("| Composite v5 (73) | 56 | 1.190 | 0.8029 | 94.5% | 0.1087 |")
    report.append("| Composite v6 (75) | 24 | 1.198 | 0.7950 | -- | 0.0722 |")

    best_r = [r for r in results if r["name"] == best_name][0]
    report.append(f"| **Composite v7** (79) | {best_r['features']} | **{best_r['d']:.3f}** | "
                  f"**{best_r['te_auc']:.4f}** | **{best_r['d10_wr']:.1f}%** | {best_r['overfit']:.4f} |")
    report.append("")

    report.append("## 5. Benzinga Impact Assessment")
    report.append("")
    v6_r = [r for r in results if r["name"] == "v6_baseline"][0]
    v7_r = [r for r in results if r["name"] == "v7_with_benzinga"][0]
    delta_d = v7_r["d"] - v6_r["d"]
    delta_auc = v7_r["te_auc"] - v6_r["te_auc"]
    if delta_d > 0.01:
        report.append(f"Benzinga features **improved** the model: d={v7_r['d']:.3f} vs v6 d={v6_r['d']:.3f} (+{delta_d:.3f})")
    elif delta_d > -0.01:
        report.append(f"Benzinga features **comparable** to v6: d={v7_r['d']:.3f} vs v6 d={v6_r['d']:.3f} ({delta_d:+.3f})")
    else:
        report.append(f"Benzinga features **did not help**: d={v7_r['d']:.3f} vs v6 d={v6_r['d']:.3f} ({delta_d:+.3f})")
    report.append(f"- AUC change: {delta_auc:+.4f}")
    report.append(f"- Overfit change: {v7_r['overfit']-v6_r['overfit']:+.4f}")
    report.append(f"- Benzinga coverage in test set: {bz_test:,}/{len(df)-split:,} ({bz_test/(len(df)-split)*100:.1f}%)")
    report.append("")

    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    path = REPORT_DIR / "composite-v7-benzinga.md"
    path.write_text("\n".join(report), encoding="utf-8")
    elapsed = time.time() - t0
    print(f"\nReport: {path}")
    print(f"Done in {elapsed:.1f}s")


if __name__ == "__main__":
    main()
