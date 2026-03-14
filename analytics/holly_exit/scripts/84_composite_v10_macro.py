"""
Script 84 -- Composite v10: Direction-Split + FRED Macro Features
=================================================================
Builds on v9's direction-conditioned architecture (d=1.213) and adds
the best FRED macro regime features from script 83:

New features:
  - vix_5d_change (FDR-sig d=-0.039)
  - fed_funds_rate (d=-0.011)
  - put_call_total (d=-0.024)
  - rate_direction_num (cutting=0, holding=1, hiking=2)
  - put_call_5d_change (d=-0.031)
  - fed_rate_20d_change (d=+0.025)
  - yield_curve_regime_num (deep_inversion +2.7% WR)

Tests:
  1. v9_baseline — current best (direction-split + split features)
  2. v10_direction_macro — direction-split + all macro features
  3. v10_direction_macro_pruned — direction-split + only FDR/near-sig macro features
  4. v10_unified_macro — unified model + macro for comparison

Walk-forward: 60% train / 40% test (chronological).

Usage:
    python scripts/84_composite_v10_macro.py
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
    """Load all v9 features + expanded FRED macro features."""
    t0 = time.time()

    df = con.execute("""
        SELECT t.trade_id, t.symbol, t.strategy, t.direction,
            t.entry_time, t.entry_price, t.holly_pnl,
            CASE WHEN t.holly_pnl > 0 THEN 1 ELSE 0 END AS win,
            CAST(t.entry_time AS DATE) AS trade_date,
            r.vol_regime, r.atr_pct,
            fm.vix, fm.yield_spread_10y2y,
            -- NEW macro features
            fm.vix_5d_change,
            fm.fed_funds_rate,
            fm.put_call_total,
            fm.put_call_5d_change,
            fm.put_call_equity,
            fm.yield_10y,
            fm.yield_2y,
            td.market_cap
        FROM trades t
        LEFT JOIN trade_regime r ON r.trade_id = t.trade_id
        LEFT JOIN fred_macro_daily fm ON fm.date = CAST(t.entry_time AS DATE)
        LEFT JOIN ticker_details td ON td.symbol = t.symbol
    """).fetchdf()

    # Rate direction + yield curve regime as numeric
    rate_dir = con.execute("""
        SELECT t.trade_id,
            fm.rate_direction,
            fm.yield_curve_regime,
            fm.fed_funds_rate - LAG(fm.fed_funds_rate, 20) OVER (ORDER BY fm.date)
                AS fed_rate_20d_change
        FROM trades t
        LEFT JOIN fred_macro_daily fm ON fm.date = CAST(t.entry_time AS DATE)
    """).fetchdf()
    df = df.merge(rate_dir, on="trade_id", how="left")

    # Encode categoricals
    df["rate_direction_num"] = df["rate_direction"].map(
        {"cutting": 0, "holding": 1, "hiking": 2})
    df["yield_curve_regime_num"] = df["yield_curve_regime"].map(
        {"deep_inversion": 0, "inverted": 1, "flat": 2, "normal": 3, "steep": 4})

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
            SELECT trade_id, SUM(bv*bvw)/NULLIF(SUM(bv),0) AS cum_vwap
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
    qqq = con.execute("SELECT bar_date, close FROM daily_bars WHERE symbol='QQQ' ORDER BY bar_date").fetchdf()
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

    # Stock split features
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


def train_direction_split(df, features, y, pnl, split, params, name):
    """Train direction-split model and return metrics."""
    from sklearn.ensemble import HistGradientBoostingClassifier
    from sklearn.metrics import roc_auc_score

    long_mask = df["direction"].str.lower() == "long"
    short_mask = df["direction"].str.lower() == "short"

    te_proba = np.zeros(len(df) - split)
    te_win = y[split:]
    te_pnl = pnl[split:]

    for direction, mask in [("long", long_mask), ("short", short_mask)]:
        tr_idx = mask.values[:split].nonzero()[0]
        te_idx = mask.values[split:].nonzero()[0]

        X_dir = df[features]
        X_tr = X_dir.iloc[tr_idx]
        y_tr = y[tr_idx]
        X_te = X_dir.iloc[split + te_idx]

        model = HistGradientBoostingClassifier(
            **params,
            early_stopping=True, n_iter_no_change=20,
            validation_fraction=0.15, random_state=42,
        )
        model.fit(X_tr, y_tr)
        te_proba[te_idx] = model.predict_proba(X_te)[:, 1]

        y_te = y[split + te_idx]
        auc = roc_auc_score(y_te, te_proba[te_idx]) if len(np.unique(y_te)) > 1 else 0.5
        print(f"    {direction}: train={len(tr_idx):,} test={len(te_idx):,} "
              f"iters={model.n_iter_} AUC={auc:.4f}")

    # Combined metrics
    te_auc = roc_auc_score(te_win, te_proba)
    te_df = pd.DataFrame({"proba": te_proba, "win": te_win, "pnl": te_pnl})
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
    d = (d10.mean() - d1.mean()) / pooled if pooled > 0 else 0

    return {
        "name": name, "features": len(features), "data": "split",
        "te_auc": te_auc, "d": d, "d10_wr": d10_wr, "d1_wr": d1_wr,
        "d10_avg_pnl": d10.mean(), "d1_avg_pnl": d1.mean(),
        "deciles": dec,
    }


def train_unified(df, features, y, pnl, split, params, name):
    """Train unified model and return metrics."""
    from sklearn.ensemble import HistGradientBoostingClassifier
    from sklearn.metrics import roc_auc_score

    feats = [c for c in features if c in df.columns]
    X = df[feats]

    model = HistGradientBoostingClassifier(
        **params,
        early_stopping=True, n_iter_no_change=20,
        validation_fraction=0.15, random_state=42,
    )
    model.fit(X.iloc[:split], y[:split])

    tr_proba = model.predict_proba(X.iloc[:split])[:, 1]
    te_proba = model.predict_proba(X.iloc[split:])[:, 1]
    tr_auc = roc_auc_score(y[:split], tr_proba)
    te_auc = roc_auc_score(y[split:], te_proba)

    te_df = pd.DataFrame({"proba": te_proba, "win": y[split:], "pnl": pnl[split:]})
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
    d = (d10.mean() - d1.mean()) / pooled if pooled > 0 else 0

    print(f"    iters={model.n_iter_} AUC={te_auc:.4f} overfit={tr_auc-te_auc:.4f}")

    return {
        "name": name, "features": len(feats), "data": "unified",
        "te_auc": te_auc, "d": d, "d10_wr": d10_wr, "d1_wr": d1_wr,
        "d10_avg_pnl": d10.mean(), "d1_avg_pnl": d1.mean(),
        "deciles": dec, "overfit": tr_auc - te_auc,
    }


def main():
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
    print(f"  Train WR: {y[:split].mean()*100:.1f}% | Test WR: {y[split:].mean()*100:.1f}%")

    # Feature sets
    V9_DIR_FEATURES = [
        "log_market_cap",
        "ticker_prior_avg_pnl", "ticker_prior_streak", "ticker_prior_wr",
        "flat_transactions_1d", "flat_log_volume_1d",
        "strategy_recent_wr", "gap_pct", "atr_pct",
        "strategy_vol_regime_wr", "prior_day_gap_pct",
        "rs_5d", "vix", "vwap_position_pct",
        "opening_range_pct", "rs_5d_abs", "prior_day_range_pct",
        "vol_trend_3d", "yield_spread_10y2y",
        "prior_day_return_pct", "net_margin", "op_margin",
        "days_since_split", "days_to_next_split",
    ]
    if "strat_mighty_mouse" in df.columns:
        V9_DIR_FEATURES.append("strat_mighty_mouse")

    # Macro features from script 83
    MACRO_FEATURES_ALL = [
        "vix_5d_change",        # FDR-sig d=-0.039
        "fed_funds_rate",       # d=-0.011
        "put_call_total",       # d=-0.024
        "put_call_5d_change",   # d=-0.031
        "rate_direction_num",   # cutting +1.6% WR
        "fed_rate_20d_change",  # d=+0.025
        "yield_curve_regime_num",  # deep_inversion +2.7% WR
        "put_call_equity",      # d=-0.004 (weak but different from total)
        "yield_10y",            # d=-0.019
    ]

    # Pruned: only near-significant features
    MACRO_FEATURES_PRUNED = [
        "vix_5d_change",        # FDR-sig
        "put_call_5d_change",   # near-sig
        "fed_rate_20d_change",  # near-sig
        "rate_direction_num",   # regime effect
        "yield_curve_regime_num",  # regime effect
    ]

    best_params = dict(max_iter=800, max_depth=3, learning_rate=0.02,
                       min_samples_leaf=100, l2_regularization=5.0)

    results = []

    # Filter features to those that exist in df
    v9_feats = [f for f in V9_DIR_FEATURES if f in df.columns]
    macro_all = [f for f in MACRO_FEATURES_ALL if f in df.columns]
    macro_pruned = [f for f in MACRO_FEATURES_PRUNED if f in df.columns]

    # === 1. v9 direction-split baseline ===
    print(f"\n  Training v9_baseline ({len(v9_feats)} features)...")
    r = train_direction_split(df, v9_feats, y, pnl, split, best_params, "v9_baseline")
    results.append(r)
    print(f"  v9_baseline: d={r['d']:.3f} AUC={r['te_auc']:.4f}")

    # === 2. v10 direction-split + all macro features ===
    v10_all_feats = v9_feats + [f for f in macro_all if f not in v9_feats]
    print(f"\n  Training v10_macro_all ({len(v10_all_feats)} features)...")
    r = train_direction_split(df, v10_all_feats, y, pnl, split, best_params, "v10_macro_all")
    results.append(r)
    print(f"  v10_macro_all: d={r['d']:.3f} AUC={r['te_auc']:.4f}")

    # === 3. v10 direction-split + pruned macro features ===
    v10_pruned_feats = v9_feats + [f for f in macro_pruned if f not in v9_feats]
    print(f"\n  Training v10_macro_pruned ({len(v10_pruned_feats)} features)...")
    r = train_direction_split(df, v10_pruned_feats, y, pnl, split, best_params, "v10_macro_pruned")
    results.append(r)
    print(f"  v10_macro_pruned: d={r['d']:.3f} AUC={r['te_auc']:.4f}")

    # === 4. v10 unified + macro for comparison ===
    v10_unified_feats = ["is_short"] + v9_feats + [f for f in macro_pruned if f not in v9_feats]
    v10_unified_feats = list(dict.fromkeys(v10_unified_feats))  # dedup
    print(f"\n  Training v10_unified_macro ({len(v10_unified_feats)} features)...")
    r = train_unified(df, v10_unified_feats, y, pnl, split, best_params, "v10_unified_macro")
    results.append(r)
    print(f"  v10_unified_macro: d={r['d']:.3f} AUC={r['te_auc']:.4f}")

    # === 5. v10 direction-split + stronger regularization ===
    strong_params = dict(max_iter=800, max_depth=3, learning_rate=0.02,
                         min_samples_leaf=120, l2_regularization=8.0)
    print(f"\n  Training v10_macro_strong_reg ({len(v10_all_feats)} features)...")
    r = train_direction_split(df, v10_all_feats, y, pnl, split, strong_params, "v10_macro_strong_reg")
    results.append(r)
    print(f"  v10_macro_strong_reg: d={r['d']:.3f} AUC={r['te_auc']:.4f}")

    # === Summary ===
    print("\n  " + "=" * 90)
    print(f"  {'Config':<28s} {'Type':>8s} {'Feats':>5s} {'AUC':>7s} {'d':>7s} {'D10 WR':>7s} {'D1 WR':>6s}")
    print("  " + "-" * 90)
    best_d = max(r["d"] for r in results)
    for r in results:
        marker = " ***" if r["d"] == best_d else ""
        print(f"  {r['name']:<28s} {r['data']:>8s} {r['features']:>5d} {r['te_auc']:>7.4f} "
              f"{r['d']:>+7.3f} {r['d10_wr']:>6.1f}% {r['d1_wr']:>5.1f}%{marker}")

    # === Report ===
    report = []
    report.append("# Composite v10 — Direction-Split + FRED Macro Features")
    report.append("")
    report.append(f"Generated: {pd.Timestamp.now().strftime('%Y-%m-%d %H:%M')}")
    report.append(f"Total trades: {len(df):,}")
    report.append(f"Train: {split:,} | Test: {len(df)-split:,}")
    report.append("")

    report.append("## Model Comparison")
    report.append("")
    report.append("| Config | Type | Features | OOS AUC | OOS d | D10 WR | D1 WR | D10 Avg P&L | D1 Avg P&L |")
    report.append("|--------|------|----------|---------|-------|--------|-------|-------------|------------|")
    for r in results:
        marker = " **BEST**" if r["d"] == best_d else ""
        report.append(f"| {r['name']}{marker} | {r['data']} | {r['features']} | "
                      f"{r['te_auc']:.4f} | {r['d']:.3f} | {r['d10_wr']:.1f}% | {r['d1_wr']:.1f}% | "
                      f"${r['d10_avg_pnl']:.0f} | ${r['d1_avg_pnl']:.0f} |")
    report.append("")

    # Best model deciles
    best_r = max(results, key=lambda x: x["d"])
    report.append(f"## Best Model Decile Breakdown ({best_r['name']})")
    report.append("")
    report.append("| Decile | n | Win Rate | Avg P&L |")
    report.append("|--------|---|----------|---------|")
    for _, row in best_r["deciles"].iterrows():
        report.append(f"| {row['decile']} | {row['n']:,.0f} | {row['wr']:.1f}% | ${row['avg_pnl']:.0f} |")
    report.append("")

    report.append("## New Macro Features Added")
    report.append("")
    report.append("| Feature | Source | Script 83 d | Notes |")
    report.append("|---------|--------|-------------|-------|")
    report.append("| vix_5d_change | fred_macro_daily | -0.039 | FDR-significant |")
    report.append("| put_call_5d_change | fred_macro_daily | -0.031 | Near-significant |")
    report.append("| fed_rate_20d_change | fred_macro_daily | +0.025 | Near-significant |")
    report.append("| rate_direction_num | fred_macro_daily | N/A | Regime: cutting +1.6% WR |")
    report.append("| yield_curve_regime_num | fred_macro_daily | N/A | Deep inversion +2.7% WR |")
    report.append("| fed_funds_rate | fred_macro_daily | -0.011 | Absolute level |")
    report.append("| put_call_total | fred_macro_daily | -0.024 | Total P/C ratio |")
    report.append("| put_call_equity | fred_macro_daily | -0.004 | Equity P/C ratio |")
    report.append("| yield_10y | fred_macro_daily | -0.019 | 10Y yield level |")
    report.append("")

    report.append("## Model Progression")
    report.append("")
    report.append("| Model | Script | Features | OOS d | AUC | D10 WR |")
    report.append("|-------|--------|----------|-------|-----|--------|")
    report.append("| Composite v4 | 68 | 46 | 1.180 | 0.7936 | 94.4% |")
    report.append("| Composite v5 | 73 | 56 | 1.190 | 0.8029 | 94.5% |")
    report.append("| Composite v6 | 75 | 24 | 1.198 | 0.7950 | 95.4% |")
    report.append("| Composite v9 | 82 | 25 | 1.213 | 0.8137 | 95.8% |")
    report.append(f"| **Composite v10** | 84 | {best_r['features']} | **{best_r['d']:.3f}** | "
                  f"**{best_r['te_auc']:.4f}** | **{best_r['d10_wr']:.1f}%** |")
    report.append("")

    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    path = REPORT_DIR / "composite-v10-macro.md"
    path.write_text("\n".join(report), encoding="utf-8")
    elapsed = time.time() - t0
    print(f"\nReport: {path}")
    print(f"Done in {elapsed:.1f}s")


if __name__ == "__main__":
    main()
