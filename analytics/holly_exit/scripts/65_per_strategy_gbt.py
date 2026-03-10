"""
65_per_strategy_gbt.py — Per-strategy GBT models.

Hypothesis: different Holly strategies have different feature profiles.
A single GBT may underweight strategy-specific signals.

Approach:
  1. Train separate GBT models for each strategy with 200+ trades
  2. Compare per-strategy OOS Cohen's d to the unified model
  3. Identify which features matter most for each strategy
  4. Test an ensemble: unified model + strategy-specific adjustment

Walk-forward: 60/40 chronological split per strategy.

Output: reports/per-strategy-gbt.md

Usage:
    python scripts/65_per_strategy_gbt.py
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


def load_features(con):
    """Load raw features (same as script 64 but simpler)."""
    print("Loading features...")
    t0 = time.time()

    df = con.execute("""
        SELECT
            t.trade_id, t.symbol, t.entry_time, t.entry_price,
            t.strategy, t.direction, t.holly_pnl, t.mfe, t.mae,
            CASE WHEN t.holly_pnl > 0 THEN 1 ELSE 0 END AS win,
            EXTRACT(QUARTER FROM t.entry_time) AS quarter,
            EXTRACT(DOW FROM t.entry_time) AS dow,
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

    # Intraday
    intra = con.execute("""
        WITH tb AS (
            SELECT t.trade_id, t.entry_price,
                b.bar_time, b.close AS bc, b.volume AS bv, b.vwap AS bvw,
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
                SUM(bv*bvw)/NULLIF(SUM(bv),0) AS cum_vwap,
                AVG(CASE WHEN rn BETWEEN 1 AND 5 THEN bv END) /
                    NULLIF(AVG(CASE WHEN rn BETWEEN 6 AND 15 THEN bv END),0) AS vol_acceleration
            FROM tb GROUP BY trade_id
        )
        SELECT t.trade_id,
            CASE WHEN a.cum_vwap IS NOT NULL THEN (t.entry_price-a.cum_vwap)/a.cum_vwap*100 END AS vwap_position_pct,
            CASE WHEN o.or_mid>0 THEN o.or_range/o.or_mid*100 END AS opening_range_pct,
            a.vol_acceleration
        FROM trades t
        LEFT JOIN agg a ON a.trade_id = t.trade_id
        LEFT JOIN orng o ON o.symbol = t.symbol AND o.td = CAST(t.entry_time AS DATE)
    """).fetchdf()
    df = df.merge(intra, on="trade_id", how="left")

    # Financials
    fin = con.execute("""
        WITH ranked AS (
            SELECT t.trade_id, f.eps_diluted,
                CASE WHEN f.revenues>0 THEN f.operating_income/f.revenues*100 END AS op_margin,
                ROW_NUMBER() OVER (PARTITION BY t.trade_id ORDER BY CAST(f.filing_date AS DATE) DESC) AS rn
            FROM trades t JOIN financials f ON f.ticker=t.symbol
                AND CAST(f.filing_date AS DATE)<CAST(t.entry_time AS DATE)
                AND f.timeframe='quarterly' AND f.revenues IS NOT NULL
        ) SELECT trade_id, eps_diluted, op_margin FROM ranked WHERE rn=1
    """).fetchdf()
    df = df.merge(fin, on="trade_id", how="left")

    # Daily bars features
    daily = con.execute("""
        WITH dw AS (
            SELECT t.trade_id, d.close, d.high, d.low, d.volume, d.open,
                ROW_NUMBER() OVER (PARTITION BY t.trade_id ORDER BY d.bar_date DESC) AS rn
            FROM trades t JOIN daily_bars d ON d.symbol=t.symbol
                AND d.bar_date<CAST(t.entry_time AS DATE)
                AND d.bar_date>=CAST(t.entry_time AS DATE)-25
        )
        SELECT trade_id,
            MAX(CASE WHEN rn=1 THEN CASE WHEN close>0 THEN (high-low)/close*100 END END) AS prior_day_range_pct,
            MAX(CASE WHEN rn=1 THEN volume END)/NULLIF(AVG(CASE WHEN rn BETWEEN 2 AND 21 THEN volume END),0) AS volume_ratio,
            MAX(CASE WHEN rn=1 THEN close END) AS prior_close,
            MAX(CASE WHEN rn=1 THEN high-low END)/NULLIF(AVG(CASE WHEN rn BETWEEN 1 AND 20 THEN high-low END),0) AS atr_contraction,
            (MAX(CASE WHEN rn=1 THEN close END)-AVG(CASE WHEN rn BETWEEN 1 AND 20 THEN close END))/
                NULLIF(AVG(CASE WHEN rn BETWEEN 1 AND 20 THEN close END),0)*100 AS dist_from_ma20_pct,
            (MAX(CASE WHEN rn=1 THEN close END)-MIN(CASE WHEN rn BETWEEN 1 AND 20 THEN low END))/
                NULLIF(MAX(CASE WHEN rn BETWEEN 1 AND 20 THEN high END)-MIN(CASE WHEN rn BETWEEN 1 AND 20 THEN low END),0)*100 AS range_position_20d
        FROM dw WHERE rn<=21 GROUP BY trade_id
    """).fetchdf()
    df = df.merge(daily, on="trade_id", how="left")

    df["gap_pct"] = np.where(df["prior_close"].notna() & (df["prior_close"]>0),
        (df["entry_price"]-df["prior_close"])/df["prior_close"]*100, np.nan)
    df["is_short"] = (df["direction"].str.lower()=="short").astype(int)
    df["log_market_cap"] = np.log10(df["market_cap"].clip(lower=1e6))
    df["vol_regime_ord"] = df["vol_regime"].map({"low":0,"normal":1,"high":2})

    print(f"  {len(df):,} trades ({time.time()-t0:.1f}s)")
    return df


FEATURE_COLS = [
    "log_market_cap", "opening_range_pct", "eps_diluted", "vol_regime_ord",
    "prior_day_range_pct", "days_to_earnings", "atr_pct", "op_margin",
    "vwap_position_pct", "volume_ratio", "quarter", "vix",
    "yield_spread_10y2y", "gap_pct", "minutes_since_open",
    "vol_acceleration", "atr_contraction", "dist_from_ma20_pct",
    "range_position_20d",
]


def train_strategy_model(sdf, strategy_name):
    """Train GBT for a single strategy."""
    from sklearn.ensemble import HistGradientBoostingClassifier
    from sklearn.metrics import roc_auc_score

    available = [c for c in FEATURE_COLS if c in sdf.columns]
    X = sdf[available].copy()
    y = sdf["win"].values
    pnl = sdf["holly_pnl"].values

    sort_idx = sdf["entry_time"].argsort()
    X = X.iloc[sort_idx].reset_index(drop=True)
    y = y[sort_idx]
    pnl = pnl[sort_idx]

    split = int(len(X) * 0.6)
    if split < 50 or (len(X) - split) < 30:
        return None

    X_tr, X_te = X.iloc[:split], X.iloc[split:]
    y_tr, y_te = y[:split], y[split:]
    pnl_te = pnl[split:]

    model = HistGradientBoostingClassifier(
        max_iter=200, max_depth=4, learning_rate=0.05,
        min_samples_leaf=20, l2_regularization=2.0,
        early_stopping=True, n_iter_no_change=15,
        validation_fraction=0.2, random_state=42,
    )

    try:
        model.fit(X_tr, y_tr)
    except Exception:
        return None

    te_proba = model.predict_proba(X_te)[:, 1]

    try:
        te_auc = roc_auc_score(y_te, te_proba)
    except ValueError:
        te_auc = 0.5

    # Tercile analysis
    te_df = pd.DataFrame({"proba": te_proba, "win": y_te, "pnl": pnl_te})
    te_df["pct"] = te_df["proba"].rank(pct=True).mul(100)

    try:
        te_df["tercile"] = pd.qcut(te_df["pct"], 3,
            labels=["Bottom", "Middle", "Top"], duplicates="drop")
    except ValueError:
        return None

    top = te_df[te_df["tercile"] == "Top"]
    bot = te_df[te_df["tercile"] == "Bottom"]
    t = welch_t_test(top["pnl"], bot["pnl"])

    # Feature importance (built-in, not permutation — faster)
    # HistGBT doesn't expose feature_importances_ easily, use permutation
    from sklearn.inspection import permutation_importance
    perm = permutation_importance(model, X_te, y_te, n_repeats=5, random_state=42, n_jobs=-1)
    top_features = pd.Series(perm.importances_mean, index=available).sort_values(ascending=False).head(5)

    return {
        "strategy": strategy_name,
        "n_train": split,
        "n_test": len(X) - split,
        "wr_train": y_tr.mean() * 100,
        "wr_test": y_te.mean() * 100,
        "auc": te_auc,
        "cohens_d": t["cohens_d"] if not np.isnan(t["cohens_d"]) else 0,
        "p_value": t["p_value"] if not np.isnan(t["p_value"]) else 1,
        "top_wr": top["win"].mean() * 100,
        "bot_wr": bot["win"].mean() * 100,
        "top_pnl": top["pnl"].mean(),
        "bot_pnl": bot["pnl"].mean(),
        "top_features": top_features.to_dict(),
        "n_iter": model.n_iter_,
    }


def main():
    t0 = time.time()
    con = duckdb.connect(str(DUCKDB_PATH), read_only=True)
    print(f"Connected to {DUCKDB_PATH.name}")

    df = load_features(con)
    con.close()

    # Get strategies with 200+ trades
    strat_counts = df["strategy"].value_counts()
    target_strats = strat_counts[strat_counts >= 200].index.tolist()
    print(f"\nStrategies with 200+ trades: {len(target_strats)}")

    results = []
    for strat in target_strats:
        sdf = df[df["strategy"] == strat].copy()
        direction = sdf["direction"].mode().iloc[0]
        print(f"  {strat} ({direction}, n={len(sdf):,})...", end=" ")
        r = train_strategy_model(sdf, strat)
        if r:
            r["direction"] = direction
            results.append(r)
            print(f"AUC={r['auc']:.3f} d={r['cohens_d']:.3f}")
        else:
            print("SKIP (insufficient data)")

    # Sort by Cohen's d
    results.sort(key=lambda x: x["cohens_d"], reverse=True)

    # ── Build report ──
    report = []
    report.append("# Per-Strategy GBT Models")
    report.append("")
    report.append(f"Generated: {pd.Timestamp.now().strftime('%Y-%m-%d %H:%M')}")
    report.append(f"Total trades: {len(df):,}")
    report.append(f"Strategies modeled: {len(results)}/{len(target_strats)}")
    report.append("")

    # Summary table
    report.append("## 1. Strategy Model Performance (OOS)")
    report.append("")
    report.append("| Strategy | Dir | n_test | AUC | Cohen's d | Top WR | Bot WR | Top P&L | Bot P&L |")
    report.append("|----------|-----|--------|-----|-----------|--------|--------|---------|---------|")
    for r in results:
        report.append(
            f"| {r['strategy']} | {r['direction'][:1]} "
            f"| {r['n_test']:,} | {r['auc']:.3f} | {r['cohens_d']:.3f} "
            f"| {r['top_wr']:.0f}% | {r['bot_wr']:.0f}% "
            f"| ${r['top_pnl']:.0f} | ${r['bot_pnl']:.0f} |")
    report.append("")

    # Which strategies benefit from per-strategy models
    report.append("## 2. Strategies Where Per-Strategy Model Helps Most")
    report.append("")
    good = [r for r in results if r["cohens_d"] > 0.3]
    if good:
        for r in good:
            report.append(f"- **{r['strategy']}** ({r['direction']}): d={r['cohens_d']:.3f}, "
                          f"AUC={r['auc']:.3f}, Top WR={r['top_wr']:.0f}%")
    else:
        report.append("*No strategies showed strong per-strategy model performance.*")
    report.append("")

    # Top features per strategy
    report.append("## 3. Top Features Per Strategy")
    report.append("")
    for r in results:
        if r["cohens_d"] > 0.1:
            report.append(f"**{r['strategy']}** ({r['direction']}, d={r['cohens_d']:.3f}):")
            for feat, imp in r["top_features"].items():
                if imp > 0.001:
                    report.append(f"  - {feat}: {imp:.4f}")
            report.append("")

    # Comparison to unified model
    report.append("## 4. Unified vs Per-Strategy Summary")
    report.append("")
    avg_d = np.mean([r["cohens_d"] for r in results])
    avg_auc = np.mean([r["auc"] for r in results])
    report.append(f"**Unified GBT (script 64):** OOS d=0.784, AUC=0.7234")
    report.append(f"**Average per-strategy model:** OOS d={avg_d:.3f}, AUC={avg_auc:.3f}")
    report.append("")
    if avg_d > 0.784:
        report.append("**VERDICT: Per-strategy models improve on average over unified**")
    else:
        report.append("**VERDICT: Unified model is generally better — per-strategy overfits on smaller samples**")
    report.append("")

    # Write
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    path = REPORT_DIR / "per-strategy-gbt.md"
    path.write_text("\n".join(report), encoding="utf-8")

    elapsed = time.time() - t0
    print(f"\nReport saved: {path}")
    print(f"Done in {elapsed:.1f}s")


if __name__ == "__main__":
    main()
