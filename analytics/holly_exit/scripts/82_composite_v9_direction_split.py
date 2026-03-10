"""
Script 82 -- Composite v9: Direction-Conditioned Model + New Features
=====================================================================
Multiple lift analyses found features with OPPOSITE effects by direction:
  - days_since_split:     short d=-0.346, long d=+0.173 (script 81)
  - premarket_range_pct:  short d=+0.197, long d=-0.154 (script 74)
  - mkt_breadth_5d_range: short d=-0.132, long d=+0.089 (script 81)
  - am_pm_vol_ratio:      short d=+0.101, long d=-0.118 (script 74)

A single model can't learn these opposing relationships well.
Solution: Train SEPARATE long and short models.

Also adds 2 new features from script 81 (full-coverage only):
  - days_to_next_split (d=-0.110, FDR-sig, 12% coverage)
  - days_since_split (d varies by direction, 27% coverage)

Tests:
  1. v6_unified_baseline — single model (current best, d=1.198)
  2. v9_unified_new_feats — single model + new split features
  3. v9_direction_split — SEPARATE long/short models
  4. v9_direction_split_new — separate models + new features

Walk-forward: 60% train / 40% test (chronological).

Usage:
    python scripts/82_composite_v9_direction_split.py
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
    """Load all v6 features + new split/breadth features."""
    t0 = time.time()

    df = con.execute("""
        SELECT t.trade_id, t.symbol, t.strategy, t.direction,
            t.entry_time, t.entry_price, t.holly_pnl,
            CASE WHEN t.holly_pnl > 0 THEN 1 ELSE 0 END AS win,
            CAST(t.entry_time AS DATE) AS trade_date,
            r.vol_regime, r.atr_pct,
            fm.vix, fm.yield_spread_10y2y,
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
            CASE WHEN MAX(CASE WHEN rn=2 THEN close END) > 0 THEN
                (MAX(CASE WHEN rn=1 THEN close END) - MAX(CASE WHEN rn=2 THEN close END)) /
                MAX(CASE WHEN rn=2 THEN close END) * 100
            END AS prior_day_return_pct,
            CASE WHEN MAX(CASE WHEN rn=2 THEN close END) > 0 THEN
                (MAX(CASE WHEN rn=1 THEN open END) - MAX(CASE WHEN rn=2 THEN close END)) /
                MAX(CASE WHEN rn=2 THEN close END) * 100
            END AS prior_day_gap_pct,
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
                MAX(high)-MIN(low) AS or_range, AVG((high+low)/2) AS or_mid
            FROM bars WHERE EXTRACT(HOUR FROM bar_time)*60+EXTRACT(MINUTE FROM bar_time) BETWEEN 570 AND 600
            GROUP BY symbol, CAST(bar_time AS DATE)
        ),
        agg AS (
            SELECT trade_id,
                SUM(bv*bvw)/NULLIF(SUM(bv),0) AS cum_vwap
            FROM tb GROUP BY trade_id
        )
        SELECT t.trade_id,
            CASE WHEN a.cum_vwap IS NOT NULL THEN (t.entry_price-a.cum_vwap)/a.cum_vwap*100 END AS vwap_position_pct,
            CASE WHEN o.or_mid>0 THEN o.or_range/o.or_mid*100 END AS opening_range_pct
        FROM trades t
        LEFT JOIN agg a ON a.trade_id = t.trade_id
        LEFT JOIN orng o ON o.symbol = t.symbol AND o.td = CAST(t.entry_time AS DATE)
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
            SELECT ticker, bar_time AS bar_date,
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

    # === NEW: Stock split features ===
    print("  Loading stock split features...")
    splits = con.execute("""
        SELECT t.trade_id,
            DATEDIFF('day',
                (SELECT MAX(CAST(s.execution_date AS DATE))
                 FROM stock_splits s
                 WHERE s.ticker = t.symbol
                   AND CAST(s.execution_date AS DATE) <= CAST(t.entry_time AS DATE)),
                CAST(t.entry_time AS DATE)
            ) AS days_since_split,
            DATEDIFF('day',
                CAST(t.entry_time AS DATE),
                (SELECT MIN(CAST(s.execution_date AS DATE))
                 FROM stock_splits s
                 WHERE s.ticker = t.symbol
                   AND CAST(s.execution_date AS DATE) > CAST(t.entry_time AS DATE))
            ) AS days_to_next_split
        FROM trades t
    """).fetchdf()
    df = df.merge(splits, on="trade_id", how="left")
    split_cov = df["days_since_split"].notna().sum()
    print(f"    Split coverage: {split_cov:,}/{len(df):,} ({split_cov/len(df)*100:.1f}%)")

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
    df["strategy_vol_regime_wr"] = strategy_vol_regime_wr
    return df


def train_and_eval(X_tr, y_tr, X_te, y_te, pnl_te, params, name):
    """Train a model and compute metrics."""
    from sklearn.ensemble import HistGradientBoostingClassifier
    from sklearn.metrics import roc_auc_score

    model = HistGradientBoostingClassifier(
        **params,
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

    return {
        "name": name, "model": model, "iters": model.n_iter_,
        "tr_auc": tr_auc, "te_auc": te_auc, "overfit": tr_auc - te_auc,
        "d": cohens_d, "d10_wr": d10_wr, "d1_wr": d1_wr,
        "d10_avg_pnl": d10.mean(), "d1_avg_pnl": d1.mean(),
        "deciles": dec, "te_proba": te_proba,
    }


def main():
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

    # Derived features
    df["gap_pct"] = np.where(df["prior_close"].notna() & (df["prior_close"] > 0),
        (df["entry_price"] - df["prior_close"]) / df["prior_close"] * 100, np.nan)
    df["is_short"] = (df["direction"].str.lower() == "short").astype(int)
    df["log_market_cap"] = np.log10(df["market_cap"].clip(lower=1e6))

    # Strategy dummies
    top_strats = df["strategy"].value_counts().head(10).index.tolist()
    for s in top_strats:
        col_name = "strat_" + s.lower().replace(" ", "_")[:20]
        df[col_name] = (df["strategy"] == s).astype(int)

    # Sort chronologically
    df = df.sort_values("entry_time").reset_index(drop=True)
    y = df["win"].values
    pnl = df["holly_pnl"].values
    split = int(len(df) * 0.6)

    print(f"\n  Train: {split:,} | Test: {len(df)-split:,}")

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
    if "strat_mighty_mouse" in df.columns:
        V6_FEATURES.append("strat_mighty_mouse")

    NEW_FEATURES = ["days_since_split", "days_to_next_split"]

    # Direction-split features: remove is_short (redundant when models are separate)
    DIR_FEATURES = [f for f in V6_FEATURES if f != "is_short"]

    best_params = dict(max_iter=800, max_depth=3, learning_rate=0.02,
                       min_samples_leaf=100, l2_regularization=5.0)

    results = []

    # === 1. v6 unified baseline ===
    feats = [c for c in V6_FEATURES if c in df.columns]
    X = df[feats]
    r = train_and_eval(X.iloc[:split], y[:split], X.iloc[split:], y[split:],
                       pnl[split:], best_params, "v6_unified_baseline")
    r["features"] = len(feats)
    r["data"] = "unified"
    results.append(r)
    print(f"  v6_unified_baseline: d={r['d']:.3f} AUC={r['te_auc']:.4f} overfit={r['overfit']:.4f}")

    # === 2. v9 unified + new features ===
    feats9 = [c for c in V6_FEATURES + NEW_FEATURES if c in df.columns]
    X9 = df[feats9]
    r = train_and_eval(X9.iloc[:split], y[:split], X9.iloc[split:], y[split:],
                       pnl[split:], best_params, "v9_unified_new_feats")
    r["features"] = len(feats9)
    r["data"] = "unified"
    results.append(r)
    print(f"  v9_unified_new_feats: d={r['d']:.3f} AUC={r['te_auc']:.4f} overfit={r['overfit']:.4f}")

    # === 3. v9 direction-split (separate long/short models) ===
    dir_feats = [c for c in DIR_FEATURES if c in df.columns]
    print(f"\n  Training direction-split models ({len(dir_feats)} features each)...")

    # Split into long/short preserving chronological order
    long_mask = df["direction"].str.lower() == "long"
    short_mask = df["direction"].str.lower() == "short"

    # For each direction, use the global chronological split point
    # Trades before split index = train, after = test
    te_proba_combined = np.zeros(len(df) - split)
    te_win_combined = y[split:]
    te_pnl_combined = pnl[split:]

    for direction, mask in [("long", long_mask), ("short", short_mask)]:
        tr_idx = mask.values[:split].nonzero()[0]
        te_idx = mask.values[split:].nonzero()[0]

        X_dir = df[dir_feats]
        X_tr_d = X_dir.iloc[tr_idx]
        y_tr_d = y[tr_idx]
        X_te_d = X_dir.iloc[split + te_idx]
        y_te_d = y[split + te_idx]

        print(f"    {direction}: train={len(tr_idx):,} test={len(te_idx):,}")

        from sklearn.ensemble import HistGradientBoostingClassifier
        model_d = HistGradientBoostingClassifier(
            **best_params,
            early_stopping=True, n_iter_no_change=20,
            validation_fraction=0.15, random_state=42,
        )
        model_d.fit(X_tr_d, y_tr_d)
        proba_d = model_d.predict_proba(X_te_d)[:, 1]
        te_proba_combined[te_idx] = proba_d
        auc_d = roc_auc_score(y_te_d, proba_d) if len(np.unique(y_te_d)) > 1 else 0.5
        print(f"    {direction}: iters={model_d.n_iter_} AUC={auc_d:.4f}")

    # Compute combined metrics
    te_auc_combined = roc_auc_score(te_win_combined, te_proba_combined)
    te_df = pd.DataFrame({"proba": te_proba_combined, "win": te_win_combined, "pnl": te_pnl_combined})
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
    cohens_d_dir = (d10.mean() - d1.mean()) / pooled if pooled > 0 else 0

    results.append({
        "name": "v9_direction_split", "features": len(dir_feats), "data": "split",
        "iters": 0, "tr_auc": 0, "te_auc": te_auc_combined, "overfit": 0,
        "d": cohens_d_dir, "d10_wr": d10_wr, "d1_wr": d1_wr,
        "d10_avg_pnl": d10.mean(), "d1_avg_pnl": d1.mean(),
        "deciles": dec, "te_proba": te_proba_combined,
    })
    print(f"  v9_direction_split: d={cohens_d_dir:.3f} AUC={te_auc_combined:.4f} "
          f"D10={d10_wr:.1f}% D1={d1_wr:.1f}%")

    # === 4. v9 direction-split + new features ===
    dir_feats_new = [c for c in DIR_FEATURES + NEW_FEATURES if c in df.columns]
    print(f"\n  Training direction-split + new features ({len(dir_feats_new)} features each)...")

    te_proba_combined2 = np.zeros(len(df) - split)
    for direction, mask in [("long", long_mask), ("short", short_mask)]:
        tr_idx = mask.values[:split].nonzero()[0]
        te_idx = mask.values[split:].nonzero()[0]

        X_dir2 = df[dir_feats_new]
        X_tr_d = X_dir2.iloc[tr_idx]
        y_tr_d = y[tr_idx]
        X_te_d = X_dir2.iloc[split + te_idx]

        model_d2 = HistGradientBoostingClassifier(
            **best_params,
            early_stopping=True, n_iter_no_change=20,
            validation_fraction=0.15, random_state=42,
        )
        model_d2.fit(X_tr_d, y_tr_d)
        te_proba_combined2[te_idx] = model_d2.predict_proba(X_te_d)[:, 1]
        print(f"    {direction}: iters={model_d2.n_iter_}")

    te_auc_c2 = roc_auc_score(te_win_combined, te_proba_combined2)
    te_df2 = pd.DataFrame({"proba": te_proba_combined2, "win": te_win_combined, "pnl": te_pnl_combined})
    te_df2["decile"] = pd.qcut(te_df2["proba"].rank(pct=True).mul(100), 10,
                                labels=[f"D{i}" for i in range(1, 11)])
    dec2 = te_df2.groupby("decile", observed=True).agg(
        n=("win", "count"), wr=("win", "mean"), avg_pnl=("pnl", "mean"),
    ).reset_index()
    dec2["wr"] *= 100
    d10_2 = te_df2[te_df2["decile"] == "D10"]["pnl"]
    d1_2 = te_df2[te_df2["decile"] == "D1"]["pnl"]
    d10_wr2 = te_df2[te_df2["decile"] == "D10"]["win"].mean() * 100
    d1_wr2 = te_df2[te_df2["decile"] == "D1"]["win"].mean() * 100
    pooled2 = np.sqrt((d10_2.std()**2 + d1_2.std()**2) / 2)
    cohens_d_dir2 = (d10_2.mean() - d1_2.mean()) / pooled2 if pooled2 > 0 else 0

    results.append({
        "name": "v9_direction_split_new", "features": len(dir_feats_new), "data": "split",
        "iters": 0, "tr_auc": 0, "te_auc": te_auc_c2, "overfit": 0,
        "d": cohens_d_dir2, "d10_wr": d10_wr2, "d1_wr": d1_wr2,
        "d10_avg_pnl": d10_2.mean(), "d1_avg_pnl": d1_2.mean(),
        "deciles": dec2, "te_proba": te_proba_combined2,
    })
    print(f"  v9_direction_split_new: d={cohens_d_dir2:.3f} AUC={te_auc_c2:.4f} "
          f"D10={d10_wr2:.1f}% D1={d1_wr2:.1f}%")

    # === Build report ===
    report = []
    report.append("# Composite v9 -- Direction-Conditioned Model + New Features")
    report.append("")
    report.append(f"Generated: {pd.Timestamp.now().strftime('%Y-%m-%d %H:%M')}")
    report.append(f"Total trades: {len(df):,}")
    report.append(f"Train: {split:,} | Test: {len(df)-split:,}")
    report.append("")

    report.append("## 1. Model Comparison")
    report.append("")
    report.append("| Config | Type | Features | OOS AUC | OOS d | D10 WR | D1 WR | D10 Avg P&L | D1 Avg P&L |")
    report.append("|--------|------|----------|---------|-------|--------|-------|-------------|------------|")
    best_d = max(r["d"] for r in results)
    for r in results:
        marker = " **BEST**" if r["d"] == best_d else ""
        report.append(f"| {r['name']}{marker} | {r['data']} | {r['features']} | "
                      f"{r['te_auc']:.4f} | {r['d']:.3f} | {r['d10_wr']:.1f}% | {r['d1_wr']:.1f}% | "
                      f"${r['d10_avg_pnl']:.0f} | ${r['d1_avg_pnl']:.0f} |")
    report.append("")

    # Decile breakdown for best
    best_r = max(results, key=lambda x: x["d"])
    report.append(f"## 2. Best Model Decile Breakdown ({best_r['name']})")
    report.append("")
    report.append("| Decile | n | Win Rate | Avg P&L |")
    report.append("|--------|---|----------|---------|")
    for _, row in best_r["deciles"].iterrows():
        report.append(f"| {row['decile']} | {row['n']:,.0f} | {row['wr']:.1f}% | ${row['avg_pnl']:.0f} |")
    report.append("")

    report.append("## 3. Direction Split Impact")
    report.append("")
    v6_d = [r for r in results if r["name"] == "v6_unified_baseline"][0]["d"]
    dir_d = [r for r in results if r["name"] == "v9_direction_split"][0]["d"]
    dir_new_d = [r for r in results if r["name"] == "v9_direction_split_new"][0]["d"]
    report.append(f"- Unified baseline: d={v6_d:.3f}")
    report.append(f"- Direction split (no new features): d={dir_d:.3f} ({dir_d-v6_d:+.3f})")
    report.append(f"- Direction split + split features: d={dir_new_d:.3f} ({dir_new_d-v6_d:+.3f})")
    report.append("")

    report.append("## 4. Model Progression")
    report.append("")
    report.append("| Model | Features | OOS d | AUC | D10 WR |")
    report.append("|-------|----------|-------|-----|--------|")
    report.append("| Composite v4 (68) | 46 | 1.180 | 0.7936 | 94.4% |")
    report.append("| Composite v5 (73) | 56 | 1.190 | 0.8029 | 94.5% |")
    report.append("| Composite v6 (75) | 24 | 1.198 | 0.7950 | 95.4% |")
    report.append(f"| **Composite v9** (82) | {best_r['features']} | **{best_r['d']:.3f}** | "
                  f"**{best_r['te_auc']:.4f}** | **{best_r['d10_wr']:.1f}%** |")
    report.append("")

    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    path = REPORT_DIR / "composite-v9-direction-split.md"
    path.write_text("\n".join(report), encoding="utf-8")
    elapsed = time.time() - t0
    print(f"\nReport: {path}")
    print(f"Done in {elapsed:.1f}s")


if __name__ == "__main__":
    main()
