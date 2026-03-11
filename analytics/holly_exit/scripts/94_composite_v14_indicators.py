"""
Script 94 -- Composite v14: V9 Baseline + Technical Indicators
================================================================
Integrates prior-day technical indicator features (RSI, MACD, EMA, SMA)
into the V9 direction-split GBT pipeline (script 82).

New features added on top of V9:
  - rsi_14:        RSI(14) on day before entry
  - macd_hist:     MACD histogram (momentum signal)
  - price_vs_ema9: (close - EMA9) / EMA9
  - price_vs_sma50:(close - SMA50) / SMA50
  - ema_spread:    (EMA9 - EMA21) / EMA21
  - above_ema21:   binary: price above EMA21
  - above_sma50:   binary: price above SMA50

Also includes best features from script 91:
  - short_interest_pct (from trade_short_features)
  - hy_spread (from fred_macro_extended)

Compares V9 baseline vs V14 in direction-split mode.

Usage:
    python scripts/94_composite_v14_indicators.py
"""

import sys
import time
import warnings
from pathlib import Path

import duckdb
import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.metrics import roc_auc_score

sys.path.insert(0, str(Path(__file__).parent.parent))
from config.settings import DUCKDB_PATH

warnings.filterwarnings("ignore")


def load_all_features(con):
    """Load all V9 features + new indicator/macro/short features."""
    t0 = time.time()

    # Base trade + regime + macro
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
            COALESCE(MIN(ABS(DATEDIFF('day',
                CAST(t.entry_time AS DATE), ec.earnings_date))), 999)
                AS days_to_earnings
        FROM trades t LEFT JOIN earnings_calendar ec
            ON ec.symbol = t.symbol
            AND ec.earnings_date BETWEEN CAST(t.entry_time AS DATE) - 30
                AND CAST(t.entry_time AS DATE) + 30
        GROUP BY t.trade_id
    """).fetchdf()
    df = df.merge(earn, on="trade_id", how="left")

    # Financials
    fin = con.execute("""
        WITH ranked AS (
            SELECT t.trade_id, f.eps_diluted,
                CASE WHEN f.revenues>0
                    THEN f.operating_income/f.revenues*100 END AS op_margin,
                CASE WHEN f.revenues>0
                    THEN f.net_income/f.revenues*100 END AS net_margin,
                ROW_NUMBER() OVER (
                    PARTITION BY t.trade_id
                    ORDER BY CAST(f.filing_date AS DATE) DESC
                ) AS rn
            FROM trades t JOIN financials f ON f.ticker=t.symbol
                AND CAST(f.filing_date AS DATE)<CAST(t.entry_time AS DATE)
                AND f.timeframe='quarterly' AND f.revenues IS NOT NULL
        ) SELECT trade_id, eps_diluted, op_margin, net_margin
        FROM ranked WHERE rn=1
    """).fetchdf()
    df = df.merge(fin, on="trade_id", how="left")

    # Daily bars
    daily = con.execute("""
        WITH dw AS (
            SELECT t.trade_id, d.close, d.high, d.low, d.volume, d.open,
                ROW_NUMBER() OVER (
                    PARTITION BY t.trade_id ORDER BY d.bar_date DESC
                ) AS rn
            FROM trades t JOIN daily_bars d ON d.symbol=t.symbol
                AND d.bar_date<CAST(t.entry_time AS DATE)
                AND d.bar_date>=CAST(t.entry_time AS DATE)-25
        )
        SELECT trade_id,
            MAX(CASE WHEN rn=1 THEN close END) AS prior_close,
            MAX(CASE WHEN rn=1 THEN
                CASE WHEN close>0 THEN (high-low)/close*100 END
            END) AS prior_day_range_pct,
            CASE WHEN MAX(CASE WHEN rn=2 THEN close END) > 0 THEN
                (MAX(CASE WHEN rn=1 THEN close END)
                 - MAX(CASE WHEN rn=2 THEN close END))
                / MAX(CASE WHEN rn=2 THEN close END) * 100
            END AS prior_day_return_pct,
            CASE WHEN MAX(CASE WHEN rn=2 THEN close END) > 0 THEN
                (MAX(CASE WHEN rn=1 THEN open END)
                 - MAX(CASE WHEN rn=2 THEN close END))
                / MAX(CASE WHEN rn=2 THEN close END) * 100
            END AS prior_day_gap_pct,
            AVG(CASE WHEN rn BETWEEN 1 AND 3 THEN volume END)
                / NULLIF(AVG(CASE WHEN rn BETWEEN 4 AND 10
                    THEN volume END), 0) AS vol_trend_3d
        FROM dw WHERE rn<=21 GROUP BY trade_id
    """).fetchdf()
    df = df.merge(daily, on="trade_id", how="left")

    # Intraday microstructure
    intra = con.execute("""
        WITH tb AS (
            SELECT t.trade_id, t.entry_price,
                b.bar_time, b.close AS bc, b.volume AS bv, b.vwap AS bvw,
                b.high AS bh, b.low AS bl,
                ROW_NUMBER() OVER (
                    PARTITION BY t.trade_id ORDER BY b.bar_time DESC
                ) AS rn
            FROM trades t JOIN bars b ON b.symbol = t.symbol
                AND CAST(b.bar_time AS DATE) = CAST(t.entry_time AS DATE)
                AND b.bar_time <= t.entry_time
        ),
        orng AS (
            SELECT symbol, CAST(bar_time AS DATE) AS td,
                MAX(high)-MIN(low) AS or_range,
                AVG((high+low)/2) AS or_mid
            FROM bars
            WHERE EXTRACT(HOUR FROM bar_time)*60
                + EXTRACT(MINUTE FROM bar_time) BETWEEN 570 AND 600
            GROUP BY symbol, CAST(bar_time AS DATE)
        ),
        agg AS (
            SELECT trade_id, SUM(bv*bvw)/NULLIF(SUM(bv),0) AS cum_vwap
            FROM tb GROUP BY trade_id
        )
        SELECT t.trade_id,
            CASE WHEN a.cum_vwap IS NOT NULL THEN
                (t.entry_price-a.cum_vwap)/a.cum_vwap*100
            END AS vwap_position_pct,
            CASE WHEN o.or_mid>0 THEN o.or_range/o.or_mid*100
            END AS opening_range_pct
        FROM trades t
        LEFT JOIN agg a ON a.trade_id = t.trade_id
        LEFT JOIN orng o ON o.symbol = t.symbol
            AND o.td = CAST(t.entry_time AS DATE)
    """).fetchdf()
    df = df.merge(intra, on="trade_id", how="left")

    # Relative strength vs QQQ
    qqq = con.execute(
        "SELECT bar_date, close FROM daily_bars "
        "WHERE symbol = 'QQQ' ORDER BY bar_date"
    ).fetchdf()
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
                    ROW_NUMBER() OVER (
                        PARTITION BY t.trade_id ORDER BY d.bar_date DESC
                    ) AS rn
                FROM trades t JOIN daily_bars d ON d.symbol=t.symbol
                    AND d.bar_date<CAST(t.entry_time AS DATE)
                    AND d.bar_date>=CAST(t.entry_time AS DATE)-15
            ) t GROUP BY t.trade_id
        """).fetchdf()
        daily_stock = daily_stock.merge(
            qqq[["bar_date", "qqq_ret_5d"]], on="bar_date", how="left"
        )
        daily_stock["stock_ret_5d"] = np.where(
            daily_stock["stock_close_5d"] > 0,
            (daily_stock["stock_close"] - daily_stock["stock_close_5d"])
            / daily_stock["stock_close_5d"] * 100,
            np.nan,
        )
        daily_stock["rs_5d"] = (
            daily_stock["stock_ret_5d"] - daily_stock["qqq_ret_5d"]
        )
        daily_stock["rs_5d_abs"] = daily_stock["rs_5d"].abs()
        df = df.merge(
            daily_stock[["trade_id", "rs_5d", "rs_5d_abs"]],
            on="trade_id", how="left",
        )
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
        LEFT JOIN base b ON b.ticker = t.symbol
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
                   AND CAST(s.execution_date AS DATE)
                        <= CAST(t.entry_time AS DATE)),
                CAST(t.entry_time AS DATE)
            ) AS days_since_split,
            DATEDIFF('day',
                CAST(t.entry_time AS DATE),
                (SELECT MIN(CAST(s.execution_date AS DATE))
                 FROM stock_splits s
                 WHERE s.ticker = t.symbol
                   AND CAST(s.execution_date AS DATE)
                        > CAST(t.entry_time AS DATE))
            ) AS days_to_next_split
        FROM trades t
    """).fetchdf()
    df = df.merge(splits, on="trade_id", how="left")

    # === NEW: Technical indicator features ===
    print("  Loading technical indicator features...")
    indicators = con.execute("""
        SELECT trade_id, rsi_14, macd_value, macd_signal, macd_hist,
               ema_9, ema_21, sma_20, sma_50,
               price_vs_ema9, price_vs_ema21, price_vs_sma50,
               ema_spread, above_ema9, above_ema21, above_sma50
        FROM trade_indicator_features
    """).fetchdf()
    df = df.merge(indicators, on="trade_id", how="left")
    ind_cov = df["rsi_14"].notna().sum()
    print(f"    Indicator coverage: {ind_cov:,}/{len(df):,} "
          f"({ind_cov/len(df)*100:.1f}%)")

    # === NEW: Short interest features ===
    print("  Loading short interest features...")
    try:
        shorts = con.execute("""
            SELECT trade_id, short_interest, days_to_cover,
                   CASE WHEN si_avg_daily_volume > 0
                       THEN short_interest * 1.0 / si_avg_daily_volume
                       ELSE NULL
                   END AS short_interest_pct
            FROM trade_short_features
        """).fetchdf()
        df = df.merge(shorts, on="trade_id", how="left")
        si_cov = df["short_interest_pct"].notna().sum()
        print(f"    Short interest coverage: {si_cov:,}/{len(df):,} "
              f"({si_cov/len(df)*100:.1f}%)")
    except Exception as e:
        print(f"    Short interest table error: {e}")

    # === NEW: Extended FRED macro features ===
    print("  Loading extended FRED macro features...")
    try:
        macro = con.execute("""
            SELECT date, hy_spread
            FROM fred_macro_extended
        """).fetchdf()
        macro["date"] = pd.to_datetime(macro["date"]).dt.date
        df["trade_date_dt"] = pd.to_datetime(df["trade_date"]).dt.date
        df = df.merge(
            macro, left_on="trade_date_dt", right_on="date", how="left"
        )
        df = df.drop(columns=["date", "trade_date_dt"], errors="ignore")
        hy_cov = df["hy_spread"].notna().sum()
        print(f"    HY spread coverage: {hy_cov:,}/{len(df):,} "
              f"({hy_cov/len(df)*100:.1f}%)")
    except Exception:
        print("    Extended FRED table not found, skipping.")

    print(f"  All features loaded: {len(df):,} trades "
          f"({time.time()-t0:.1f}s)")
    return df


def compute_ticker_features(df):
    """Compute ticker history features (no look-ahead)."""
    df = df.sort_values("entry_time").reset_index(drop=True)
    n = len(df)
    ticker_prior_wr = np.full(n, np.nan)
    ticker_prior_streak = np.zeros(n, dtype=int)
    ticker_prior_avg_pnl = np.full(n, np.nan)

    ticker_hist = {}
    for i in range(n):
        sym = df.loc[i, "symbol"]
        pnl_val = df.loc[i, "holly_pnl"]
        win_val = df.loc[i, "win"]

        if sym in ticker_hist:
            hist = ticker_hist[sym]
            if len(hist["wins"]) >= 3:
                ticker_prior_wr[i] = (
                    sum(hist["wins"]) / len(hist["wins"]) * 100
                )
                ticker_prior_avg_pnl[i] = np.mean(hist["pnls"])
            ticker_prior_streak[i] = hist["streak"]
        else:
            ticker_hist[sym] = {"wins": [], "pnls": [], "streak": 0}

        hist = ticker_hist[sym]
        hist["wins"].append(win_val)
        hist["pnls"].append(pnl_val)
        if win_val:
            hist["streak"] = max(1, hist["streak"] + 1)
        else:
            hist["streak"] = min(-1, hist["streak"] - 1)

    df["ticker_prior_wr"] = ticker_prior_wr
    df["ticker_prior_streak"] = ticker_prior_streak
    df["ticker_prior_avg_pnl"] = ticker_prior_avg_pnl
    return df


def compute_strategy_meta_features(df):
    """Compute strategy meta-features (no look-ahead)."""
    df = df.sort_values("entry_time").reset_index(drop=True)
    n = len(df)
    strat_wr = np.full(n, np.nan)
    strat_vol_wr = np.full(n, np.nan)

    strat_hist = {}
    strat_vol_hist = {}

    for i in range(n):
        s = df.loc[i, "strategy"]
        vr = df.loc[i, "vol_regime"]
        w = df.loc[i, "win"]

        key_sv = (s, vr) if pd.notna(vr) else None

        if s in strat_hist and len(strat_hist[s]) >= 10:
            strat_wr[i] = sum(strat_hist[s]) / len(strat_hist[s]) * 100
        if key_sv and key_sv in strat_vol_hist and \
                len(strat_vol_hist[key_sv]) >= 10:
            strat_vol_wr[i] = (
                sum(strat_vol_hist[key_sv])
                / len(strat_vol_hist[key_sv]) * 100
            )

        strat_hist.setdefault(s, []).append(w)
        if key_sv:
            strat_vol_hist.setdefault(key_sv, []).append(w)

    df["strategy_recent_wr"] = strat_wr
    df["strategy_vol_regime_wr"] = strat_vol_wr
    return df


def train_and_eval(X_tr, y_tr, X_te, y_te, pnl_te, params, label):
    """Train GBT and evaluate with decile analysis."""
    model = HistGradientBoostingClassifier(
        **params, random_state=42,
        early_stopping=False,
    )
    model.fit(X_tr, y_tr)

    tr_proba = model.predict_proba(X_tr)[:, 1]
    te_proba = model.predict_proba(X_te)[:, 1]

    tr_auc = roc_auc_score(y_tr, tr_proba)
    te_auc = roc_auc_score(y_te, te_proba)

    # Decile PnL spread
    tmp = pd.DataFrame({"score": te_proba, "pnl": pnl_te})
    tmp["decile"] = pd.qcut(tmp["score"], 10, labels=False, duplicates="drop")
    dec = tmp.groupby("decile")["pnl"].mean()
    d10 = dec.iloc[-1] if len(dec) >= 10 else np.nan
    d1 = dec.iloc[0] if len(dec) >= 1 else np.nan

    # Cohen's d between D10 and D1
    d10_vals = tmp[tmp["decile"] == dec.index[-1]]["pnl"]
    d1_vals = tmp[tmp["decile"] == dec.index[0]]["pnl"]
    n1, n2 = len(d10_vals), len(d1_vals)
    if n1 > 5 and n2 > 5:
        m1, m2 = d10_vals.mean(), d1_vals.mean()
        s1, s2 = d10_vals.std(), d1_vals.std()
        ps = np.sqrt(((n1-1)*s1**2 + (n2-1)*s2**2)/(n1+n2-2))
        d_val = abs(m1 - m2) / ps if ps > 0 else 0
    else:
        d_val = 0

    # Feature importances
    try:
        importances = dict(zip(X_tr.columns, model.feature_importances_))
    except AttributeError:
        importances = {c: 0.0 for c in X_tr.columns}

    return {
        "label": label,
        "tr_auc": tr_auc,
        "te_auc": te_auc,
        "overfit": tr_auc - te_auc,
        "d10_pnl": d10,
        "d1_pnl": d1,
        "spread": d10 - d1 if not np.isnan(d10) else np.nan,
        "d": d_val,
        "importances": importances,
    }


def main():
    print("=" * 60)
    print("Composite V14: V9 + Technical Indicators (Script 94)")
    print("=" * 60)

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
    df["gap_pct"] = np.where(
        df["prior_close"].notna() & (df["prior_close"] > 0),
        (df["entry_price"] - df["prior_close"])
        / df["prior_close"] * 100,
        np.nan,
    )
    df["is_short"] = (df["direction"].str.lower() == "short").astype(int)
    df["log_market_cap"] = np.log10(df["market_cap"].clip(lower=1e6))

    # Strategy dummies
    top_strats = df["strategy"].value_counts().head(10).index.tolist()
    for s in top_strats:
        col_name = "strat_" + s.lower().replace(" ", "_")[:20]
        df[col_name] = (df["strategy"] == s).astype(int)

    # Winsorize extreme indicator ratios
    for col in ["price_vs_ema9", "price_vs_ema21", "price_vs_sma50",
                "ema_spread"]:
        if col in df.columns:
            p01 = df[col].quantile(0.01)
            p99 = df[col].quantile(0.99)
            df[col] = df[col].clip(lower=p01, upper=p99)

    # Fix nullable integer columns
    for col in df.columns:
        if str(df[col].dtype) in ("Int64", "Int32", "boolean"):
            df[col] = df[col].astype("float64")

    # Sort chronologically
    df = df.sort_values("entry_time").reset_index(drop=True)
    y = df["win"].values
    pnl = df["holly_pnl"].values
    split = int(len(df) * 0.6)

    print(f"\n  Train: {split:,} | Test: {len(df)-split:,}")

    # Feature sets
    V9_FEATURES = [
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
        V9_FEATURES.append("strat_mighty_mouse")

    # New indicator features (best from lift analysis)
    INDICATOR_FEATURES = [
        "rsi_14",
        "macd_hist",
        "price_vs_ema9",
        "price_vs_sma50",
        "ema_spread",
        "above_ema21",
        "above_sma50",
    ]

    # Extra features from script 91
    EXTRA_FEATURES = []
    for f in ["short_interest_pct", "hy_spread"]:
        if f in df.columns and df[f].notna().sum() > 1000:
            EXTRA_FEATURES.append(f)

    NEW_FEATURES = INDICATOR_FEATURES + EXTRA_FEATURES

    # Direction-split features: remove is_short
    DIR_V9 = [f for f in V9_FEATURES if f != "is_short"]
    DIR_V14 = DIR_V9 + NEW_FEATURES

    best_params = dict(
        max_iter=800, max_depth=3, learning_rate=0.02,
        min_samples_leaf=100, l2_regularization=5.0,
    )

    # === Direction-split training ===
    long_mask = df["direction"].str.lower() == "long"
    short_mask = df["direction"].str.lower() == "short"

    results = {}
    for label, feature_set in [
        ("v9_baseline", DIR_V9),
        ("v14_indicators", DIR_V14),
    ]:
        feats = [c for c in feature_set if c in df.columns]
        print(f"\n{'='*60}")
        print(f"  {label} ({len(feats)} features)")
        print(f"{'='*60}")

        new_in_set = [f for f in feats if f in NEW_FEATURES]
        if new_in_set:
            print(f"  New features: {new_in_set}")

        dir_results = {}
        for direction, mask in [("long", long_mask), ("short", short_mask)]:
            dir_df = df[mask].copy()
            dir_split = int(len(dir_df) * 0.6)

            if dir_split < 100 or len(dir_df) - dir_split < 50:
                print(f"  {direction}: insufficient data")
                continue

            X = dir_df[feats]
            y_dir = dir_df["win"].values
            pnl_dir = dir_df["holly_pnl"].values

            r = train_and_eval(
                X.iloc[:dir_split], y_dir[:dir_split],
                X.iloc[dir_split:], y_dir[dir_split:],
                pnl_dir[dir_split:], best_params,
                f"{label}_{direction}",
            )

            print(f"\n  {direction.upper()}:")
            print(f"    AUC: train={r['tr_auc']:.4f} "
                  f"test={r['te_auc']:.4f} "
                  f"overfit={r['overfit']:.4f}")
            print(f"    D10=${r['d10_pnl']:,.0f} vs D1=${r['d1_pnl']:,.0f} "
                  f"spread=${r['spread']:,.0f}  d={r['d']:.3f}")

            # Top 10 feature importances
            sorted_imp = sorted(
                r["importances"].items(),
                key=lambda x: x[1], reverse=True,
            )
            print(f"    Top features:")
            for fname, imp in sorted_imp[:10]:
                marker = " *NEW*" if fname in NEW_FEATURES else ""
                print(f"      {fname:30s} {imp:.4f}{marker}")

            dir_results[direction] = r

        results[label] = dir_results

    # === COMPARISON ===
    print("\n" + "=" * 60)
    print("  COMPARISON: V9 BASELINE vs V14 INDICATORS")
    print("=" * 60)

    for direction in ["long", "short"]:
        if direction in results.get("v9_baseline", {}) and \
                direction in results.get("v14_indicators", {}):
            v9 = results["v9_baseline"][direction]
            v14 = results["v14_indicators"][direction]

            delta_d = v14["d"] - v9["d"]
            delta_auc = v14["te_auc"] - v9["te_auc"]
            delta_spread = (v14["spread"] - v9["spread"])

            print(f"\n  {direction.upper()}:")
            print(f"    V9:  d={v9['d']:.3f}  AUC={v9['te_auc']:.4f}  "
                  f"spread=${v9['spread']:,.0f}")
            print(f"    V14: d={v14['d']:.3f}  AUC={v14['te_auc']:.4f}  "
                  f"spread=${v14['spread']:,.0f}")
            print(f"    Delta: d={delta_d:+.3f}  AUC={delta_auc:+.4f}  "
                  f"spread=${delta_spread:+,.0f}")
            verdict = "IMPROVEMENT" if delta_d > 0.01 else (
                "MARGINAL" if delta_d > 0 else "NO GAIN"
            )
            print(f"    Verdict: {verdict}")

    elapsed = time.time() - t0
    print(f"\nComposite v14 analysis complete in {elapsed:.1f}s")


if __name__ == "__main__":
    main()
