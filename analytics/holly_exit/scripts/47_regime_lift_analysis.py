"""
47_regime_lift_analysis.py — Lift analysis on trade_regime + daily context features.

Tests whether pre-trade technical regime (trend, volatility, momentum, RSI, ATR,
ROC, prior-day range) predicts Holly trade outcomes. Uses BH-FDR correction.

Features tested:
  Categorical: trend_regime, vol_regime, momentum_regime
  Continuous:  rsi14, atr_pct, daily_range_pct, roc5, roc20, trend_slope
  Derived:     gap_pct (entry vs prior close), prior_day_return

Output: reports/regime-lift-analysis.md

Usage:
    python scripts/47_regime_lift_analysis.py
    python scripts/47_regime_lift_analysis.py --since 2021-01-01
"""

import argparse
import sys
import time
from pathlib import Path

import duckdb
import numpy as np
import pandas as pd
from scipy import stats

sys.path.insert(0, str(Path(__file__).parent.parent))
from config.settings import DUCKDB_PATH, DATA_DIR

REPORT_DIR = DATA_DIR.parent / "output" / "reports"


def benjamini_hochberg(p_values: list[float]) -> list[float]:
    """BH-FDR correction. Returns adjusted p-values."""
    n = len(p_values)
    if n == 0:
        return []
    indexed = sorted(enumerate(p_values), key=lambda x: x[1])
    adjusted = [0.0] * n
    prev = 1.0
    for rank_minus_1 in range(n - 1, -1, -1):
        orig_idx, p = indexed[rank_minus_1]
        rank = rank_minus_1 + 1
        adj = min(prev, p * n / rank)
        adjusted[orig_idx] = adj
        prev = adj
    return adjusted


def welch_t_test(a: pd.Series, b: pd.Series) -> dict:
    """Welch's t-test with Cohen's d."""
    a, b = a.dropna(), b.dropna()
    if len(a) < 10 or len(b) < 10:
        return {"t_stat": np.nan, "p_value": np.nan, "cohens_d": np.nan,
                "n_a": len(a), "n_b": len(b)}
    t_stat, p_value = stats.ttest_ind(a, b, equal_var=False)
    pooled_std = np.sqrt((a.std()**2 + b.std()**2) / 2)
    cohens_d = (a.mean() - b.mean()) / pooled_std if pooled_std > 0 else 0
    return {"t_stat": t_stat, "p_value": p_value, "cohens_d": cohens_d,
            "n_a": len(a), "n_b": len(b), "mean_a": a.mean(), "mean_b": b.mean()}


def load_data(con: duckdb.DuckDBPyConnection, since: str) -> pd.DataFrame:
    """Load trades joined with regime + prior-day context."""
    print("Loading trades + regime + daily bars...")
    t0 = time.time()

    df = con.execute(f"""
        WITH trade_with_regime AS (
            SELECT
                t.trade_id, t.symbol, t.entry_time, t.entry_price,
                t.strategy, t.direction, t.holly_pnl, t.mfe, t.mae,
                t.stop_price, t.exit_price,
                r.trend_regime, r.vol_regime, r.momentum_regime,
                r.rsi14, r.atr_pct, r.daily_range_pct,
                r.roc5, r.roc20, r.trend_slope, r.above_sma20,
                CASE WHEN t.holly_pnl > 0 THEN 1 ELSE 0 END AS win,
                EXTRACT(HOUR FROM t.entry_time) AS entry_hour,
                CAST(t.entry_time AS DATE) AS trade_date
            FROM trades t
            JOIN trade_regime r ON r.trade_id = t.trade_id
            WHERE t.entry_time >= CAST('{since}' AS TIMESTAMP)
        ),
        with_prior_close AS (
            SELECT
                tw.*,
                -- Get prior trading day's close for gap calculation
                db.close AS prior_close,
                db.volume AS prior_volume,
                (db.high - db.low) / NULLIF(db.close, 0) AS prior_range_pct,
                (db.close - db.open) / NULLIF(db.open, 0) AS prior_day_return
            FROM trade_with_regime tw
            LEFT JOIN daily_bars db
              ON db.symbol = tw.symbol
             AND db.bar_date = (
                 SELECT MAX(bar_date) FROM daily_bars
                 WHERE symbol = tw.symbol AND bar_date < tw.trade_date
             )
        )
        SELECT *,
            (entry_price - prior_close) / NULLIF(prior_close, 0) AS gap_pct
        FROM with_prior_close
    """).fetchdf()

    print(f"  Loaded {len(df):,} trades with regime context ({time.time()-t0:.1f}s)")
    return df


def categorical_analysis(df: pd.DataFrame, col: str, label: str) -> tuple[list[str], list[float]]:
    """Analyze a categorical regime feature. Returns (report_lines, p_values)."""
    lines = []
    p_values = []

    lines.append(f"### {label} (`{col}`)")
    lines.append("")

    categories = df[col].value_counts()
    lines.append(f"| {label} | n | WR | Avg P&L | Avg MFE | Avg MAE |")
    lines.append(f"|{'---'*1}|---|----|---------|---------|---------| ")

    for cat in categories.index:
        sub = df[df[col] == cat]
        lines.append(
            f"| {cat} | {len(sub):,} | {sub['win'].mean()*100:.1f}% "
            f"| ${sub['holly_pnl'].mean():.0f} "
            f"| ${sub['mfe'].mean():.0f} | ${sub['mae'].mean():.0f} |"
        )

    lines.append("")

    # Pairwise t-tests: each category vs rest
    lines.append(f"**Pairwise tests (category vs rest):**")
    lines.append("")
    for cat in categories.index:
        this = df[df[col] == cat]["holly_pnl"]
        rest = df[df[col] != cat]["holly_pnl"]
        test = welch_t_test(this, rest)
        if not np.isnan(test["p_value"]):
            p_values.append(test["p_value"])
            lines.append(
                f"- **{cat}** vs rest: p={test['p_value']:.4f}, "
                f"d={test['cohens_d']:.3f}, "
                f"${test['mean_a']:.0f} vs ${test['mean_b']:.0f}"
            )
        else:
            p_values.append(1.0)
            lines.append(f"- **{cat}** vs rest: insufficient data (n={test['n_a']})")

    lines.append("")
    return lines, p_values


def continuous_analysis(df: pd.DataFrame) -> tuple[list[str], list[float]]:
    """Analyze continuous regime features via median split + correlation."""
    lines = []
    p_values = []

    features = [
        ("rsi14", "RSI(14)", "Higher RSI = more overbought at entry"),
        ("atr_pct", "ATR % (14d)", "Higher = more volatile stock"),
        ("daily_range_pct", "Prior Day Range %", "Higher = wider daily candle"),
        ("roc5", "ROC(5)", "5-day rate of change"),
        ("roc20", "ROC(20)", "20-day rate of change"),
        ("trend_slope", "Trend Slope (SMA20)", "Positive = uptrending"),
        ("gap_pct", "Gap %", "Entry vs prior close"),
        ("prior_day_return", "Prior Day Return", "Yesterday's candle direction"),
        ("prior_range_pct", "Prior Day Range (H-L)/C", "Yesterday's volatility"),
    ]

    lines.append("### Continuous Features (Median Split)")
    lines.append("")
    lines.append("| # | Feature | n(high) | n(low) | WR(high) | WR(low) | PnL(high) | PnL(low) | p-raw | Cohen's d | Corr(PnL) |")
    lines.append("|---|---------|---------|--------|----------|---------|-----------|----------|-------|-----------|-----------|")

    for i, (col, label, desc) in enumerate(features):
        valid = df[df[col].notna() & np.isfinite(df[col])]
        if len(valid) < 50:
            lines.append(f"| {i+1} | {label} | — | — | — | — | — | — | — | — | — |")
            p_values.append(1.0)
            continue

        median = valid[col].median()
        high = valid[valid[col] >= median]
        low = valid[valid[col] < median]

        test = welch_t_test(high["holly_pnl"], low["holly_pnl"])

        # Spearman correlation with PnL
        corr, corr_p = stats.spearmanr(valid[col], valid["holly_pnl"])

        p_values.append(test["p_value"] if not np.isnan(test["p_value"]) else 1.0)

        wr_h = f"{high['win'].mean()*100:.1f}%"
        wr_l = f"{low['win'].mean()*100:.1f}%"
        p_raw = f"{test['p_value']:.4f}" if not np.isnan(test["p_value"]) else "—"
        cd = f"{test['cohens_d']:.3f}" if not np.isnan(test.get("cohens_d", np.nan)) else "—"

        lines.append(
            f"| {i+1} | {label} | {len(high):,} | {len(low):,} "
            f"| {wr_h} | {wr_l} "
            f"| ${high['holly_pnl'].mean():.0f} | ${low['holly_pnl'].mean():.0f} "
            f"| {p_raw} | {cd} | {corr:.3f} (p={corr_p:.4f}) |"
        )

    lines.append("")
    return lines, p_values


def strategy_interaction(df: pd.DataFrame) -> list[str]:
    """Check if regime effect varies by strategy (top 5)."""
    lines = []
    lines.append("### Strategy x Regime Interaction (top 5 strategies)")
    lines.append("")

    top_strats = df["strategy"].value_counts().head(5).index.tolist()

    for strat in top_strats:
        sdf = df[df["strategy"] == strat]
        lines.append(f"**{strat}** (n={len(sdf):,})")
        lines.append("")
        lines.append("| Regime | n | WR | Avg P&L |")
        lines.append("|--------|---|----|---------| ")

        for regime in ["uptrend", "sideways", "downtrend"]:
            sub = sdf[sdf["trend_regime"] == regime]
            if len(sub) >= 10:
                lines.append(
                    f"| {regime} | {len(sub):,} | {sub['win'].mean()*100:.1f}% "
                    f"| ${sub['holly_pnl'].mean():.0f} |"
                )
        lines.append("")

    return lines


def direction_regime(df: pd.DataFrame) -> list[str]:
    """Long vs short performance by regime."""
    lines = []
    lines.append("### Direction x Regime")
    lines.append("")
    lines.append("| Direction | Regime | n | WR | Avg P&L | Avg MFE |")
    lines.append("|-----------|--------|---|----|---------|---------| ")

    for direction in ["long", "short"]:
        ddf = df[df["direction"] == direction]
        for regime in ["uptrend", "sideways", "downtrend"]:
            sub = ddf[ddf["trend_regime"] == regime]
            if len(sub) >= 20:
                lines.append(
                    f"| {direction} | {regime} | {len(sub):,} "
                    f"| {sub['win'].mean()*100:.1f}% "
                    f"| ${sub['holly_pnl'].mean():.0f} "
                    f"| ${sub['mfe'].mean():.0f} |"
                )
    lines.append("")
    return lines


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--since", default="2016-01-01",
                        help="Earliest trade date (default: all)")
    args = parser.parse_args()

    t0 = time.time()
    con = duckdb.connect(str(DUCKDB_PATH), read_only=True)
    print(f"Connected to {DUCKDB_PATH.name}")

    df = load_data(con, args.since)

    if len(df) == 0:
        print("No data found!")
        sys.exit(1)

    # Collect all p-values for FDR
    all_p_values = []
    all_labels = []

    # Build report
    report = []
    report.append("# Regime & Prior-Day Context Lift Analysis")
    report.append("")
    report.append(f"Generated: {pd.Timestamp.now().strftime('%Y-%m-%d %H:%M')}")
    report.append(f"Trades: {len(df):,} (since {args.since})")
    report.append(f"Date range: {df['trade_date'].min()} to {df['trade_date'].max()}")
    report.append("")
    report.append("---")
    report.append("")

    # Section 1: Categorical regimes
    report.append("## 1. Categorical Regime Features")
    report.append("")

    for col, label in [
        ("trend_regime", "Trend Regime"),
        ("vol_regime", "Volatility Regime"),
        ("momentum_regime", "Momentum Regime"),
    ]:
        cat_lines, cat_p = categorical_analysis(df, col, label)
        report.extend(cat_lines)
        all_p_values.extend(cat_p)
        all_labels.extend([f"{col}:{v}" for v in df[col].value_counts().index])

    # Section 2: Continuous features
    report.append("## 2. Continuous Features")
    report.append("")
    cont_lines, cont_p = continuous_analysis(df)
    report.extend(cont_lines)
    all_p_values.extend(cont_p)
    all_labels.extend([
        "rsi14", "atr_pct", "daily_range_pct", "roc5", "roc20",
        "trend_slope", "gap_pct", "prior_day_return", "prior_range_pct"
    ])

    # Section 3: Direction x Regime
    report.append("## 3. Direction x Regime Interaction")
    report.append("")
    report.extend(direction_regime(df))

    # Section 4: Strategy x Regime
    report.append("## 4. Strategy x Regime Interaction")
    report.append("")
    report.extend(strategy_interaction(df))

    # Section 5: FDR summary
    report.append("## 5. FDR-Corrected Summary (All Tests)")
    report.append("")

    adjusted = benjamini_hochberg(all_p_values)
    sig_results = []
    for label, p_raw, p_adj in sorted(
        zip(all_labels, all_p_values, adjusted), key=lambda x: x[2]
    ):
        if p_adj < 0.10:
            sig_results.append((label, p_raw, p_adj))

    if sig_results:
        report.append(f"**{len(sig_results)} test(s) significant at FDR < 0.10:**")
        report.append("")
        report.append("| Feature | p-raw | p-adj (BH) | Verdict |")
        report.append("|---------|-------|-----------|---------|")
        for label, p_raw, p_adj in sig_results:
            verdict = "SIGNIFICANT" if p_adj < 0.05 else "marginal"
            report.append(f"| {label} | {p_raw:.4f} | {p_adj:.4f} | **{verdict}** |")
        report.append("")
    else:
        report.append("**No tests pass FDR < 0.10 threshold.**")
        report.append("")

    total_tests = len(all_p_values)
    report.append(f"Total tests conducted: {total_tests}")
    report.append(f"FDR threshold: 0.05 (strict), 0.10 (marginal)")
    report.append("")

    # Write report
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    report_path = REPORT_DIR / "regime-lift-analysis.md"
    report_path.write_text("\n".join(report), encoding="utf-8")

    elapsed = time.time() - t0
    print(f"\nReport saved: {report_path}")
    print(f"  Total tests: {total_tests}")
    print(f"  Significant (FDR<0.05): {sum(1 for _,_,p in sig_results if p < 0.05)}")
    print(f"  Marginal (FDR<0.10): {sum(1 for _,_,p in sig_results if 0.05 <= p < 0.10)}")
    print(f"Done in {elapsed:.1f}s")
    con.close()


if __name__ == "__main__":
    main()
