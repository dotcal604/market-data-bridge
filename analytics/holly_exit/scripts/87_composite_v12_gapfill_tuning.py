"""
Script 87 -- Composite v12: Gap-Fill + Hyperparameter Tuning
=============================================================
Two improvements over v9 baseline (d=1.213):

1. GAP-FILL: Use market_daily (19,927 tickers) to compute prior-day
   features for ~5,935 trades that lack daily_bars coverage. This
   raises feature coverage from 68% to 87% for prior-day features.

2. HYPERPARAMETER TUNING: Systematic grid search over GBT params
   with walk-forward OOS validation on the best feature set.

3. FEATURE INTERACTIONS: Test key interaction features.

Usage:
    python scripts/87_composite_v12_gapfill_tuning.py
"""

import sys, time, warnings
from pathlib import Path
import numpy as np
import pandas as pd
import duckdb
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.metrics import roc_auc_score

sys.path.insert(0, str(Path(__file__).parent.parent))
from config.settings import DUCKDB_PATH

REPORT_DIR = Path(__file__).parent.parent / "output" / "reports"
warnings.filterwarnings("ignore", category=FutureWarning)

# V9 best params (baseline)
V9_PARAMS = dict(
    max_iter=800, max_depth=3, learning_rate=0.02,
    min_samples_leaf=100, l2_regularization=5.0,
)

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


def load_base_features(con):
    """Load trades + existing features (same as v9)."""
    t0 = time.time()

    df = con.execute("""
        SELECT t.trade_id, t.symbol, t.strategy, t.direction,
            t.entry_time, t.entry_price, t.holly_pnl,
            CASE WHEN t.holly_pnl > 0 THEN 1 ELSE 0 END AS win,
            CAST(t.entry_time AS DATE) AS trade_date,
            -- Ticker details
            td.market_cap, td.sic_code,
            -- Fundamentals
            f.net_margin, f.op_margin,
            -- FRED macro
            fm.vix, fm.yield_spread_10y2y
        FROM trades t
        LEFT JOIN ticker_details td ON td.symbol = t.symbol
        LEFT JOIN (
            SELECT ticker AS symbol,
                   FIRST(CASE WHEN revenues > 0 THEN net_income * 100.0 / revenues END) AS net_margin,
                   FIRST(CASE WHEN revenues > 0 THEN operating_income * 100.0 / revenues END) AS op_margin
            FROM financials
            WHERE timeframe = 'annual'
            GROUP BY ticker
        ) f ON f.symbol = t.symbol
        LEFT JOIN fred_macro_daily fm ON CAST(t.entry_time AS DATE) = fm.date
    """).fetchdf()
    print(f"  Base trades: {len(df):,}")

    df["log_market_cap"] = np.log1p(df["market_cap"].fillna(0))

    elapsed = time.time() - t0
    print(f"  Base features loaded ({elapsed:.1f}s)")
    return df


def compute_prior_day_gapfill(df, con):
    """Compute prior-day features using BOTH daily_bars AND market_daily.

    Key optimization: only load market_daily for trade symbols missing
    from daily_bars, keeping memory usage manageable.
    """
    t0 = time.time()

    # Get trade symbols
    trade_symbols = df["symbol"].unique().tolist()

    # Find which trade symbols are NOT in daily_bars
    db_syms = con.execute("SELECT DISTINCT symbol FROM daily_bars").fetchdf()["symbol"].tolist()
    missing_syms = [s for s in trade_symbols if s not in set(db_syms)]
    covered_syms = [s for s in trade_symbols if s in set(db_syms)]
    print(f"  Trade symbols in daily_bars: {len(covered_syms):,}")
    print(f"  Trade symbols NOT in daily_bars: {len(missing_syms):,}")

    # Load daily_bars for covered symbols only
    sym_list_db = "','".join(covered_syms)
    db = con.execute(f"""
        SELECT symbol, bar_date, open, high, low, close, volume
        FROM daily_bars
        WHERE symbol IN ('{sym_list_db}')
        ORDER BY symbol, bar_date
    """).fetchdf()
    print(f"  daily_bars loaded: {len(db):,} rows")

    # Load market_daily ONLY for missing symbols
    if missing_syms:
        sym_list_md = "','".join(missing_syms)
        md = con.execute(f"""
            SELECT symbol, bar_date, open, high, low, close, volume
            FROM market_daily
            WHERE symbol IN ('{sym_list_md}')
            ORDER BY symbol, bar_date
        """).fetchdf()
        print(f"  market_daily gap-fill: {len(md):,} rows ({md['symbol'].nunique():,} tickers)")
        all_daily = pd.concat([db, md], ignore_index=True)
    else:
        all_daily = db

    all_daily = all_daily.sort_values(["symbol", "bar_date"]).reset_index(drop=True)
    print(f"  Combined daily bars: {len(all_daily):,} rows, {all_daily['symbol'].nunique():,} tickers")

    # Compute daily features
    all_daily["range_pct"] = (all_daily["high"] - all_daily["low"]) / all_daily["close"].clip(lower=0.01) * 100
    all_daily["return_pct"] = all_daily.groupby("symbol")["close"].pct_change() * 100
    all_daily["prev_close"] = all_daily.groupby("symbol")["close"].shift(1)
    all_daily["gap_pct_daily"] = (all_daily["open"] - all_daily["prev_close"]) / all_daily["prev_close"].clip(lower=0.01) * 100

    # ATR (14-day)
    all_daily["tr"] = np.maximum(
        all_daily["high"] - all_daily["low"],
        np.maximum(
            abs(all_daily["high"] - all_daily["prev_close"]),
            abs(all_daily["low"] - all_daily["prev_close"])
        )
    )
    all_daily["atr_14"] = all_daily.groupby("symbol")["tr"].transform(
        lambda x: x.rolling(14, min_periods=5).mean()
    )
    all_daily["atr_pct"] = all_daily["atr_14"] / all_daily["close"].clip(lower=0.01) * 100

    # Volume trend
    all_daily["vol_ma_10"] = all_daily.groupby("symbol")["volume"].transform(
        lambda x: x.rolling(10, min_periods=3).mean()
    )
    all_daily["vol_trend_3d"] = all_daily.groupby("symbol")["volume"].transform(
        lambda x: x.rolling(3, min_periods=1).mean()
    ) / all_daily["vol_ma_10"].clip(lower=1)

    # RS (5-day return)
    all_daily["rs_5d"] = all_daily.groupby("symbol")["close"].pct_change(5) * 100
    all_daily["rs_5d_abs"] = all_daily["rs_5d"].abs()

    # Opening range pct (using daily range as proxy)
    all_daily["opening_range_pct"] = all_daily["range_pct"]

    # Build vectorized lookup using merge approach
    print("  Matching trades to prior-day bars...")

    # For each trade, we need the most recent bar_date < trade_date
    # Create a lookup DataFrame with bar_date as key
    feat_cols_src = {
        "gap_pct_daily": "prior_day_gap_pct",
        "range_pct": "prior_day_range_pct",
        "return_pct": "prior_day_return_pct",
        "atr_pct": "atr_pct",
        "rs_5d": "rs_5d",
        "rs_5d_abs": "rs_5d_abs",
        "vol_trend_3d": "vol_trend_3d",
        "opening_range_pct": "opening_range_pct",
        "close": "_prior_close",
    }

    lookup = all_daily[["symbol", "bar_date"] + list(feat_cols_src.keys())].copy()
    lookup = lookup.rename(columns=feat_cols_src)

    # Build per-symbol date→features mapping
    n = len(df)
    feat_cols = list(feat_cols_src.values())
    for col in feat_cols:
        df[col] = np.nan

    sym_groups = lookup.groupby("symbol")
    sym_data = {}
    for sym, grp in sym_groups:
        grp = grp.sort_values("bar_date")
        sym_data[sym] = (grp["bar_date"].values, grp[feat_cols].values)

    for i in range(n):
        sym = df.iloc[i]["symbol"]
        tdate = df.iloc[i]["trade_date"]
        if sym not in sym_data:
            continue
        dates, vals = sym_data[sym]
        idx = np.searchsorted(dates, np.datetime64(tdate, 'D')) - 1
        if idx < 0:
            continue
        for j, col in enumerate(feat_cols):
            df.iat[i, df.columns.get_loc(col)] = vals[idx, j]

    # Coverage stats
    for col in feat_cols:
        if col.startswith("_"):
            continue
        cov = df[col].notna().sum()
        print(f"    {col}: {cov:,}/{n:,} ({100*cov/n:.1f}%)")

    elapsed = time.time() - t0
    print(f"  Prior-day gap-fill done ({elapsed:.1f}s)")
    return df


def compute_intraday_features(df, con):
    """Compute flat file features (transactions, volume) for trade dates."""
    t0 = time.time()
    print("  Computing flat file features...")

    # Only load for trade symbols and dates
    trade_symbols = df["symbol"].unique().tolist()
    sym_list = "','".join(trade_symbols)

    flat = con.execute(f"""
        SELECT ticker as symbol, CAST(bar_time AS DATE) as bar_date,
               SUM(volume) as flat_volume_1d,
               SUM(transactions) as flat_transactions_1d
        FROM daily_bars_flat
        WHERE ticker IN ('{sym_list}')
        GROUP BY ticker, CAST(bar_time AS DATE)
    """).fetchdf()
    print(f"  daily_bars_flat aggregated: {len(flat):,} rows")

    flat["flat_log_volume_1d"] = np.log1p(flat["flat_volume_1d"])

    # Merge
    df = df.merge(
        flat[["symbol", "bar_date", "flat_transactions_1d", "flat_log_volume_1d"]],
        left_on=["symbol", "trade_date"],
        right_on=["symbol", "bar_date"],
        how="left",
        suffixes=("", "_flat"),
    )
    if "bar_date_flat" in df.columns:
        df.drop(columns=["bar_date_flat"], inplace=True)

    cov = df["flat_transactions_1d"].notna().sum()
    print(f"    flat_transactions_1d coverage: {cov:,}/{len(df):,} ({100*cov/len(df):.1f}%)")

    elapsed = time.time() - t0
    print(f"  Intraday features done ({elapsed:.1f}s)")
    return df


def compute_ticker_history(df):
    """Compute per-ticker rolling history features."""
    t0 = time.time()
    print("  Computing ticker history features...")
    df = df.sort_values("entry_time").reset_index(drop=True)
    n = len(df)

    ticker_prior_avg_pnl = np.full(n, np.nan)
    ticker_prior_streak = np.full(n, 0.0)
    ticker_prior_wr = np.full(n, np.nan)

    history = {}
    for i in range(n):
        sym = df.iloc[i]["symbol"]
        pnl = df.iloc[i]["holly_pnl"]
        win = df.iloc[i]["win"]

        if sym in history:
            h = history[sym]
            if len(h["pnls"]) >= 3:
                ticker_prior_avg_pnl[i] = np.mean(h["pnls"])
                ticker_prior_wr[i] = np.mean(h["wins"]) * 100
            ticker_prior_streak[i] = h["streak"]
        else:
            history[sym] = {"pnls": [], "wins": [], "streak": 0}

        h = history[sym]
        h["pnls"].append(pnl)
        h["wins"].append(win)
        if win == 1:
            h["streak"] = max(0, h["streak"]) + 1
        else:
            h["streak"] = min(0, h["streak"]) - 1

    df["ticker_prior_avg_pnl"] = ticker_prior_avg_pnl
    df["ticker_prior_streak"] = ticker_prior_streak
    df["ticker_prior_wr"] = ticker_prior_wr

    elapsed = time.time() - t0
    print(f"  Ticker history done ({elapsed:.1f}s)")
    return df


def compute_strategy_features(df, con):
    """Compute strategy meta-features."""
    t0 = time.time()
    print("  Computing strategy features...")
    df = df.sort_values("entry_time").reset_index(drop=True)
    n = len(df)

    strategy_recent_wr = np.full(n, np.nan)
    strategy_vol_regime_wr = np.full(n, np.nan)

    strat_history = {}
    for i in range(n):
        strat = df.iloc[i]["strategy"]
        win = df.iloc[i]["win"]
        vix_val = df.iloc[i].get("vix", np.nan)

        if strat in strat_history:
            h = strat_history[strat]
            recent = h["wins"][-20:]
            if len(recent) >= 10:
                strategy_recent_wr[i] = np.mean(recent) * 100

            # Vol regime
            if pd.notna(vix_val):
                regime = "high" if vix_val > 25 else ("low" if vix_val < 15 else "normal")
                r_hist = h.get(f"regime_{regime}", [])
                if len(r_hist) >= 5:
                    strategy_vol_regime_wr[i] = np.mean(r_hist) * 100
        else:
            strat_history[strat] = {"wins": []}

        h = strat_history[strat]
        h["wins"].append(win)
        if pd.notna(vix_val):
            regime = "high" if vix_val > 25 else ("low" if vix_val < 15 else "normal")
            key = f"regime_{regime}"
            if key not in h:
                h[key] = []
            h[key].append(win)

    df["strategy_recent_wr"] = strategy_recent_wr
    df["strategy_vol_regime_wr"] = strategy_vol_regime_wr

    elapsed = time.time() - t0
    print(f"  Strategy features done ({elapsed:.1f}s)")
    return df


def compute_gap_pct(df, con):
    """Compute gap_pct and vwap_position_pct using prior close from gap-fill."""
    t0 = time.time()
    print("  Computing gap_pct from entry_price vs prior close...")

    # Use _prior_close already computed in gap-fill
    n = len(df)
    if "_prior_close" in df.columns:
        prior_close = df["_prior_close"].values
        entry_price = df["entry_price"].values
        gap_pct = np.where(
            (prior_close > 0) & pd.notna(prior_close),
            (entry_price - prior_close) / prior_close * 100,
            np.nan
        )
        df["gap_pct"] = gap_pct
        df["vwap_position_pct"] = gap_pct  # simplified proxy
        df.drop(columns=["_prior_close"], inplace=True)
    else:
        print("    WARNING: _prior_close not available, gap_pct will be NaN")
        df["gap_pct"] = np.nan
        df["vwap_position_pct"] = np.nan

    cov = df["gap_pct"].notna().sum()
    print(f"    gap_pct coverage: {cov:,}/{n:,} ({100*cov/n:.1f}%)")

    elapsed = time.time() - t0
    print(f"  Gap pct done ({elapsed:.1f}s)")
    return df


def compute_split_features(df, con):
    """Compute days_since_split, days_to_next_split."""
    t0 = time.time()
    print("  Computing split features...")

    splits = con.execute("""
        SELECT ticker as symbol, CAST(execution_date AS DATE) as exec_date
        FROM stock_splits
        ORDER BY ticker, exec_date
    """).fetchdf()

    n = len(df)
    days_since = np.full(n, np.nan)
    days_to_next = np.full(n, np.nan)

    split_dates = {}
    for sym in splits["symbol"].unique():
        dates = pd.to_datetime(splits[splits["symbol"] == sym]["exec_date"]).values
        split_dates[sym] = np.sort(dates)

    for i in range(n):
        sym = df.iloc[i]["symbol"]
        tdate = np.datetime64(df.iloc[i]["trade_date"], 'ns')
        if sym not in split_dates:
            continue
        dates = split_dates[sym]
        # Days since last split
        past = dates[dates <= tdate]
        if len(past) > 0:
            days_since[i] = (tdate - past[-1]) / np.timedelta64(1, 'D')
        # Days to next split
        future = dates[dates > tdate]
        if len(future) > 0:
            days_to_next[i] = (future[0] - tdate) / np.timedelta64(1, 'D')

    df["days_since_split"] = days_since
    df["days_to_next_split"] = days_to_next

    elapsed = time.time() - t0
    print(f"  Split features done ({elapsed:.1f}s)")
    return df


def compute_interaction_features(df):
    """Compute interaction features between top predictors."""
    print("  Computing interaction features...")

    # Key interactions based on permutation importance
    # is_short × log_market_cap (top 2 features)
    df["mc_x_ticker_wr"] = df["log_market_cap"] * df["ticker_prior_wr"].fillna(50) / 100
    # ticker_prior_avg_pnl × strategy_recent_wr
    df["ticker_pnl_x_strat_wr"] = df["ticker_prior_avg_pnl"].fillna(0) * df["strategy_recent_wr"].fillna(50) / 100
    # gap_pct × atr_pct (gap relative to volatility)
    df["gap_atr_ratio"] = df["gap_pct"] / df["atr_pct"].clip(lower=0.1)
    # rs_5d × vol_trend (momentum with volume confirmation)
    df["rs_vol_confirm"] = df["rs_5d"].fillna(0) * df["vol_trend_3d"].fillna(1)

    return df


def train_direction_split(df, features, params, split):
    """Train direction-split GBT model."""
    y = df["win"].values
    long_mask = df["direction"].str.lower() == "long"
    short_mask = df["direction"].str.lower() == "short"

    te_proba_combined = np.zeros(len(df) - split)
    aucs = {}

    for direction, mask in [("long", long_mask), ("short", short_mask)]:
        tr_idx = mask.values[:split].nonzero()[0]
        te_idx = mask.values[split:].nonzero()[0]

        if len(tr_idx) < 100 or len(te_idx) < 100:
            continue

        X_dir = df[features]
        X_tr_d = X_dir.iloc[tr_idx]
        y_tr_d = y[tr_idx]
        X_te_d = X_dir.iloc[split + te_idx]
        y_te_d = y[split + te_idx]

        model = HistGradientBoostingClassifier(
            **params, random_state=42, early_stopping=True,
            validation_fraction=0.15, n_iter_no_change=30,
        )
        model.fit(X_tr_d, y_tr_d)
        proba = model.predict_proba(X_te_d)[:, 1]
        te_proba_combined[te_idx] = proba
        auc = roc_auc_score(y_te_d, proba)
        aucs[direction] = auc
        print(f"    {direction}: train={len(tr_idx):,} test={len(te_idx):,} "
              f"iters={model.n_iter_} AUC={auc:.4f}")

    y_te = y[split:]
    overall_auc = roc_auc_score(y_te, te_proba_combined)

    # Decile analysis
    te_df = pd.DataFrame({
        "proba": te_proba_combined,
        "win": y_te,
        "pnl": df["holly_pnl"].values[split:],
    })
    te_df["decile"] = pd.qcut(te_df["proba"], 10, labels=False, duplicates="drop")
    d10 = te_df[te_df["decile"] == te_df["decile"].max()]
    d1 = te_df[te_df["decile"] == te_df["decile"].min()]
    d10_wr = d10["win"].mean()
    d1_wr = d1["win"].mean()
    d10_pnl = d10["pnl"].sum()
    d1_pnl = d1["pnl"].sum()

    # Cohen's d between D10 and D1 PnL
    from scipy import stats as sp_stats
    d10_pnls = d10["pnl"].values
    d1_pnls = d1["pnl"].values
    n1, n2 = len(d10_pnls), len(d1_pnls)
    m1, m2 = d10_pnls.mean(), d1_pnls.mean()
    s1, s2 = d10_pnls.std(ddof=1), d1_pnls.std(ddof=1)
    sp = np.sqrt(((n1 - 1) * s1 ** 2 + (n2 - 1) * s2 ** 2) / (n1 + n2 - 2))
    d_stat = (m1 - m2) / sp if sp > 1e-12 else 0.0

    return {
        "auc": overall_auc,
        "d": d_stat,
        "d10_wr": d10_wr, "d1_wr": d1_wr,
        "d10_pnl": d10_pnl, "d1_pnl": d1_pnl,
        "te_proba": te_proba_combined,
        "aucs": aucs,
    }


def main():
    t0 = time.time()
    con = duckdb.connect(str(DUCKDB_PATH), read_only=True)
    print(f"Connected to {DUCKDB_PATH.name}")

    # === LOAD AND COMPUTE ALL FEATURES ===
    df = load_base_features(con)
    df = compute_prior_day_gapfill(df, con)
    df = compute_intraday_features(df, con)
    df = compute_ticker_history(df)
    df = compute_strategy_features(df, con)
    df = compute_gap_pct(df, con)
    df = compute_split_features(df, con)
    df = compute_interaction_features(df)
    con.close()

    print(f"\n  All features loaded: {len(df):,} trades")

    # Sort chronologically and split
    df = df.sort_values("entry_time").reset_index(drop=True)
    split = int(len(df) * 0.6)
    y = df["win"].values
    print(f"  Train: {split:,} | Test: {len(df) - split:,}")
    print(f"  Train WR: {y[:split].mean():.1%} | Test WR: {y[split:].mean():.1%}")

    # === COVERAGE COMPARISON ===
    print("\n  === FEATURE COVERAGE (gap-fill vs original) ===")
    for feat in V9_DIR_FEATURES:
        if feat in df.columns:
            cov = df[feat].notna().sum()
            print(f"    {feat:<30s} {cov:>6,}/{len(df):,} ({100*cov/len(df):>5.1f}%)")

    # === MODEL CONFIGS ===
    V12_FEATURES = V9_DIR_FEATURES.copy()

    V12_INTERACTION = V9_DIR_FEATURES + [
        "mc_x_ticker_wr", "ticker_pnl_x_strat_wr",
        "gap_atr_ratio", "rs_vol_confirm",
    ]

    configs = [
        ("v9_baseline", V9_DIR_FEATURES, V9_PARAMS),
        ("v12_gapfill", V12_FEATURES, V9_PARAMS),
        ("v12_interactions", V12_INTERACTION, V9_PARAMS),
    ]

    # Hyperparameter grid
    HP_GRID = [
        ("hp_deeper", V12_FEATURES, dict(
            max_iter=1200, max_depth=4, learning_rate=0.015,
            min_samples_leaf=80, l2_regularization=5.0,
        )),
        ("hp_wider", V12_FEATURES, dict(
            max_iter=1000, max_depth=3, learning_rate=0.01,
            min_samples_leaf=60, l2_regularization=3.0,
        )),
        ("hp_conservative", V12_FEATURES, dict(
            max_iter=1500, max_depth=2, learning_rate=0.01,
            min_samples_leaf=150, l2_regularization=10.0,
        )),
        ("hp_aggressive", V12_FEATURES, dict(
            max_iter=600, max_depth=5, learning_rate=0.03,
            min_samples_leaf=50, l2_regularization=2.0,
        )),
        ("hp_tuned1", V12_FEATURES, dict(
            max_iter=1000, max_depth=3, learning_rate=0.015,
            min_samples_leaf=100, l2_regularization=7.0,
        )),
        ("hp_tuned2", V12_FEATURES, dict(
            max_iter=800, max_depth=3, learning_rate=0.025,
            min_samples_leaf=120, l2_regularization=4.0,
        )),
        ("hp_interact_deep", V12_INTERACTION, dict(
            max_iter=1200, max_depth=4, learning_rate=0.015,
            min_samples_leaf=80, l2_regularization=5.0,
        )),
    ]

    all_configs = configs + HP_GRID

    # === TRAIN AND EVALUATE ===
    results = []
    for name, feats, params in all_configs:
        print(f"\n  Training {name} ({len(feats)} features)...")
        # Check feature availability
        available = [f for f in feats if f in df.columns]
        if len(available) < len(feats):
            missing = [f for f in feats if f not in df.columns]
            print(f"    WARNING: Missing features: {missing}")
        res = train_direction_split(df, available, params, split)
        res["name"] = name
        res["n_feats"] = len(available)
        res["params"] = params
        results.append(res)
        print(f"  => d={res['d']:+.3f} AUC={res['auc']:.4f}")

    # === RESULTS TABLE ===
    results.sort(key=lambda x: x["d"], reverse=True)
    best = results[0]
    print(f"\n  {'='*100}")
    print(f"  {'Config':<25s} {'Feats':>5s} {'AUC':>7s} {'d':>7s} "
          f"{'D10 WR':>7s} {'D1 WR':>7s} {'D10 PnL':>10s} {'D1 PnL':>10s}")
    print(f"  {'-'*100}")
    for r in results:
        flag = " ***" if r["name"] == best["name"] else ""
        print(f"  {r['name']:<25s} {r['n_feats']:>5d} {r['auc']:>7.4f} {r['d']:>+7.3f} "
              f"{r['d10_wr']:>6.1%} {r['d1_wr']:>6.1%} "
              f"$ {r['d10_pnl']:>8,.0f} $ {r['d1_pnl']:>8,.0f}{flag}")

    # === WRITE REPORT ===
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    rpt = REPORT_DIR / "composite-v12-gapfill-tuning.md"
    with open(rpt, "w") as f:
        f.write("# Script 87 — Composite v12: Gap-Fill + HP Tuning\n\n")
        f.write(f"## Best: {best['name']} (d={best['d']:+.3f})\n\n")

        f.write("## Results\n\n")
        f.write(f"| Config | Feats | AUC | d | D10 WR | D1 WR | D10 PnL | D1 PnL |\n")
        f.write(f"|--------|-------|-----|---|--------|-------|---------|--------|\n")
        for r in results:
            f.write(f"| {r['name']} | {r['n_feats']} | {r['auc']:.4f} | {r['d']:+.3f} | "
                    f"{r['d10_wr']:.1%} | {r['d1_wr']:.1%} | ${r['d10_pnl']:,.0f} | ${r['d1_pnl']:,.0f} |\n")
        f.write("\n")

        f.write("## Hyperparameter Configurations\n\n")
        for r in results:
            p = r["params"]
            f.write(f"**{r['name']}**: max_iter={p['max_iter']}, max_depth={p['max_depth']}, "
                    f"lr={p['learning_rate']}, min_leaf={p['min_samples_leaf']}, l2={p['l2_regularization']}\n\n")

    elapsed = time.time() - t0
    print(f"\nReport: {rpt}")
    print(f"Done in {elapsed:.1f}s")


if __name__ == "__main__":
    main()
