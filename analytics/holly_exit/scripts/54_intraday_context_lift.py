"""
54_intraday_context_lift.py — Intraday context from minute bars.

Uses 56.5M minute bars to compute per-trade intraday context features:
  1. VWAP position at entry (above/below/at VWAP)
  2. Gap % from prior close
  3. Opening range (first 30 min high-low as % of price)
  4. Pre-entry relative volume (volume vs session avg up to that point)
  5. Pre-entry momentum (price change in 10 bars before entry)

Tests each feature for lift via FDR-corrected Welch t-test.

Output: reports/intraday-context-lift.md

Usage:
    python scripts/54_intraday_context_lift.py
"""

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


def welch_t_test(a: pd.Series, b: pd.Series) -> dict:
    a, b = a.dropna(), b.dropna()
    if len(a) < 10 or len(b) < 10:
        return {"t_stat": np.nan, "p_value": np.nan, "cohens_d": np.nan,
                "n_a": len(a), "n_b": len(b)}
    t_stat, p_value = stats.ttest_ind(a, b, equal_var=False)
    pooled_std = np.sqrt((a.std()**2 + b.std()**2) / 2)
    cohens_d = (a.mean() - b.mean()) / pooled_std if pooled_std > 0 else 0
    return {"t_stat": t_stat, "p_value": p_value, "cohens_d": cohens_d,
            "n_a": len(a), "n_b": len(b), "mean_a": a.mean(), "mean_b": b.mean()}


def compute_intraday_features(con: duckdb.DuckDBPyConnection) -> pd.DataFrame:
    """Compute intraday context features for each trade using minute bars."""
    print("Loading trades...")
    t0 = time.time()

    trades = con.execute("""
        SELECT
            trade_id, symbol, entry_time, entry_price,
            strategy, direction, holly_pnl, mfe, mae,
            CASE WHEN holly_pnl > 0 THEN 1 ELSE 0 END AS win,
            CAST(entry_time AS DATE) AS trade_date,
            EXTRACT(HOUR FROM entry_time) AS entry_hour,
            EXTRACT(MINUTE FROM entry_time) AS entry_minute
        FROM trades
    """).fetchdf()

    print(f"  {len(trades):,} trades loaded ({time.time()-t0:.1f}s)")

    # Process in batches by trade_date to avoid massive joins
    print("Computing intraday features from minute bars...")
    t1 = time.time()

    # Collect all unique (symbol, date) pairs
    trade_keys = trades[["symbol", "trade_date"]].drop_duplicates()
    print(f"  {len(trade_keys):,} unique (symbol, date) pairs")

    # Compute features via SQL — much faster than Python loops
    # Feature 1: VWAP position at entry
    # Feature 2: Gap % from prior close
    # Feature 3: Opening range (first 30 min)
    # Feature 4: Pre-entry relative volume
    # Feature 5: Pre-entry momentum

    features_df = con.execute("""
        WITH trade_bars AS (
            SELECT
                t.trade_id,
                t.symbol,
                t.entry_time,
                t.entry_price,
                CAST(t.entry_time AS DATE) AS trade_date,
                b.bar_time,
                b.open AS bar_open,
                b.high AS bar_high,
                b.low AS bar_low,
                b.close AS bar_close,
                b.volume AS bar_volume,
                b.vwap AS bar_vwap
            FROM trades t
            JOIN bars b ON b.symbol = t.symbol
                AND CAST(b.bar_time AS DATE) = CAST(t.entry_time AS DATE)
                AND b.bar_time <= t.entry_time
        ),
        session_open AS (
            SELECT
                symbol,
                CAST(bar_time AS DATE) AS trade_date,
                FIRST(open ORDER BY bar_time) AS session_open_price
            FROM bars
            GROUP BY symbol, CAST(bar_time AS DATE)
        ),
        prior_close AS (
            SELECT
                t.trade_id,
                (SELECT b2.close FROM bars b2
                 WHERE b2.symbol = t.symbol
                 AND CAST(b2.bar_time AS DATE) < CAST(t.entry_time AS DATE)
                 ORDER BY b2.bar_time DESC LIMIT 1
                ) AS prior_close_price
            FROM trades t
        ),
        opening_range AS (
            SELECT
                symbol,
                CAST(bar_time AS DATE) AS trade_date,
                MAX(high) - MIN(low) AS or_range,
                MAX(high) AS or_high,
                MIN(low) AS or_low,
                AVG((high + low) / 2) AS or_mid
            FROM bars
            WHERE EXTRACT(HOUR FROM bar_time) * 60 + EXTRACT(MINUTE FROM bar_time)
                BETWEEN 570 AND 600
            GROUP BY symbol, CAST(bar_time AS DATE)
        ),
        pre_entry_stats AS (
            SELECT
                trade_id,
                SUM(bar_volume * bar_vwap) / NULLIF(SUM(bar_volume), 0) AS cum_vwap,
                SUM(bar_volume) AS cum_volume,
                COUNT(*) AS bars_before_entry
            FROM trade_bars
            GROUP BY trade_id
        ),
        momentum AS (
            SELECT
                trade_id,
                LAST(bar_close ORDER BY bar_time) - FIRST(bar_close ORDER BY bar_time) AS momentum_10
            FROM (
                SELECT trade_id, bar_time, bar_close,
                    ROW_NUMBER() OVER (PARTITION BY trade_id ORDER BY bar_time DESC) AS rn
                FROM trade_bars
            ) sub
            WHERE rn <= 10
            GROUP BY trade_id
        )
        SELECT
            t.trade_id,
            CASE
                WHEN ps.cum_vwap IS NOT NULL
                THEN (t.entry_price - ps.cum_vwap) / ps.cum_vwap * 100
                ELSE NULL
            END AS vwap_position_pct,
            CASE
                WHEN pc.prior_close_price IS NOT NULL AND pc.prior_close_price > 0
                THEN (so.session_open_price - pc.prior_close_price) / pc.prior_close_price * 100
                ELSE NULL
            END AS gap_pct,
            CASE
                WHEN orng.or_mid IS NOT NULL AND orng.or_mid > 0
                THEN orng.or_range / orng.or_mid * 100
                ELSE NULL
            END AS opening_range_pct,
            CASE
                WHEN orng.or_high IS NOT NULL AND t.entry_price > orng.or_high THEN 'above_or'
                WHEN orng.or_low IS NOT NULL AND t.entry_price < orng.or_low THEN 'below_or'
                ELSE 'within_or'
            END AS or_position,
            ps.cum_volume,
            ps.bars_before_entry,
            CASE
                WHEN t.entry_price > 0
                THEN m.momentum_10 / t.entry_price * 100
                ELSE NULL
            END AS momentum_pct
        FROM trades t
        LEFT JOIN pre_entry_stats ps ON ps.trade_id = t.trade_id
        LEFT JOIN prior_close pc ON pc.trade_id = t.trade_id
        LEFT JOIN session_open so ON so.symbol = t.symbol
            AND so.trade_date = CAST(t.entry_time AS DATE)
        LEFT JOIN opening_range orng ON orng.symbol = t.symbol
            AND orng.trade_date = CAST(t.entry_time AS DATE)
        LEFT JOIN momentum m ON m.trade_id = t.trade_id
    """).fetchdf()

    elapsed = time.time() - t1
    print(f"  Features computed for {len(features_df):,} trades ({elapsed:.1f}s)")

    # Merge with trades
    df = trades.merge(features_df, on="trade_id", how="left")

    # Add derived features
    # VWAP bucket
    df["vwap_bucket"] = pd.cut(
        df["vwap_position_pct"],
        bins=[-np.inf, -1, -0.2, 0.2, 1, np.inf],
        labels=["well_below", "below", "at_vwap", "above", "well_above"]
    )

    # Gap bucket
    df["gap_bucket"] = pd.cut(
        df["gap_pct"],
        bins=[-np.inf, -3, -1, 0, 1, 3, np.inf],
        labels=["big_gap_down", "gap_down", "flat_down", "flat_up", "gap_up", "big_gap_up"]
    )

    # Opening range bucket (as % of price)
    df["or_bucket"] = pd.cut(
        df["opening_range_pct"],
        bins=[0, 1, 2, 4, np.inf],
        labels=["tight", "normal", "wide", "very_wide"]
    )

    # Momentum bucket
    df["momentum_bucket"] = pd.cut(
        df["momentum_pct"],
        bins=[-np.inf, -0.5, -0.1, 0.1, 0.5, np.inf],
        labels=["strong_down", "drift_down", "flat", "drift_up", "strong_up"]
    )

    # Coverage stats
    for col in ["vwap_position_pct", "gap_pct", "opening_range_pct", "momentum_pct"]:
        valid = df[col].notna().sum()
        print(f"  {col}: {valid:,} / {len(df):,} ({valid/len(df)*100:.1f}%)")

    return df


def bucket_analysis(df: pd.DataFrame, col: str, label: str) -> tuple[list[str], list[dict]]:
    """Analyze P&L by bucket. Returns (report_lines, test_results)."""
    lines = []
    tests = []

    valid = df[df[col].notna()]
    if len(valid) < 100:
        lines.append(f"*Insufficient data for {label}*")
        return lines, tests

    lines.append(f"### {label}")
    lines.append("")
    lines.append("| Bucket | n | WR | Avg P&L | Avg MFE | Avg MAE |")
    lines.append("|--------|---|----|---------|---------|---------| ")

    overall_mean = valid["holly_pnl"].mean()

    for bucket in sorted(valid[col].unique()):
        sub = valid[valid[col] == bucket]
        if len(sub) >= 10:
            lines.append(
                f"| {bucket} | {len(sub):,} | {sub['win'].mean()*100:.1f}% "
                f"| ${sub['holly_pnl'].mean():.0f} "
                f"| ${sub['mfe'].mean():.0f} "
                f"| ${sub['mae'].mean():.0f} |"
            )

            rest = valid[valid[col] != bucket]
            if len(rest) >= 10:
                t = welch_t_test(sub["holly_pnl"], rest["holly_pnl"])
                tests.append({
                    "feature": f"{col}:{bucket}",
                    "p_raw": t["p_value"],
                    "n": len(sub),
                    "pnl": sub["holly_pnl"].mean(),
                    "pnl_rest": rest["holly_pnl"].mean(),
                    "cohens_d": t["cohens_d"]
                })

    lines.append("")
    return lines, tests


def continuous_analysis(df: pd.DataFrame, col: str, label: str) -> tuple[list[str], list[dict]]:
    """Analyze continuous feature via median split."""
    lines = []
    tests = []

    valid = df[df[col].notna()]
    if len(valid) < 100:
        return lines, tests

    median = valid[col].median()
    high = valid[valid[col] >= median]
    low = valid[valid[col] < median]

    t = welch_t_test(high["holly_pnl"], low["holly_pnl"])
    corr = valid[["holly_pnl", col]].corr().iloc[0, 1]

    tests.append({
        "feature": col,
        "p_raw": t["p_value"],
        "n": len(valid),
        "cohens_d": t["cohens_d"],
        "corr": corr
    })

    lines.append(
        f"| {label} (med={median:.2f}) "
        f"| {len(high):,} | {len(low):,} "
        f"| {high['win'].mean()*100:.1f}% | {low['win'].mean()*100:.1f}% "
        f"| ${high['holly_pnl'].mean():.0f} | ${low['holly_pnl'].mean():.0f} "
        f"| {t['p_value']:.4f} | {t['cohens_d']:.3f} "
        f"| {corr:.3f} |"
    )

    return lines, tests


def strategy_interaction(df: pd.DataFrame, feature_col: str, feature_label: str) -> list[str]:
    """Analyze strategy x feature interaction."""
    lines = []
    top_strats = df["strategy"].value_counts().head(5).index.tolist()

    for strat in top_strats:
        sdf = df[(df["strategy"] == strat) & df[feature_col].notna()]
        if len(sdf) < 30:
            continue

        lines.append(f"**{strat}** (n={len(sdf):,})")
        lines.append("")
        lines.append(f"| {feature_label} | n | WR | Avg P&L |")
        lines.append("|-------------|---|----|---------| ")

        for bucket in sorted(sdf[feature_col].unique()):
            sub = sdf[sdf[feature_col] == bucket]
            if len(sub) >= 5:
                lines.append(
                    f"| {bucket} | {len(sub):,} | {sub['win'].mean()*100:.1f}% "
                    f"| ${sub['holly_pnl'].mean():.0f} |"
                )
        lines.append("")

    return lines


def fdr_correction(tests: list[dict], alpha: float = 0.10) -> list[str]:
    """Benjamini-Hochberg FDR correction."""
    lines = []

    valid = [t for t in tests if not np.isnan(t.get("p_raw", np.nan))]
    if not valid:
        return lines

    valid.sort(key=lambda x: x["p_raw"])
    m = len(valid)
    for i, t in enumerate(valid):
        t["p_adj"] = min(t["p_raw"] * m / (i + 1), 1.0)

    # Enforce monotonicity
    for i in range(m - 2, -1, -1):
        valid[i]["p_adj"] = min(valid[i]["p_adj"], valid[i + 1]["p_adj"])

    sig = [t for t in valid if t["p_adj"] < alpha]
    lines.append(f"**{len(sig)} test(s) significant at FDR < {alpha}:**")
    lines.append("")
    lines.append("| Feature | p-raw | p-adj (BH) | Verdict |")
    lines.append("|---------|-------|-----------|---------| ")

    for t in valid:
        if t["p_adj"] < 0.05:
            verdict = "**SIGNIFICANT**"
        elif t["p_adj"] < alpha:
            verdict = "**marginal**"
        else:
            continue
        lines.append(
            f"| {t['feature']} | {t['p_raw']:.4f} | {t['p_adj']:.4f} | {verdict} |"
        )

    lines.append("")
    lines.append(f"Total tests conducted: {m}")
    return lines


def main():
    t0 = time.time()
    con = duckdb.connect(str(DUCKDB_PATH), read_only=True)
    print(f"Connected to {DUCKDB_PATH.name}")

    df = compute_intraday_features(con)
    con.close()

    if len(df) == 0:
        print("No data!")
        sys.exit(1)

    all_tests = []
    report = []
    report.append("# Intraday Context Lift Analysis (Minute Bars)")
    report.append("")
    report.append(f"Generated: {pd.Timestamp.now().strftime('%Y-%m-%d %H:%M')}")
    report.append(f"Trades: {len(df):,}")
    report.append(f"Bars coverage: {df['vwap_position_pct'].notna().sum():,} "
                  f"({df['vwap_position_pct'].notna().mean()*100:.1f}%)")
    report.append("")
    report.append("---")
    report.append("")

    # Section 1: VWAP Position
    report.append("## 1. VWAP Position at Entry")
    report.append("")
    lines, tests = bucket_analysis(df, "vwap_bucket", "VWAP Position")
    report.extend(lines)
    all_tests.extend(tests)

    # Section 2: Gap %
    report.append("## 2. Gap from Prior Close")
    report.append("")
    lines, tests = bucket_analysis(df, "gap_bucket", "Gap Bucket")
    report.extend(lines)
    all_tests.extend(tests)

    # Section 3: Opening Range
    report.append("## 3. Opening Range (First 30 Min)")
    report.append("")
    lines, tests = bucket_analysis(df, "or_bucket", "Opening Range")
    report.extend(lines)
    all_tests.extend(tests)

    # Entry vs OR position
    lines, tests = bucket_analysis(df, "or_position", "Entry vs Opening Range")
    report.extend(lines)
    all_tests.extend(tests)

    # Section 4: Pre-Entry Momentum
    report.append("## 4. Pre-Entry Momentum (Last 10 Bars)")
    report.append("")
    lines, tests = bucket_analysis(df, "momentum_bucket", "Momentum")
    report.extend(lines)
    all_tests.extend(tests)

    # Section 5: Continuous features
    report.append("## 5. Continuous Features (Median Split)")
    report.append("")
    report.append("| Feature | n(high) | n(low) | WR(high) | WR(low) | PnL(high) | PnL(low) | p-raw | Cohen's d | Corr |")
    report.append("|---------|---------|--------|----------|---------|-----------|----------|-------|-----------|----- |")

    for col, label in [
        ("vwap_position_pct", "VWAP Position %"),
        ("gap_pct", "Gap %"),
        ("opening_range_pct", "Opening Range %"),
        ("momentum_pct", "Momentum %"),
    ]:
        lines, tests = continuous_analysis(df, col, label)
        report.extend(lines)
        all_tests.extend(tests)

    report.append("")

    # Section 6: Strategy x VWAP interaction
    report.append("## 6. Strategy x VWAP Position")
    report.append("")
    report.extend(strategy_interaction(df, "vwap_bucket", "VWAP"))

    # Section 7: Strategy x Gap interaction
    report.append("## 7. Strategy x Gap")
    report.append("")
    report.extend(strategy_interaction(df, "gap_bucket", "Gap"))

    # Section 8: FDR correction
    report.append("## 8. FDR-Corrected Summary")
    report.append("")
    report.extend(fdr_correction(all_tests))
    report.append("")

    # Write
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    report_path = REPORT_DIR / "intraday-context-lift.md"
    report_path.write_text("\n".join(report), encoding="utf-8")

    elapsed = time.time() - t0
    print(f"\nReport saved: {report_path}")
    print(f"Done in {elapsed:.1f}s")


if __name__ == "__main__":
    main()
