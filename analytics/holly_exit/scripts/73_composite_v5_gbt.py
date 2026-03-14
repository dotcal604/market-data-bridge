"""
Script 73 — Composite v5: GBT with All Features Including New Data Sources
=============================================================================
Extends v4 (46 features, d=1.180) with features from scripts 69-72:
  - Script 69: Regime momentum & macro (RSI, ROC, put/call, yield curve)
  - Script 71: Sector ETF rotation (SPY/QQQ/IWM returns, market breadth)
  - Script 72: Multi-day volume patterns (log_volume, transactions, volatility_5d)

Walk-forward: 60% train / 40% test (chronological).
Compare to:
  - Composite v4 (46 features): OOS d=1.180, AUC=0.7936

Usage:
    python scripts/73_composite_v5_gbt.py
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
    """Load all features from every data source (v4 + new)."""
    t0 = time.time()
    print("Loading features...")

    # Base trades + regime + macro + ticker details
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
            -- New from script 69: regime momentum
            r.rsi14, r.roc5, r.roc20, r.daily_range_pct AS regime_daily_range,
            fm.vix, fm.yield_spread_10y2y,
            -- New from script 69: macro indicators
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

    # Daily bars features (prior day + multi-day patterns)
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

    # ── NEW: daily_bars_flat features (script 72) ──
    print("  Loading daily_bars_flat features (transactions, volume)...")
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

    # ── NEW: Sector ETF features (script 71) ──
    print("  Loading sector ETF features (SPY context)...")
    etf_daily = con.execute("""
        SELECT symbol,
            CAST(bar_time AS DATE) AS trade_date,
            FIRST(open ORDER BY bar_time) AS day_open,
            MAX(high) AS day_high,
            MIN(low) AS day_low,
            LAST(close ORDER BY bar_time) AS day_close,
            SUM(volume) AS day_volume
        FROM etf_bars
        WHERE bar_time::TIME BETWEEN '09:30:00' AND '15:59:00'
        GROUP BY symbol, CAST(bar_time AS DATE)
        ORDER BY symbol, trade_date
    """).fetchdf()

    # Compute SPY prior-day return and intraday range
    spy = etf_daily[etf_daily["symbol"] == "SPY"].sort_values("trade_date").copy()
    spy["spy_return_1d"] = spy["day_close"].pct_change() * 100
    spy["spy_intraday_range"] = (spy["day_high"] - spy["day_low"]) / spy["day_close"] * 100
    # Shift forward for prior-day lookup
    spy["trade_date_next"] = spy["trade_date"].shift(-1)
    spy_lookup = spy[["trade_date_next", "spy_return_1d", "spy_intraday_range"]].dropna().rename(
        columns={"trade_date_next": "trade_date"})
    df["trade_date_ts"] = pd.to_datetime(df["trade_date"])
    spy_lookup["trade_date"] = pd.to_datetime(spy_lookup["trade_date"])
    df = df.merge(spy_lookup, left_on="trade_date_ts", right_on="trade_date",
                  how="left", suffixes=("", "_spy"))
    df = df.drop(columns=["trade_date_spy", "trade_date_ts"], errors="ignore")

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
    from scipy import stats

    t0 = time.time()
    con = duckdb.connect(str(DUCKDB_PATH), read_only=True)
    print(f"Connected to {DUCKDB_PATH.name}")
    df = load_all_features(con)
    con.close()

    # Compute look-ahead-free features
    print("  Computing ticker history features...")
    df = compute_ticker_features(df)
    print("  Computing strategy meta-features...")
    df = compute_strategy_meta_features(df)

    # Derived columns
    df["gap_pct"] = np.where(df["prior_close"].notna() & (df["prior_close"] > 0),
        (df["entry_price"] - df["prior_close"]) / df["prior_close"] * 100, np.nan)
    df["is_short"] = (df["direction"].str.lower() == "short").astype(int)
    df["log_market_cap"] = np.log10(df["market_cap"].clip(lower=1e6))
    df["vol_regime_ord"] = df["vol_regime"].map({"low": 0, "normal": 1, "high": 2})

    # Strategy dummies (top 10)
    top_strats = df["strategy"].value_counts().head(10).index.tolist()
    strat_cols = []
    for s in top_strats:
        col_name = "strat_" + s.lower().replace(" ", "_")[:20]
        df[col_name] = (df["strategy"] == s).astype(int)
        strat_cols.append(col_name)

    print(f"  Total features ready: {len(df):,} trades")

    # ── Feature columns (v4 base + new from scripts 69-72) ──
    FEATURE_COLS = [
        # Core (v4)
        "log_market_cap", "is_short", "gap_pct", "eps_diluted", "op_margin",
        "net_margin", "vol_regime_ord", "atr_pct", "vix", "yield_spread_10y2y",
        "days_to_earnings", "minutes_since_open", "quarter", "dow",
        # Prior day (v4)
        "prior_day_range_pct", "volume_ratio", "prior_day_return_pct", "prior_day_gap_pct",
        # Multi-day patterns (v4)
        "atr_contraction", "dist_from_ma20_pct", "range_position_20d",
        "five_day_return_pct", "vol_trend_3d",
        # Relative strength (v4)
        "rs_5d", "rs_5d_abs",
        # Microstructure (v4)
        "opening_range_pct", "vwap_position_pct", "vol_acceleration",
        "range_30m_pct", "avg_bar_range_30m",
        # Ticker history (v4)
        "ticker_prior_wr", "ticker_prior_streak", "ticker_prior_avg_pnl",
        # Strategy meta (v4)
        "strategy_recent_wr", "strategy_recent_streak", "strategy_vol_regime_wr",
        # NEW: Regime momentum (script 69)
        "rsi14", "roc5", "roc20", "regime_daily_range",
        "put_call_equity", "vix_5d_change",
        # NEW: Multi-day volume from daily_bars_flat (script 72)
        "flat_log_volume_1d", "flat_transactions_1d",
        # NEW: Sector ETF context (script 71)
        "spy_return_1d", "spy_intraday_range",
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
    pnl_te = pnl[split:]

    print(f"  Train: {split:,} | Test: {len(X)-split:,}")
    print(f"  Train WR: {y_tr.mean()*100:.1f}% | Test WR: {y_te.mean()*100:.1f}%")

    # ── Train full model ──
    print("\nTraining Composite v5 GBT...")
    model = HistGradientBoostingClassifier(
        max_iter=500, max_depth=5, learning_rate=0.03,
        min_samples_leaf=50, l2_regularization=2.0,
        early_stopping=True, n_iter_no_change=20,
        validation_fraction=0.15, random_state=42,
    )
    model.fit(X_tr, y_tr)
    print(f"  Iterations: {model.n_iter_}")

    tr_proba = model.predict_proba(X_tr)[:, 1]
    te_proba = model.predict_proba(X_te)[:, 1]
    tr_auc = roc_auc_score(y_tr, tr_proba)
    te_auc = roc_auc_score(y_te, te_proba)
    print(f"  Train AUC: {tr_auc:.4f} | Test AUC: {te_auc:.4f}")
    print(f"  Overfit gap: {tr_auc - te_auc:.4f}")

    # Decile analysis
    te_df = pd.DataFrame({"proba": te_proba, "win": y_te, "pnl": pnl_te})
    te_df["decile"] = pd.qcut(te_df["proba"].rank(pct=True).mul(100), 10,
                               labels=[f"D{i}" for i in range(1, 11)])

    decile_stats = te_df.groupby("decile", observed=True).agg(
        n=("win", "count"), wr=("win", "mean"),
        avg_pnl=("pnl", "mean"), med_pnl=("pnl", "median"),
    ).reset_index()
    decile_stats["wr"] *= 100

    wrs = decile_stats["wr"].values
    monotonic = sum(1 for i in range(len(wrs)-1) if wrs[i] < wrs[i+1])

    d10 = te_df[te_df["decile"] == "D10"]["pnl"]
    d1 = te_df[te_df["decile"] == "D1"]["pnl"]
    d10_wr = te_df[te_df["decile"] == "D10"]["win"].mean() * 100
    d1_wr = te_df[te_df["decile"] == "D1"]["win"].mean() * 100
    pooled = np.sqrt((d10.std()**2 + d1.std()**2) / 2)
    cohens_d = (d10.mean() - d1.mean()) / pooled if pooled > 0 else 0
    _, p_value = stats.ttest_ind(d10, d1, equal_var=False)

    print(f"\n  OOS Cohen's d (D10 vs D1): {cohens_d:.3f}")
    print(f"  D10 WR: {d10_wr:.1f}% | D1 WR: {d1_wr:.1f}%")
    print(f"  Monotonic: {monotonic}/9")

    # Feature importance
    print("\n  Computing permutation importance...")
    perm = permutation_importance(model, X_te, y_te, n_repeats=10, random_state=42, n_jobs=-1)
    feat_imp = pd.Series(perm.importances_mean, index=available).sort_values(ascending=False)

    # New features contribution
    new_features = ["rsi14", "roc5", "roc20", "regime_daily_range", "put_call_equity",
                    "vix_5d_change", "flat_log_volume_1d", "flat_transactions_1d",
                    "spy_return_1d", "spy_intraday_range"]
    new_feat_imps = [(f, feat_imp.get(f, 0)) for f in new_features if f in feat_imp.index]
    new_feat_imps.sort(key=lambda x: x[1], reverse=True)

    # ── Build report ──
    report = []
    report.append("# Composite v5 — Full GBT with All Data Sources")
    report.append("")
    report.append(f"Generated: {pd.Timestamp.now().strftime('%Y-%m-%d %H:%M')}")
    report.append(f"Total trades: {len(df):,}")
    report.append(f"Train: {split:,} ({y_tr.mean()*100:.1f}% WR) | Test: {len(X)-split:,} ({y_te.mean()*100:.1f}% WR)")
    report.append(f"Features: {len(available)}")
    report.append(f"Model iterations: {model.n_iter_}")
    report.append("")

    report.append("## 1. Model Progression")
    report.append("")
    report.append("| Model | Features | OOS d | AUC | D10 WR | D1 WR |")
    report.append("|-------|----------|-------|-----|--------|-------|")
    report.append("| Linear v3 (script 59) | 14 | 0.592 | — | — | — |")
    report.append("| GBT v1 (script 60) | 21 | 0.767 | 0.7202 | 81.0% | 19.4% |")
    report.append("| Enhanced GBT (script 64) | 45 | 0.784 | 0.7234 | 80.2% | — |")
    report.append("| Composite v4 (script 68) | 46 | 1.180 | 0.7936 | 94.4% | 8.1% |")
    report.append(f"| **Composite v5** | {len(available)} | **{cohens_d:.3f}** | **{te_auc:.4f}** | **{d10_wr:.1f}%** | **{d1_wr:.1f}%** |")
    report.append("")

    report.append("## 2. Key Metrics")
    report.append("")
    report.append(f"- **OOS Cohen's d:** {cohens_d:.3f}")
    report.append(f"- **OOS AUC:** {te_auc:.4f}")
    report.append(f"- **Train AUC:** {tr_auc:.4f}")
    report.append(f"- **Overfit gap:** {tr_auc - te_auc:.4f}")
    report.append(f"- **Monotonicity:** {monotonic}/9")
    report.append(f"- **p-value (D10 vs D1):** {p_value:.2e}")
    report.append("")

    report.append("## 3. OOS Decile Breakdown")
    report.append("")
    report.append("| Decile | n | Win Rate | Avg P&L | Median P&L |")
    report.append("|--------|---|----------|---------|------------|")
    for _, row in decile_stats.iterrows():
        report.append(f"| {row['decile']} | {row['n']:,.0f} | {row['wr']:.1f}% | ${row['avg_pnl']:.0f} | ${row['med_pnl']:.0f} |")
    report.append("")

    report.append("## 4. Feature Importance (Permutation, Top 25)")
    report.append("")
    report.append("| Rank | Feature | Importance |")
    report.append("|------|---------|------------|")
    for rank, (feat, imp) in enumerate(feat_imp.head(25).items(), 1):
        new_flag = " *NEW*" if feat in new_features else ""
        report.append(f"| {rank} | {feat}{new_flag} | {imp:.4f} |")
    report.append("")

    report.append("## 5. New Feature Contribution (Scripts 69-72)")
    report.append("")
    report.append("| Feature | Source | Importance |")
    report.append("|---------|--------|------------|")
    for feat, imp in new_feat_imps:
        source = "regime" if feat in ["rsi14", "roc5", "roc20", "regime_daily_range", "put_call_equity", "vix_5d_change"] \
            else "volume" if feat in ["flat_log_volume_1d", "flat_transactions_1d"] \
            else "ETF"
        report.append(f"| {feat} | {source} | {imp:.4f} |")
    report.append("")

    report.append("## 6. Conclusions")
    report.append("")
    delta = cohens_d - 1.180
    if delta > 0:
        report.append(f"**Composite v5 improves on v4:** d={cohens_d:.3f} vs 1.180 (+{delta:.3f})")
    elif delta > -0.05:
        report.append(f"**Composite v5 comparable to v4:** d={cohens_d:.3f} vs 1.180 ({delta:+.3f})")
    else:
        report.append(f"**Composite v5 slight regression from v4:** d={cohens_d:.3f} vs 1.180 ({delta:+.3f})")
    report.append(f"- New features added: {len(new_features)} (regime, volume, ETF)")
    report.append(f"- Overfit gap: {tr_auc - te_auc:.4f}")
    if monotonic >= 8:
        report.append(f"- Strong monotonicity: {monotonic}/9 transitions")
    report.append("")

    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    path = REPORT_DIR / "composite-v5-gbt.md"
    path.write_text("\n".join(report), encoding="utf-8")
    elapsed = time.time() - t0
    print(f"\nReport: {path}")
    print(f"Done in {elapsed:.1f}s")


if __name__ == "__main__":
    main()
