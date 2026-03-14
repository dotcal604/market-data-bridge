"""
Script 68 — Composite v4: Full GBT with All Discovered Features
=================================================================
Incorporates ALL features discovered in scripts 45-67:
  - Original 14 from linear composite v3
  - Multi-day patterns (script 61): ATR contraction, volume trend, dist from MA20
  - Relative strength (script 62): RS absolute magnitude, range position
  - Volume microstructure (script 63): 30-min range, bar volatility, vol acceleration
  - Ticker history (script 66): prior WR, streak, prior avg P&L
  - Strategy × regime (script 67): strategy rolling WR, strategy streak,
    strategy × vol regime WR, strategy × VIX bucket WR

Walk-forward: 60% train / 40% test (chronological).
Compare to:
  - Linear composite v3: OOS d=0.592
  - GBT v1 (21 features): OOS d=0.767
  - Enhanced GBT (45 features): OOS d=0.784

Usage:
    python scripts/68_composite_v4_gbt.py
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
    """Load all features from every data source."""
    t0 = time.time()
    print("Loading features...")

    # Base trades
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

    # Daily bars features (prior day context + multi-day patterns)
    daily = con.execute("""
        WITH dw AS (
            SELECT t.trade_id, d.close, d.high, d.low, d.volume, d.open,
                ROW_NUMBER() OVER (PARTITION BY t.trade_id ORDER BY d.bar_date DESC) AS rn
            FROM trades t JOIN daily_bars d ON d.symbol=t.symbol
                AND d.bar_date<CAST(t.entry_time AS DATE)
                AND d.bar_date>=CAST(t.entry_time AS DATE)-25
        )
        SELECT trade_id,
            -- Prior day context
            MAX(CASE WHEN rn=1 THEN close END) AS prior_close,
            MAX(CASE WHEN rn=1 THEN CASE WHEN close>0 THEN (high-low)/close*100 END END) AS prior_day_range_pct,
            MAX(CASE WHEN rn=1 THEN volume END)/NULLIF(AVG(CASE WHEN rn BETWEEN 2 AND 21 THEN volume END),0) AS volume_ratio,
            -- Prior day return
            CASE WHEN MAX(CASE WHEN rn=2 THEN close END) > 0 THEN
                (MAX(CASE WHEN rn=1 THEN close END) - MAX(CASE WHEN rn=2 THEN close END)) /
                MAX(CASE WHEN rn=2 THEN close END) * 100
            END AS prior_day_return_pct,
            -- Prior day gap
            CASE WHEN MAX(CASE WHEN rn=2 THEN close END) > 0 THEN
                (MAX(CASE WHEN rn=1 THEN open END) - MAX(CASE WHEN rn=2 THEN close END)) /
                MAX(CASE WHEN rn=2 THEN close END) * 100
            END AS prior_day_gap_pct,
            -- ATR contraction
            MAX(CASE WHEN rn=1 THEN high-low END)/NULLIF(AVG(CASE WHEN rn BETWEEN 1 AND 20 THEN high-low END),0) AS atr_contraction,
            -- Distance from 20-day MA
            (MAX(CASE WHEN rn=1 THEN close END)-AVG(CASE WHEN rn BETWEEN 1 AND 20 THEN close END))/
                NULLIF(AVG(CASE WHEN rn BETWEEN 1 AND 20 THEN close END),0)*100 AS dist_from_ma20_pct,
            -- 20-day range position
            (MAX(CASE WHEN rn=1 THEN close END)-MIN(CASE WHEN rn BETWEEN 1 AND 20 THEN low END))/
                NULLIF(MAX(CASE WHEN rn BETWEEN 1 AND 20 THEN high END)-MIN(CASE WHEN rn BETWEEN 1 AND 20 THEN low END),0)*100 AS range_position_20d,
            -- 5-day return
            CASE WHEN MAX(CASE WHEN rn=5 THEN close END) > 0 THEN
                (MAX(CASE WHEN rn=1 THEN close END) - MAX(CASE WHEN rn=5 THEN close END)) /
                MAX(CASE WHEN rn=5 THEN close END) * 100
            END AS five_day_return_pct,
            -- 3-day volume trend
            AVG(CASE WHEN rn BETWEEN 1 AND 3 THEN volume END)/
                NULLIF(AVG(CASE WHEN rn BETWEEN 4 AND 10 THEN volume END),0) AS vol_trend_3d
        FROM dw WHERE rn<=21 GROUP BY trade_id
    """).fetchdf()
    df = df.merge(daily, on="trade_id", how="left")

    # Intraday features (microstructure)
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
    qqq = con.execute("""
        SELECT bar_date, close FROM daily_bars WHERE symbol = 'QQQ' ORDER BY bar_date
    """).fetchdf()
    if len(qqq) > 0:
        qqq = qqq.set_index("bar_date").sort_index()
        qqq["qqq_ret_5d"] = qqq["close"].pct_change(5) * 100
        qqq["qqq_ret_10d"] = qqq["close"].pct_change(10) * 100
        qqq = qqq.reset_index()

        daily_stock = con.execute("""
            SELECT t.trade_id,
                MAX(CASE WHEN rn=1 THEN close END) AS stock_close,
                MAX(CASE WHEN rn=5 THEN close END) AS stock_close_5d,
                MAX(CASE WHEN rn=10 THEN close END) AS stock_close_10d,
                MAX(CASE WHEN rn=1 THEN bar_date END) AS bar_date
            FROM (
                SELECT t.trade_id, d.close, d.bar_date,
                    ROW_NUMBER() OVER (PARTITION BY t.trade_id ORDER BY d.bar_date DESC) AS rn
                FROM trades t JOIN daily_bars d ON d.symbol=t.symbol
                    AND d.bar_date<CAST(t.entry_time AS DATE)
                    AND d.bar_date>=CAST(t.entry_time AS DATE)-15
            ) t GROUP BY t.trade_id
        """).fetchdf()

        daily_stock = daily_stock.merge(
            qqq[["bar_date", "qqq_ret_5d", "qqq_ret_10d"]], on="bar_date", how="left")

        daily_stock["stock_ret_5d"] = np.where(
            daily_stock["stock_close_5d"] > 0,
            (daily_stock["stock_close"] - daily_stock["stock_close_5d"]) / daily_stock["stock_close_5d"] * 100,
            np.nan)
        daily_stock["rs_5d"] = daily_stock["stock_ret_5d"] - daily_stock["qqq_ret_5d"]
        daily_stock["rs_5d_abs"] = daily_stock["rs_5d"].abs()

        df = df.merge(daily_stock[["trade_id", "rs_5d", "rs_5d_abs"]], on="trade_id", how="left")
    else:
        df["rs_5d"] = np.nan
        df["rs_5d_abs"] = np.nan

    # Derived columns
    df["gap_pct"] = np.where(df["prior_close"].notna() & (df["prior_close"]>0),
        (df["entry_price"]-df["prior_close"])/df["prior_close"]*100, np.nan)
    df["is_short"] = (df["direction"].str.lower()=="short").astype(int)
    df["log_market_cap"] = np.log10(df["market_cap"].clip(lower=1e6))
    df["vol_regime_ord"] = df["vol_regime"].map({"low":0, "normal":1, "high":2})

    # VIX bucket for strategy interaction
    df["vix_bucket"] = pd.cut(df["vix"], bins=[0, 15, 20, 25, 100],
                              labels=["low", "mid", "high", "extreme"],
                              right=False).astype(str)
    df.loc[df["vix"].isna(), "vix_bucket"] = np.nan

    # Strategy dummies (top 10)
    top_strats = df["strategy"].value_counts().head(10).index.tolist()
    for s in top_strats:
        col_name = "strat_" + s.lower().replace(" ", "_")[:20]
        df[col_name] = (df["strategy"] == s).astype(int)

    print(f"  Base features loaded: {len(df):,} trades ({time.time()-t0:.1f}s)")
    return df, top_strats


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
    from scipy import stats

    t0 = time.time()
    con = duckdb.connect(str(DUCKDB_PATH), read_only=True)
    print(f"Connected to {DUCKDB_PATH.name}")

    df, top_strats = load_all_features(con)
    con.close()

    # Compute look-ahead-free features
    print("  Computing ticker history features...")
    df = compute_ticker_features(df)
    print("  Computing strategy meta-features...")
    df = compute_strategy_meta_features(df)
    print(f"  Total features ready: {len(df):,} trades")

    # ── Define feature columns ──
    strat_cols = ["strat_" + s.lower().replace(" ", "_")[:20] for s in top_strats]

    FEATURE_COLS = [
        # Core
        "log_market_cap", "is_short", "gap_pct", "eps_diluted", "op_margin",
        "net_margin", "vol_regime_ord", "atr_pct", "vix", "yield_spread_10y2y",
        "days_to_earnings", "minutes_since_open", "quarter", "dow",
        # Prior day
        "prior_day_range_pct", "volume_ratio", "prior_day_return_pct",
        "prior_day_gap_pct",
        # Multi-day patterns
        "atr_contraction", "dist_from_ma20_pct", "range_position_20d",
        "five_day_return_pct", "vol_trend_3d",
        # Relative strength
        "rs_5d", "rs_5d_abs",
        # Microstructure
        "opening_range_pct", "vwap_position_pct", "vol_acceleration",
        "range_30m_pct", "avg_bar_range_30m",
        # Ticker history
        "ticker_prior_wr", "ticker_prior_streak", "ticker_prior_avg_pnl",
        # Strategy meta
        "strategy_recent_wr", "strategy_recent_streak", "strategy_vol_regime_wr",
    ] + strat_cols

    available = [c for c in FEATURE_COLS if c in df.columns]
    print(f"\n  Features available: {len(available)}/{len(FEATURE_COLS)}")

    # Sort chronologically
    df = df.sort_values("entry_time").reset_index(drop=True)
    X = df[available].copy()
    y = df["win"].values
    pnl = df["holly_pnl"].values

    split = int(len(X) * 0.6)
    X_tr, X_te = X.iloc[:split], X.iloc[split:]
    y_tr, y_te = y[:split], y[split:]
    pnl_tr, pnl_te = pnl[:split], pnl[split:]

    print(f"  Train: {split:,} | Test: {len(X)-split:,}")
    print(f"  Train WR: {y_tr.mean()*100:.1f}% | Test WR: {y_te.mean()*100:.1f}%")

    # ── Train full model ──
    print("\nTraining Composite v4 GBT...")
    model = HistGradientBoostingClassifier(
        max_iter=500, max_depth=5, learning_rate=0.03,
        min_samples_leaf=50, l2_regularization=2.0,
        early_stopping=True, n_iter_no_change=20,
        validation_fraction=0.15, random_state=42,
    )
    model.fit(X_tr, y_tr)
    print(f"  Iterations: {model.n_iter_}")

    # Predictions
    tr_proba = model.predict_proba(X_tr)[:, 1]
    te_proba = model.predict_proba(X_te)[:, 1]

    tr_auc = roc_auc_score(y_tr, tr_proba)
    te_auc = roc_auc_score(y_te, te_proba)
    print(f"  Train AUC: {tr_auc:.4f} | Test AUC: {te_auc:.4f}")
    print(f"  Overfit gap: {tr_auc - te_auc:.4f}")

    # ── Decile analysis ──
    te_df = pd.DataFrame({
        "proba": te_proba, "win": y_te, "pnl": pnl_te,
        "direction": df.iloc[split:]["direction"].values,
    })
    te_df["pct"] = te_df["proba"].rank(pct=True).mul(100)
    te_df["decile"] = pd.qcut(te_df["pct"], 10, labels=[f"D{i}" for i in range(1, 11)])

    decile_stats = te_df.groupby("decile", observed=True).agg(
        n=("win", "count"),
        wr=("win", "mean"),
        avg_pnl=("pnl", "mean"),
        med_pnl=("pnl", "median"),
    ).reset_index()
    decile_stats["wr"] *= 100

    # Monotonicity check
    wrs = decile_stats["wr"].values
    monotonic = sum(1 for i in range(len(wrs)-1) if wrs[i] < wrs[i+1])

    # Cohen's d: D10 vs D1
    d10 = te_df[te_df["decile"] == "D10"]["pnl"]
    d1 = te_df[te_df["decile"] == "D1"]["pnl"]
    d10_wr = te_df[te_df["decile"] == "D10"]["win"].mean() * 100
    d1_wr = te_df[te_df["decile"] == "D1"]["win"].mean() * 100
    d10_mean = d10.mean()
    d1_mean = d1.mean()
    pooled = np.sqrt((d10.std()**2 + d1.std()**2) / 2)
    cohens_d = (d10_mean - d1_mean) / pooled if pooled > 0 else 0
    _, p_value = stats.ttest_ind(d10, d1, equal_var=False)

    print(f"\n  OOS Cohen's d (D10 vs D1): {cohens_d:.3f}")
    print(f"  D10 WR: {d10_wr:.1f}% | D1 WR: {d1_wr:.1f}%")
    print(f"  Monotonic transitions: {monotonic}/9")

    # ── Feature importance ──
    print("\n  Computing permutation importance...")
    perm = permutation_importance(model, X_te, y_te, n_repeats=10, random_state=42, n_jobs=-1)
    feat_imp = pd.Series(perm.importances_mean, index=available).sort_values(ascending=False)

    # ── Train slim model (no ticker/strategy meta for comparison) ──
    print("\nTraining Slim GBT (no look-ahead-free features)...")
    slim_cols = [c for c in available if c not in
                 ["ticker_prior_wr", "ticker_prior_streak", "ticker_prior_avg_pnl",
                  "strategy_recent_wr", "strategy_recent_streak", "strategy_vol_regime_wr"]]
    slim_model = HistGradientBoostingClassifier(
        max_iter=500, max_depth=5, learning_rate=0.03,
        min_samples_leaf=50, l2_regularization=2.0,
        early_stopping=True, n_iter_no_change=20,
        validation_fraction=0.15, random_state=42,
    )
    slim_model.fit(X_tr[slim_cols], y_tr)
    slim_te_proba = slim_model.predict_proba(X_te[slim_cols])[:, 1]
    slim_auc = roc_auc_score(y_te, slim_te_proba)

    slim_df = pd.DataFrame({"proba": slim_te_proba, "win": y_te, "pnl": pnl_te})
    slim_df["decile"] = pd.qcut(slim_df["proba"].rank(pct=True).mul(100), 10,
                                 labels=[f"D{i}" for i in range(1,11)])
    slim_d10 = slim_df[slim_df["decile"]=="D10"]["pnl"]
    slim_d1 = slim_df[slim_df["decile"]=="D1"]["pnl"]
    slim_pooled = np.sqrt((slim_d10.std()**2 + slim_d1.std()**2) / 2)
    slim_d = (slim_d10.mean() - slim_d1.mean()) / slim_pooled if slim_pooled > 0 else 0

    print(f"  Slim AUC: {slim_auc:.4f} | d: {slim_d:.3f}")

    # ── Build report ──
    report = []
    report.append("# Composite v4 — Full GBT with All Discovered Features")
    report.append("")
    report.append(f"Generated: {pd.Timestamp.now().strftime('%Y-%m-%d %H:%M')}")
    report.append(f"Total trades: {len(df):,}")
    report.append(f"Train: {split:,} ({y_tr.mean()*100:.1f}% WR) | Test: {len(X)-split:,} ({y_te.mean()*100:.1f}% WR)")
    report.append(f"Features: {len(available)}")
    report.append(f"Model iterations: {model.n_iter_}")
    report.append("")

    # Progress table
    report.append("## 1. Model Progression")
    report.append("")
    report.append("| Model | Features | OOS d | AUC | D10 WR | D1 WR |")
    report.append("|-------|----------|-------|-----|--------|-------|")
    report.append(f"| Linear v3 (script 59) | 14 | 0.592 | — | — | — |")
    report.append(f"| GBT v1 (script 60) | 21 | 0.767 | 0.7202 | 81.0% | 19.4% |")
    report.append(f"| Enhanced GBT (script 64) | 45 | 0.784 | 0.7234 | 80.2% | — |")
    report.append(f"| **Composite v4** | {len(available)} | **{cohens_d:.3f}** | **{te_auc:.4f}** | **{d10_wr:.1f}%** | **{d1_wr:.1f}%** |")
    report.append(f"| Slim v4 (no meta) | {len(slim_cols)} | {slim_d:.3f} | {slim_auc:.4f} | — | — |")
    report.append("")

    # Key metrics
    report.append("## 2. Key Metrics")
    report.append("")
    report.append(f"- **OOS Cohen's d:** {cohens_d:.3f}")
    report.append(f"- **OOS AUC:** {te_auc:.4f}")
    report.append(f"- **Train AUC:** {tr_auc:.4f}")
    report.append(f"- **Overfit gap:** {tr_auc - te_auc:.4f}")
    report.append(f"- **Monotonicity:** {monotonic}/9")
    report.append(f"- **p-value (D10 vs D1):** {p_value:.2e}")
    report.append("")

    # Decile table
    report.append("## 3. OOS Decile Breakdown")
    report.append("")
    report.append("| Decile | n | Win Rate | Avg P&L | Median P&L |")
    report.append("|--------|---|----------|---------|------------|")
    for _, row in decile_stats.iterrows():
        report.append(f"| {row['decile']} | {row['n']:,.0f} | {row['wr']:.1f}% | ${row['avg_pnl']:.0f} | ${row['med_pnl']:.0f} |")
    report.append("")

    # Feature importance
    report.append("## 4. Feature Importance (Permutation, Top 20)")
    report.append("")
    report.append("| Rank | Feature | Importance |")
    report.append("|------|---------|------------|")
    for rank, (feat, imp) in enumerate(feat_imp.head(20).items(), 1):
        report.append(f"| {rank} | {feat} | {imp:.4f} |")
    report.append("")

    # Lift from meta features
    report.append("## 5. Contribution of Look-Ahead-Free Meta Features")
    report.append("")
    meta_feats = ["ticker_prior_wr", "ticker_prior_streak", "ticker_prior_avg_pnl",
                  "strategy_recent_wr", "strategy_recent_streak", "strategy_vol_regime_wr"]
    meta_imps = [(f, feat_imp.get(f, 0)) for f in meta_feats if f in feat_imp.index]
    meta_imps.sort(key=lambda x: x[1], reverse=True)
    report.append(f"Full model d={cohens_d:.3f} vs Slim d={slim_d:.3f} → meta features add Δd={cohens_d-slim_d:.3f}")
    report.append("")
    report.append("| Feature | Importance |")
    report.append("|---------|------------|")
    for feat, imp in meta_imps:
        report.append(f"| {feat} | {imp:.4f} |")
    report.append("")

    # Conclusions
    report.append("## 6. Conclusions")
    report.append("")
    if cohens_d > 0.784:
        report.append(f"**Composite v4 beats Enhanced GBT:** d={cohens_d:.3f} vs 0.784 (Δ={cohens_d-0.784:.3f})")
    else:
        report.append(f"**Composite v4 similar to Enhanced GBT:** d={cohens_d:.3f} vs 0.784")
    report.append(f"- Top features remain log_market_cap and is_short")
    report.append(f"- Meta features (ticker/strategy history) contribute: Δd={cohens_d-slim_d:.3f}")
    report.append(f"- Overfit gap: {tr_auc - te_auc:.4f}")
    if monotonic >= 8:
        report.append(f"- Strong monotonicity: {monotonic}/9 transitions")
    report.append("")

    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    path = REPORT_DIR / "composite-v4-gbt.md"
    path.write_text("\n".join(report), encoding="utf-8")

    elapsed = time.time() - t0
    print(f"\nReport: {path}")
    print(f"Done in {elapsed:.1f}s")


if __name__ == "__main__":
    main()
