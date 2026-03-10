"""
64_enhanced_gbt_model.py — Enhanced GBT with all features from scripts 61-63.

Builds on script 60's GBT (OOS d=0.767) by adding:
  - Multi-day pattern features (script 61): ATR contraction, vol trend, 5d return
  - Relative strength vs QQQ (script 62): RS 5d/10d magnitude
  - Volume microstructure (script 63): bar volatility, minutes since open
  - Explicit interaction features: market_cap × direction, strategy encoding

Also tests feature selection to reduce overfitting.

Walk-forward: train on first 60%, test on last 40%.

Output: reports/enhanced-gbt-model.md

Usage:
    python scripts/64_enhanced_gbt_model.py
"""

import sys
import time
import warnings
from pathlib import Path

import duckdb
import numpy as np
import pandas as pd
from scipy import stats

sys.path.insert(0, str(Path(__file__).parent.parent))
from config.settings import DUCKDB_PATH, DATA_DIR

REPORT_DIR = DATA_DIR.parent / "output" / "reports"
warnings.filterwarnings("ignore", category=FutureWarning)


def welch_t_test(a: pd.Series, b: pd.Series) -> dict:
    a, b = a.dropna(), b.dropna()
    if len(a) < 10 or len(b) < 10:
        return {"t_stat": np.nan, "p_value": np.nan, "cohens_d": np.nan,
                "n_a": len(a), "n_b": len(b)}
    t_stat, p_value = stats.ttest_ind(a, b, equal_var=False)
    pooled_std = np.sqrt((a.std()**2 + b.std()**2) / 2)
    cohens_d = (a.mean() - b.mean()) / pooled_std if pooled_std > 0 else 0
    return {"t_stat": t_stat, "p_value": p_value, "cohens_d": cohens_d,
            "n_a": len(a), "n_b": len(b)}


def load_all_features(con: duckdb.DuckDBPyConnection) -> pd.DataFrame:
    """Load trades with ALL feature sources including new scripts 61-63."""
    print("Loading comprehensive feature set...")
    t0 = time.time()

    # Base + regime + fred + ticker
    df = con.execute("""
        SELECT
            t.trade_id, t.symbol, t.entry_time, t.entry_price,
            t.strategy, t.direction, t.holly_pnl, t.mfe, t.mae,
            CASE WHEN t.holly_pnl > 0 THEN 1 ELSE 0 END AS win,
            CAST(t.entry_time AS DATE) AS trade_date,
            EXTRACT(QUARTER FROM t.entry_time) AS quarter,
            EXTRACT(DOW FROM t.entry_time) AS dow,
            EXTRACT(HOUR FROM t.entry_time) AS hour,
            EXTRACT(HOUR FROM t.entry_time) * 60 + EXTRACT(MINUTE FROM t.entry_time) - 570
                AS minutes_since_open,
            r.vol_regime, r.atr_pct,
            fm.vix, fm.yield_spread_10y2y,
            td.market_cap
        FROM trades t
        LEFT JOIN trade_regime r ON r.trade_id = t.trade_id
        LEFT JOIN fred_macro_daily fm ON fm.date = CAST(t.entry_time AS DATE)
        LEFT JOIN ticker_details td ON td.symbol = t.symbol
    """).fetchdf()

    # Earnings proximity (continuous)
    earnings = con.execute("""
        SELECT t.trade_id,
            COALESCE(MIN(ABS(DATEDIFF('day',
                CAST(t.entry_time AS DATE), ec.earnings_date))), 999)
                AS days_to_earnings
        FROM trades t
        LEFT JOIN earnings_calendar ec ON ec.symbol = t.symbol
            AND ec.earnings_date BETWEEN
                CAST(t.entry_time AS DATE) - 30
                AND CAST(t.entry_time AS DATE) + 30
        GROUP BY t.trade_id
    """).fetchdf()
    df = df.merge(earnings, on="trade_id", how="left")

    # Intraday context (opening range, VWAP, momentum, bar volatility)
    print("  Intraday features from minute bars...")
    t1 = time.time()
    intraday = con.execute("""
        WITH trade_bars AS (
            SELECT t.trade_id, t.entry_price,
                b.bar_time, b.open AS bo, b.high AS bh,
                b.low AS bl, b.close AS bc,
                b.volume AS bv, b.vwap AS bvw,
                ROW_NUMBER() OVER (PARTITION BY t.trade_id ORDER BY b.bar_time DESC) AS rn
            FROM trades t
            JOIN bars b ON b.symbol = t.symbol
                AND CAST(b.bar_time AS DATE) = CAST(t.entry_time AS DATE)
                AND b.bar_time <= t.entry_time
        ),
        opening_range AS (
            SELECT symbol, CAST(bar_time AS DATE) AS td,
                MAX(high) - MIN(low) AS or_range,
                AVG((high+low)/2) AS or_mid
            FROM bars
            WHERE EXTRACT(HOUR FROM bar_time)*60+EXTRACT(MINUTE FROM bar_time) BETWEEN 570 AND 600
            GROUP BY symbol, CAST(bar_time AS DATE)
        ),
        agg AS (
            SELECT trade_id,
                SUM(bv * bvw) / NULLIF(SUM(bv), 0) AS cum_vwap,
                COUNT(*) AS bars_before_entry,
                -- Volume acceleration
                AVG(CASE WHEN rn BETWEEN 1 AND 5 THEN bv END) /
                    NULLIF(AVG(CASE WHEN rn BETWEEN 6 AND 15 THEN bv END), 0)
                    AS vol_acceleration,
                -- Bar volatility
                STDDEV(CASE WHEN rn BETWEEN 1 AND 10 THEN
                    (bc - bo) / NULLIF(bo, 0) * 100 END) AS bar_volatility
            FROM trade_bars GROUP BY trade_id
        ),
        mom AS (
            SELECT trade_id,
                LAST(bc ORDER BY bar_time) - FIRST(bc ORDER BY bar_time) AS m10
            FROM (SELECT trade_id, bar_time, bc, rn FROM trade_bars WHERE rn <= 10) s
            GROUP BY trade_id
        )
        SELECT t.trade_id,
            CASE WHEN a.cum_vwap IS NOT NULL
                THEN (t.entry_price - a.cum_vwap) / a.cum_vwap * 100 END AS vwap_position_pct,
            CASE WHEN o.or_mid > 0
                THEN o.or_range / o.or_mid * 100 END AS opening_range_pct,
            CASE WHEN t.entry_price > 0 AND m.m10 IS NOT NULL
                THEN m.m10 / t.entry_price * 100 END AS momentum_pct,
            a.bars_before_entry,
            a.vol_acceleration,
            a.bar_volatility
        FROM trades t
        LEFT JOIN agg a ON a.trade_id = t.trade_id
        LEFT JOIN opening_range o ON o.symbol = t.symbol
            AND o.td = CAST(t.entry_time AS DATE)
        LEFT JOIN mom m ON m.trade_id = t.trade_id
    """).fetchdf()
    df = df.merge(intraday, on="trade_id", how="left")
    print(f"    {time.time()-t1:.1f}s")

    # Financials
    print("  Financial fundamentals...")
    t2 = time.time()
    fin = con.execute("""
        WITH ranked AS (
            SELECT t.trade_id, f.eps_diluted,
                CASE WHEN f.revenues > 0 THEN f.operating_income/f.revenues*100 END AS op_margin,
                CASE WHEN f.revenues > 0 THEN f.net_income/f.revenues*100 END AS net_margin,
                f.revenues,
                ROW_NUMBER() OVER (PARTITION BY t.trade_id
                    ORDER BY CAST(f.filing_date AS DATE) DESC) AS rn
            FROM trades t JOIN financials f ON f.ticker = t.symbol
                AND CAST(f.filing_date AS DATE) < CAST(t.entry_time AS DATE)
                AND f.timeframe = 'quarterly' AND f.revenues IS NOT NULL
        ) SELECT trade_id, eps_diluted, op_margin, net_margin, revenues
        FROM ranked WHERE rn = 1
    """).fetchdf()
    df = df.merge(fin, on="trade_id", how="left")
    print(f"    {time.time()-t2:.1f}s")

    # Prior-day + multi-day patterns from daily bars
    print("  Prior-day + multi-day patterns...")
    t3 = time.time()
    daily = con.execute("""
        WITH dw AS (
            SELECT t.trade_id, d.bar_date, d.open, d.high, d.low, d.close, d.volume,
                ROW_NUMBER() OVER (PARTITION BY t.trade_id ORDER BY d.bar_date DESC) AS rn
            FROM trades t JOIN daily_bars d ON d.symbol = t.symbol
                AND d.bar_date < CAST(t.entry_time AS DATE)
                AND d.bar_date >= CAST(t.entry_time AS DATE) - 30
        )
        SELECT trade_id,
            -- Prior day features
            MAX(CASE WHEN rn=1 THEN CASE WHEN close>0 THEN (high-low)/close*100 END END) AS prior_day_range_pct,
            MAX(CASE WHEN rn=1 THEN volume END) /
                NULLIF(AVG(CASE WHEN rn BETWEEN 2 AND 21 THEN volume END),0) AS volume_ratio,
            MAX(CASE WHEN rn=1 THEN (close-open)/NULLIF(open,0)*100 END) AS prior_day_return_pct,
            MAX(CASE WHEN rn=1 THEN close END) AS prior_close,
            -- ATR contraction (d1 range / avg 20d range)
            MAX(CASE WHEN rn=1 THEN high-low END) /
                NULLIF(AVG(CASE WHEN rn BETWEEN 1 AND 20 THEN high-low END),0) AS atr_contraction,
            -- 3-day volume trend
            MAX(CASE WHEN rn=1 THEN volume END) /
                NULLIF(MAX(CASE WHEN rn=3 THEN volume END),0) AS vol_trend_3d,
            -- 5-day return
            (MAX(CASE WHEN rn=1 THEN close END) - MAX(CASE WHEN rn=5 THEN close END)) /
                NULLIF(MAX(CASE WHEN rn=5 THEN close END),0) * 100 AS return_5d_pct,
            -- 20-day range position
            (MAX(CASE WHEN rn=1 THEN close END) - MIN(CASE WHEN rn BETWEEN 1 AND 20 THEN low END)) /
                NULLIF(MAX(CASE WHEN rn BETWEEN 1 AND 20 THEN high END) -
                       MIN(CASE WHEN rn BETWEEN 1 AND 20 THEN low END), 0) * 100
                AS range_position_20d,
            -- Distance from 20d MA
            (MAX(CASE WHEN rn=1 THEN close END) -
                AVG(CASE WHEN rn BETWEEN 1 AND 20 THEN close END)) /
                NULLIF(AVG(CASE WHEN rn BETWEEN 1 AND 20 THEN close END), 0) * 100
                AS dist_from_ma20_pct,
            -- Inside day
            CASE WHEN MAX(CASE WHEN rn=1 THEN high END) <= MAX(CASE WHEN rn=2 THEN high END)
                AND MAX(CASE WHEN rn=1 THEN low END) >= MAX(CASE WHEN rn=2 THEN low END)
                THEN 1 ELSE 0 END AS inside_day,
            -- NR4
            CASE WHEN MAX(CASE WHEN rn=1 THEN high-low END) <
                    LEAST(
                        COALESCE(MAX(CASE WHEN rn=2 THEN high-low END), 1e9),
                        COALESCE(MAX(CASE WHEN rn=3 THEN high-low END), 1e9),
                        COALESCE(MAX(CASE WHEN rn=4 THEN high-low END), 1e9)
                    ) THEN 1 ELSE 0 END AS nr4
        FROM dw WHERE rn <= 21 GROUP BY trade_id
    """).fetchdf()
    df = df.merge(daily, on="trade_id", how="left")
    print(f"    {time.time()-t3:.1f}s")

    # Gap %
    df["gap_pct"] = np.where(
        df["prior_close"].notna() & (df["prior_close"] > 0),
        (df["entry_price"] - df["prior_close"]) / df["prior_close"] * 100, np.nan)

    # Relative strength vs QQQ
    print("  Relative strength vs QQQ...")
    t4 = time.time()
    qqq = con.execute("""
        SELECT bar_date,
            close,
            (close - LAG(close,5) OVER (ORDER BY bar_date)) /
                NULLIF(LAG(close,5) OVER (ORDER BY bar_date),0) * 100 AS qqq_ret_5d,
            (close - LAG(close,10) OVER (ORDER BY bar_date)) /
                NULLIF(LAG(close,10) OVER (ORDER BY bar_date),0) * 100 AS qqq_ret_10d
        FROM daily_bars WHERE symbol = 'QQQ' ORDER BY bar_date
    """).fetchdf()
    qqq["bar_date"] = pd.to_datetime(qqq["bar_date"])

    # Stock 5d/10d returns already in daily features
    stock_5d = con.execute("""
        WITH dw AS (
            SELECT t.trade_id,
                MAX(CASE WHEN rn=1 THEN bar_date END) AS prior_date,
                (MAX(CASE WHEN rn=1 THEN close END) - MAX(CASE WHEN rn=5 THEN close END)) /
                    NULLIF(MAX(CASE WHEN rn=5 THEN close END),0) * 100 AS stock_ret_5d,
                (MAX(CASE WHEN rn=1 THEN close END) - MAX(CASE WHEN rn=10 THEN close END)) /
                    NULLIF(MAX(CASE WHEN rn=10 THEN close END),0) * 100 AS stock_ret_10d
            FROM (
                SELECT t.trade_id, d.bar_date, d.close,
                    ROW_NUMBER() OVER (PARTITION BY t.trade_id ORDER BY d.bar_date DESC) AS rn
                FROM trades t JOIN daily_bars d ON d.symbol = t.symbol
                    AND d.bar_date < CAST(t.entry_time AS DATE)
                    AND d.bar_date >= CAST(t.entry_time AS DATE) - 20
            ) sub JOIN trades t ON t.trade_id = sub.trade_id
            WHERE rn <= 10 GROUP BY t.trade_id
        ) SELECT * FROM dw
    """).fetchdf()
    stock_5d["prior_date"] = pd.to_datetime(stock_5d["prior_date"])
    stock_5d = stock_5d.merge(qqq[["bar_date", "qqq_ret_5d", "qqq_ret_10d"]],
                               left_on="prior_date", right_on="bar_date", how="left")
    stock_5d["rs_5d"] = stock_5d["stock_ret_5d"] - stock_5d["qqq_ret_5d"]
    stock_5d["rs_10d"] = stock_5d["stock_ret_10d"] - stock_5d["qqq_ret_10d"]
    stock_5d["rs_5d_abs"] = stock_5d["rs_5d"].abs()
    stock_5d["rs_10d_abs"] = stock_5d["rs_10d"].abs()
    df = df.merge(stock_5d[["trade_id", "rs_5d", "rs_10d", "rs_5d_abs", "rs_10d_abs"]],
                  on="trade_id", how="left")
    print(f"    {time.time()-t4:.1f}s")

    # Encode categoricals
    df["is_short"] = (df["direction"].str.lower() == "short").astype(int)
    df["log_market_cap"] = np.log10(df["market_cap"].clip(lower=1e6))
    vol_map = {"low": 0, "normal": 1, "high": 2}
    df["vol_regime_ord"] = df["vol_regime"].map(vol_map)

    # Strategy encoding (top 10 strategies as binary dummies)
    top_strats = df["strategy"].value_counts().head(10).index.tolist()
    for s in top_strats:
        col = f"strat_{s.lower().replace(' ', '_')[:15]}"
        df[col] = (df["strategy"] == s).astype(int)

    print(f"  Total: {len(df):,} trades ({time.time()-t0:.1f}s)")
    return df, top_strats


def build_feature_matrix(df: pd.DataFrame, top_strats: list) -> tuple:
    """Build feature matrix for enhanced gradient boosting."""
    feature_cols = [
        # Original 21 from script 60
        "log_market_cap", "opening_range_pct", "eps_diluted",
        "vol_regime_ord", "prior_day_range_pct", "days_to_earnings",
        "atr_pct", "op_margin", "vwap_position_pct", "momentum_pct",
        "volume_ratio", "quarter", "vix", "yield_spread_10y2y",
        "is_short", "prior_day_return_pct", "gap_pct",
        "bars_before_entry", "hour", "dow", "net_margin",
        # New from script 61
        "atr_contraction", "vol_trend_3d", "return_5d_pct",
        "range_position_20d", "dist_from_ma20_pct", "inside_day", "nr4",
        # New from script 62
        "rs_5d", "rs_10d", "rs_5d_abs", "rs_10d_abs",
        # New from script 63
        "vol_acceleration", "bar_volatility", "minutes_since_open",
    ]
    # Add strategy dummies
    for s in top_strats:
        col = f"strat_{s.lower().replace(' ', '_')[:15]}"
        if col in df.columns:
            feature_cols.append(col)

    available = [c for c in feature_cols if c in df.columns]
    X = df[available].copy()
    y = df["win"].values
    pnl = df["holly_pnl"].values
    return X, y, pnl, available


def run_gbt(df, top_strats, label="Enhanced"):
    from sklearn.ensemble import HistGradientBoostingClassifier
    from sklearn.inspection import permutation_importance
    from sklearn.metrics import roc_auc_score, brier_score_loss

    X, y, pnl, feature_names = build_feature_matrix(df, top_strats)

    sort_idx = df["entry_time"].argsort()
    X = X.iloc[sort_idx].reset_index(drop=True)
    y = y[sort_idx]
    pnl = pnl[sort_idx]
    df_sorted = df.iloc[sort_idx].reset_index(drop=True)

    split_idx = int(len(X) * 0.6)
    X_train, X_test = X.iloc[:split_idx], X.iloc[split_idx:]
    y_train, y_test = y[:split_idx], y[split_idx:]
    pnl_test = pnl[split_idx:]

    print(f"\n{label}: Train={len(X_train):,} Test={len(X_test):,} Features={len(feature_names)}")

    model = HistGradientBoostingClassifier(
        max_iter=500,
        max_depth=5,
        learning_rate=0.03,
        min_samples_leaf=50,
        max_leaf_nodes=31,
        l2_regularization=2.0,
        early_stopping=True,
        n_iter_no_change=30,
        validation_fraction=0.15,
        random_state=42,
    )

    t0 = time.time()
    model.fit(X_train, y_train)
    train_time = time.time() - t0

    train_proba = model.predict_proba(X_train)[:, 1]
    test_proba = model.predict_proba(X_test)[:, 1]

    train_auc = roc_auc_score(y_train, train_proba)
    test_auc = roc_auc_score(y_test, test_proba)
    train_brier = brier_score_loss(y_train, train_proba)
    test_brier = brier_score_loss(y_test, test_proba)

    print(f"  n_iter={model.n_iter_}, time={train_time:.1f}s")
    print(f"  AUC: train={train_auc:.4f} test={test_auc:.4f}")

    # Permutation importance
    print("  Permutation importance...")
    perm = permutation_importance(model, X_test, y_test,
                                   n_repeats=10, random_state=42, n_jobs=-1)
    importance = pd.DataFrame({
        "feature": feature_names,
        "importance": perm.importances_mean,
        "std": perm.importances_std,
    }).sort_values("importance", ascending=False)

    # Decile analysis
    test_df = pd.DataFrame({
        "proba": test_proba, "win": y_test, "pnl": pnl_test,
    })
    test_df["pct"] = test_df["proba"].rank(pct=True).mul(100)
    test_df["decile"] = pd.qcut(test_df["pct"], 10, labels=False, duplicates="drop") + 1

    return {
        "model": model, "feature_names": feature_names,
        "importance": importance,
        "train_auc": train_auc, "test_auc": test_auc,
        "train_brier": train_brier, "test_brier": test_brier,
        "test_df": test_df, "test_proba": test_proba,
        "train_time": train_time, "n_iter": model.n_iter_,
        "df_sorted": df_sorted, "split_idx": split_idx,
        "label": label,
    }


def decile_lines(test_df):
    lines = []
    lines.append("| Decile | Prob Range | n | WR | Avg P&L | Cum P&L |")
    lines.append("|--------|-----------|---|----|---------|---------| ")
    cum = 0
    prev = None
    mono = 0
    for d in sorted(test_df["decile"].unique()):
        sub = test_df[test_df["decile"] == d]
        cum += sub["pnl"].sum()
        avg = sub["pnl"].mean()
        if prev is not None and avg > prev:
            mono += 1
        prev = avg
        lines.append(
            f"| D{d} | {sub['proba'].min():.2f}-{sub['proba'].max():.2f} "
            f"| {len(sub):,} | {sub['win'].mean()*100:.1f}% "
            f"| ${avg:.0f} | ${cum:,.0f} |")
    n_d = len(test_df["decile"].unique())
    lines.append(f"\n**Monotonicity:** {mono}/{n_d-1}")

    top = test_df[test_df["decile"] == test_df["decile"].max()]
    bot = test_df[test_df["decile"] == test_df["decile"].min()]
    t = welch_t_test(top["pnl"], bot["pnl"])
    if not np.isnan(t["cohens_d"]):
        lines.append(f"**Cohen's d (OOS):** {t['cohens_d']:.3f}")
    if not np.isnan(t["p_value"]):
        lines.append(f"**p-value:** {t['p_value']:.6f}")
    lines.append("")
    return lines, t["cohens_d"] if not np.isnan(t["cohens_d"]) else 0


def main():
    t0 = time.time()
    con = duckdb.connect(str(DUCKDB_PATH), read_only=True)
    print(f"Connected to {DUCKDB_PATH.name}")

    df, top_strats = load_all_features(con)
    con.close()

    # Run enhanced model
    enhanced = run_gbt(df, top_strats, "Enhanced GBT (35+ features)")

    # Run slim model (top features only based on script 60 importance)
    slim_strats = []  # no strategy dummies
    slim = run_gbt(df, slim_strats, "Slim GBT (no strategy dummies)")

    # ── Build report ──
    report = []
    report.append("# Enhanced Gradient Boosting Model")
    report.append("")
    report.append(f"Generated: {pd.Timestamp.now().strftime('%Y-%m-%d %H:%M')}")
    report.append(f"Trades: {len(df):,}")
    report.append("")

    # Comparison table
    report.append("## 1. Model Comparison")
    report.append("")
    report.append("| Metric | Script 60 GBT | Enhanced GBT | Slim GBT |")
    report.append("|--------|--------------|--------------|----------|")

    e_lines, e_d = decile_lines(enhanced["test_df"])
    s_lines, s_d = decile_lines(slim["test_df"])

    e_top = enhanced["test_df"][enhanced["test_df"]["decile"] == enhanced["test_df"]["decile"].max()]
    s_top = slim["test_df"][slim["test_df"]["decile"] == slim["test_df"]["decile"].max()]

    report.append(f"| Features | 21 | {len(enhanced['feature_names'])} | {len(slim['feature_names'])} |")
    report.append(f"| Train AUC | 0.8618 | {enhanced['train_auc']:.4f} | {slim['train_auc']:.4f} |")
    report.append(f"| Test AUC | 0.7202 | {enhanced['test_auc']:.4f} | {slim['test_auc']:.4f} |")
    report.append(f"| Overfit Gap | 0.1416 | {enhanced['train_auc']-enhanced['test_auc']:.4f} | {slim['train_auc']-slim['test_auc']:.4f} |")
    report.append(f"| OOS Cohen's d | 0.767 | {e_d:.3f} | {s_d:.3f} |")
    report.append(f"| OOS D10 WR | 81.0% | {e_top['win'].mean()*100:.1f}% | {s_top['win'].mean()*100:.1f}% |")
    report.append(f"| OOS D10 Avg P&L | $5,403 | ${e_top['pnl'].mean():.0f} | ${s_top['pnl'].mean():.0f} |")
    report.append(f"| Iterations | 300 | {enhanced['n_iter']} | {slim['n_iter']} |")
    report.append("")

    # Enhanced model details
    report.append("## 2. Enhanced GBT — Feature Importance")
    report.append("")
    report.append("| Rank | Feature | Importance | Std |")
    report.append("|------|---------|------------|-----|")
    for idx, (_, row) in enumerate(enhanced["importance"].head(25).iterrows()):
        report.append(f"| {idx+1} | {row['feature']} | {row['importance']:.4f} | ±{row['std']:.4f} |")
    report.append("")

    # Enhanced decile
    report.append("## 3. Enhanced GBT — OOS Decile Analysis")
    report.append("")
    report.extend(e_lines)

    # Slim decile
    report.append("## 4. Slim GBT — OOS Decile Analysis")
    report.append("")
    report.extend(s_lines)

    # Thresholds
    report.append("## 5. Actionable Thresholds (Enhanced GBT, OOS)")
    report.append("")
    tdf = enhanced["test_df"]
    for thresh in [90, 80, 70, 60, 50]:
        above = tdf[tdf["pct"] >= thresh]
        if len(above) > 0:
            report.append(
                f"- **Score >= {thresh}:** {len(above):,} trades "
                f"({len(above)/len(tdf)*100:.0f}%), "
                f"WR={above['win'].mean()*100:.1f}%, "
                f"Avg=${above['pnl'].mean():.0f}")
    total = tdf["pnl"].sum()
    top30 = tdf[tdf["pct"] >= 70]
    report.append(f"\n**Total OOS P&L:** ${total:,.0f}")
    if total > 0:
        report.append(f"**Top-30% P&L:** ${top30['pnl'].sum():,.0f} "
                      f"({top30['pnl'].sum()/total*100:.0f}%)")
    report.append("")

    # Strategy x score (enhanced)
    report.append("## 6. Strategy x Score (Enhanced, top 8)")
    report.append("")
    test_data = enhanced["df_sorted"].iloc[enhanced["split_idx"]:].copy()
    test_data["proba"] = enhanced["test_proba"]
    test_data["pct"] = test_data["proba"].rank(pct=True).mul(100)
    for strat in test_data["strategy"].value_counts().head(8).index:
        sdf = test_data[test_data["strategy"] == strat].copy()
        direction = sdf["direction"].mode().iloc[0] if len(sdf) > 0 else "?"
        try:
            sdf["tercile"] = pd.qcut(sdf["pct"], 3,
                labels=["Bottom", "Middle", "Top"], duplicates="drop")
        except ValueError:
            continue
        report.append(f"**{strat}** ({direction}, n={len(sdf):,})")
        report.append("")
        report.append("| Tercile | n | WR | Avg P&L |")
        report.append("|---------|---|----|---------| ")
        for t in ["Bottom", "Middle", "Top"]:
            sub = sdf[sdf["tercile"] == t]
            if len(sub) >= 5:
                report.append(f"| {t} | {len(sub):,} | {sub['win'].mean()*100:.1f}% | ${sub['holly_pnl'].mean():.0f} |")
        report.append("")

    # Write
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    path = REPORT_DIR / "enhanced-gbt-model.md"
    path.write_text("\n".join(report), encoding="utf-8")

    elapsed = time.time() - t0
    print(f"\nReport saved: {path}")
    print(f"Done in {elapsed:.1f}s")


if __name__ == "__main__":
    main()
