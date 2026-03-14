"""
Script 86 -- Composite v11: Direction-Split + Sector Features
==============================================================
Integrates the breakthrough sector features from script 85 into
the v9 direction-split architecture (d=1.213).

New features (from script 85):
  - sector_prior_wr (d=+0.257, FDR-sig) — sector historical win rate
  - sic2_prior_wr (d=+0.184, FDR-sig) — SIC 2-digit group win rate
  - strat_sector_prior_wr (d=+0.566, FDR-sig) — strategy × sector WR
  - sic_2digit (d=-0.033) — raw SIC 2-digit code

These features are no-look-ahead: computed from trades BEFORE
the current trade's entry time.

Direction effects (script 85):
  Long:  sector_prior_wr d=+0.665, sic2_prior_wr d=+0.496
  Short: sector_prior_wr d=-0.546, sic2_prior_wr d=-0.498

Tests:
  1. v9_baseline — current best (d=1.213)
  2. v11_sector_unified — unified model + sector features
  3. v11_sector_direction — direction-split + sector features
  4. v11_sector_direction_all — direction-split + all sector features
  5. v11_sector_direction_pruned — direction-split + pruned sector only

Walk-forward: 60% train / 40% test (chronological).

Usage:
    python scripts/86_composite_v11_sector.py
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
    """Load all v9 features + sector features."""
    t0 = time.time()

    df = con.execute("""
        SELECT t.trade_id, t.symbol, t.strategy, t.direction,
            t.entry_time, t.entry_price, t.holly_pnl,
            CASE WHEN t.holly_pnl > 0 THEN 1 ELSE 0 END AS win,
            CAST(t.entry_time AS DATE) AS trade_date,
            r.vol_regime, r.atr_pct,
            fm.vix, fm.yield_spread_10y2y,
            td.market_cap,
            td.sic_code,
            td.sic_description
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

    # Intraday
    intra = con.execute("""
        WITH tb AS (
            SELECT t.trade_id, t.entry_price,
                b.close AS bc, b.volume AS bv, b.vwap AS bvw,
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

    # daily_bars_flat
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

    # Stock splits
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


def compute_sector_features(df):
    """Compute sector-level no-look-ahead features."""
    print("  Computing sector features...")
    df = df.sort_values("entry_time").reset_index(drop=True)
    n = len(df)

    # SIC 2-digit group
    df["sic_2digit"] = df["sic_code"].apply(
        lambda x: int(str(x)[:2]) if pd.notna(x) and str(x).isdigit() and len(str(x)) >= 2 else np.nan
    )

    sector_prior_wr = np.full(n, np.nan)
    sic2_prior_wr = np.full(n, np.nan)
    strat_sector_prior_wr = np.full(n, np.nan)

    sector_history = {}
    sic2_history = {}
    ss_history = {}

    for i in range(n):
        sector = df.iloc[i]["sic_description"]
        sic2 = df.iloc[i]["sic_2digit"]
        strat = df.iloc[i]["strategy"]
        win = df.iloc[i]["win"]

        # Full sector description WR
        if pd.notna(sector) and sector != "":
            hist = sector_history.get(sector, [])
            if len(hist) >= 10:
                sector_prior_wr[i] = sum(hist) / len(hist) * 100
            if sector not in sector_history:
                sector_history[sector] = []
            sector_history[sector].append(win)

        # SIC 2-digit group WR
        if pd.notna(sic2):
            hist2 = sic2_history.get(sic2, [])
            if len(hist2) >= 10:
                sic2_prior_wr[i] = sum(hist2) / len(hist2) * 100
            if sic2 not in sic2_history:
                sic2_history[sic2] = []
            sic2_history[sic2].append(win)

        # Strategy × sector interaction WR
        if pd.notna(sic2):
            key = (strat, sic2)
            hist3 = ss_history.get(key, [])
            if len(hist3) >= 5:
                strat_sector_prior_wr[i] = sum(hist3) / len(hist3) * 100
            if key not in ss_history:
                ss_history[key] = []
            ss_history[key].append(win)

    df["sector_prior_wr"] = sector_prior_wr
    df["sic2_prior_wr"] = sic2_prior_wr
    df["strat_sector_prior_wr"] = strat_sector_prior_wr

    cov = df["sector_prior_wr"].notna().sum()
    cov2 = df["sic2_prior_wr"].notna().sum()
    cov3 = df["strat_sector_prior_wr"].notna().sum()
    print(f"    sector_prior_wr coverage: {cov:,}/{n:,} ({100*cov/n:.1f}%)")
    print(f"    sic2_prior_wr coverage: {cov2:,}/{n:,} ({100*cov2/n:.1f}%)")
    print(f"    strat_sector_prior_wr coverage: {cov3:,}/{n:,} ({100*cov3/n:.1f}%)")

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


def main():
    from sklearn.inspection import permutation_importance
    from sklearn.ensemble import HistGradientBoostingClassifier
    from sklearn.metrics import roc_auc_score

    t0 = time.time()
    con = duckdb.connect(str(DUCKDB_PATH), read_only=True)
    print(f"Connected to {DUCKDB_PATH.name}")
    df = load_all_features(con)
    con.close()

    print("  Computing ticker history features...")
    df = compute_ticker_features(df)
    print("  Computing strategy meta-features...")
    df = compute_strategy_meta_features(df)
    df = compute_sector_features(df)

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

    SECTOR_FEATURES = [
        "sector_prior_wr",          # d=+0.257
        "sic2_prior_wr",            # d=+0.184
        "strat_sector_prior_wr",    # d=+0.566
        "sic_2digit",               # d=-0.033
    ]

    best_params = dict(max_iter=800, max_depth=3, learning_rate=0.02,
                       min_samples_leaf=100, l2_regularization=5.0)

    v9_feats = [f for f in V9_DIR_FEATURES if f in df.columns]
    sector_feats = [f for f in SECTOR_FEATURES if f in df.columns]

    results = []

    # === 1. v9 baseline ===
    print(f"\n  Training v9_baseline ({len(v9_feats)} features)...")
    r = train_direction_split(df, v9_feats, y, pnl, split, best_params, "v9_baseline")
    results.append(r)
    print(f"  => d={r['d']:.3f} AUC={r['te_auc']:.4f}")

    # === 2. v11 direction-split + all sector features ===
    v11_feats = v9_feats + [f for f in sector_feats if f not in v9_feats]
    print(f"\n  Training v11_sector_all ({len(v11_feats)} features)...")
    r = train_direction_split(df, v11_feats, y, pnl, split, best_params, "v11_sector_all")
    results.append(r)
    print(f"  => d={r['d']:.3f} AUC={r['te_auc']:.4f}")

    # === 3. v11 direction-split + top 2 sector features only ===
    v11_top2 = v9_feats + ["strat_sector_prior_wr", "sector_prior_wr"]
    v11_top2 = [f for f in v11_top2 if f in df.columns]
    print(f"\n  Training v11_sector_top2 ({len(v11_top2)} features)...")
    r = train_direction_split(df, v11_top2, y, pnl, split, best_params, "v11_sector_top2")
    results.append(r)
    print(f"  => d={r['d']:.3f} AUC={r['te_auc']:.4f}")

    # === 4. v11 direction-split + strat_sector_prior_wr only ===
    v11_ss = v9_feats + ["strat_sector_prior_wr"]
    v11_ss = [f for f in v11_ss if f in df.columns]
    print(f"\n  Training v11_sector_strat_only ({len(v11_ss)} features)...")
    r = train_direction_split(df, v11_ss, y, pnl, split, best_params, "v11_sector_strat_only")
    results.append(r)
    print(f"  => d={r['d']:.3f} AUC={r['te_auc']:.4f}")

    # === 5. v11 with stronger regularization ===
    strong_params = dict(max_iter=1000, max_depth=3, learning_rate=0.015,
                         min_samples_leaf=120, l2_regularization=8.0)
    print(f"\n  Training v11_sector_strong_reg ({len(v11_feats)} features)...")
    r = train_direction_split(df, v11_feats, y, pnl, split, strong_params, "v11_sector_strong_reg")
    results.append(r)
    print(f"  => d={r['d']:.3f} AUC={r['te_auc']:.4f}")

    # === Summary ===
    print("\n  " + "=" * 90)
    print(f"  {'Config':<28s} {'Feats':>5s} {'AUC':>7s} {'d':>7s} {'D10 WR':>7s} {'D1 WR':>6s} {'D10 PnL':>9s} {'D1 PnL':>9s}")
    print("  " + "-" * 90)
    best_d = max(r["d"] for r in results)
    for r in results:
        marker = " ***" if r["d"] == best_d else ""
        print(f"  {r['name']:<28s} {r['features']:>5d} {r['te_auc']:>7.4f} "
              f"{r['d']:>+7.3f} {r['d10_wr']:>6.1f}% {r['d1_wr']:>5.1f}% "
              f"${r['d10_avg_pnl']:>8,.0f} ${r['d1_avg_pnl']:>8,.0f}{marker}")

    # === Permutation importance for best model ===
    best_r = max(results, key=lambda x: x["d"])
    best_name = best_r["name"]
    print(f"\n  Computing permutation importance for {best_name}...")

    # Retrain best config to get the models
    if "sector_all" in best_name:
        best_feats = v11_feats
    elif "top2" in best_name:
        best_feats = v11_top2
    elif "strat_only" in best_name:
        best_feats = v11_ss
    elif "strong_reg" in best_name:
        best_feats = v11_feats
    else:
        best_feats = v9_feats

    # Just do unified for importance (quicker)
    X_all = df[best_feats]
    model_imp = HistGradientBoostingClassifier(
        **best_params,
        early_stopping=True, n_iter_no_change=20,
        validation_fraction=0.15, random_state=42,
    )
    X_all_with_short = X_all.copy()
    X_all_with_short["is_short"] = df["is_short"]
    model_imp.fit(X_all_with_short.iloc[:split], y[:split])

    imp = permutation_importance(model_imp, X_all_with_short.iloc[split:], y[split:],
                                  n_repeats=10, random_state=42, scoring="roc_auc")
    imp_df = pd.DataFrame({
        "feature": list(X_all_with_short.columns),
        "importance": imp.importances_mean,
        "std": imp.importances_std,
    }).sort_values("importance", ascending=False)

    print(f"\n  {'Feature':<30s} {'Importance':>10s}")
    print("  " + "-" * 42)
    for _, row in imp_df.head(15).iterrows():
        print(f"  {row['feature']:<30s} {row['importance']:>+10.4f}")

    # === Report ===
    report = []
    report.append("# Composite v11 — Direction-Split + Sector Features")
    report.append("")
    report.append(f"Generated: {pd.Timestamp.now().strftime('%Y-%m-%d %H:%M')}")
    report.append(f"Total trades: {len(df):,}")
    report.append(f"Train: {split:,} | Test: {len(df)-split:,}")
    report.append("")

    report.append("## Model Comparison")
    report.append("")
    report.append("| Config | Features | OOS AUC | OOS d | D10 WR | D1 WR | D10 Avg P&L | D1 Avg P&L |")
    report.append("|--------|----------|---------|-------|--------|-------|-------------|------------|")
    for r in results:
        marker = " **BEST**" if r["d"] == best_d else ""
        report.append(f"| {r['name']}{marker} | {r['features']} | "
                      f"{r['te_auc']:.4f} | {r['d']:.3f} | {r['d10_wr']:.1f}% | {r['d1_wr']:.1f}% | "
                      f"${r['d10_avg_pnl']:.0f} | ${r['d1_avg_pnl']:.0f} |")
    report.append("")

    # Best deciles
    report.append(f"## Best Model Decile Breakdown ({best_name})")
    report.append("")
    report.append("| Decile | n | Win Rate | Avg P&L |")
    report.append("|--------|---|----------|---------|")
    for _, row in best_r["deciles"].iterrows():
        report.append(f"| {row['decile']} | {row['n']:,.0f} | {row['wr']:.1f}% | ${row['avg_pnl']:.0f} |")
    report.append("")

    # Feature importance
    report.append("## Permutation Feature Importance (Top 15)")
    report.append("")
    report.append("| Feature | Importance |")
    report.append("|---------|------------|")
    for _, row in imp_df.head(15).iterrows():
        report.append(f"| {row['feature']} | {row['importance']:+.4f} |")
    report.append("")

    report.append("## Model Progression")
    report.append("")
    report.append("| Model | Script | Features | OOS d | AUC | D10 WR |")
    report.append("|-------|--------|----------|-------|-----|--------|")
    report.append("| Composite v4 | 68 | 46 | 1.180 | 0.7936 | 94.4% |")
    report.append("| Composite v5 | 73 | 56 | 1.190 | 0.8029 | 94.5% |")
    report.append("| Composite v6 | 75 | 24 | 1.198 | 0.7950 | 95.4% |")
    report.append("| Composite v9 | 82 | 25 | 1.213 | 0.8137 | 95.8% |")
    report.append(f"| **Composite v11** | 86 | {best_r['features']} | **{best_r['d']:.3f}** | "
                  f"**{best_r['te_auc']:.4f}** | **{best_r['d10_wr']:.1f}%** |")
    report.append("")

    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    path = REPORT_DIR / "composite-v11-sector.md"
    path.write_text("\n".join(report), encoding="utf-8")
    elapsed = time.time() - t0
    print(f"\nReport: {path}")
    print(f"Done in {elapsed:.1f}s")


if __name__ == "__main__":
    main()
