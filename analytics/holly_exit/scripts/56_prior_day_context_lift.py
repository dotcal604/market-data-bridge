"""
56_prior_day_context_lift.py — Prior-day context from daily bars.

Uses 8.1M daily bars to compute setup conditions for each trade:
  1. Prior day range as % of price (tight/wide setup)
  2. Prior day return (continuation vs reversal)
  3. Prior day volume vs 20-day average (volume surge detection)
  4. 5-day return (short-term trend)
  5. 20-day return (medium-term trend)
  6. Distance from 20-day high/low (range position)
  7. Prior day close vs 20-day moving average (trend alignment)

Output: reports/prior-day-context-lift.md

Usage:
    python scripts/56_prior_day_context_lift.py
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
            "n_a": len(a), "n_b": len(b)}


def compute_features(con: duckdb.DuckDBPyConnection) -> pd.DataFrame:
    """Compute prior-day context features from daily bars."""
    print("Loading trades...")
    t0 = time.time()

    trades = con.execute("""
        SELECT
            trade_id, symbol, entry_time, entry_price,
            strategy, direction, holly_pnl, mfe, mae,
            CASE WHEN holly_pnl > 0 THEN 1 ELSE 0 END AS win,
            CAST(entry_time AS DATE) AS trade_date
        FROM trades
    """).fetchdf()
    print(f"  {len(trades):,} trades")

    print("  Computing prior-day features from daily bars...")
    t1 = time.time()

    features = con.execute("""
        WITH ranked_bars AS (
            -- Get the most recent 21 daily bars before each trade date
            SELECT
                t.trade_id,
                d.bar_date,
                d.open, d.high, d.low, d.close, d.volume,
                ROW_NUMBER() OVER (
                    PARTITION BY t.trade_id
                    ORDER BY d.bar_date DESC
                ) AS rn
            FROM trades t
            JOIN daily_bars d ON d.symbol = t.symbol
                AND d.bar_date < CAST(t.entry_time AS DATE)
            -- Optimize: only look back ~30 calendar days
            WHERE d.bar_date >= CAST(t.entry_time AS DATE) - INTERVAL '45 days'
        ),
        prior_day AS (
            SELECT trade_id, open, high, low, close, volume,
                   (high - low) / NULLIF((high + low) / 2, 0) * 100 AS range_pct,
                   (close - open) / NULLIF(open, 0) * 100 AS return_pct
            FROM ranked_bars WHERE rn = 1
        ),
        day_5 AS (
            SELECT trade_id, close AS close_5d
            FROM ranked_bars WHERE rn = 5
        ),
        day_20 AS (
            SELECT trade_id, close AS close_20d
            FROM ranked_bars WHERE rn = 20
        ),
        vol_avg AS (
            SELECT trade_id,
                AVG(volume) AS avg_vol_20d,
                MAX(high) AS high_20d,
                MIN(low) AS low_20d,
                AVG(close) AS ma_20d
            FROM ranked_bars
            WHERE rn <= 20
            GROUP BY trade_id
        )
        SELECT
            t.trade_id,
            -- Prior day features
            pd.range_pct AS prior_day_range_pct,
            pd.return_pct AS prior_day_return_pct,
            pd.volume AS prior_day_volume,
            -- Volume ratio
            CASE
                WHEN va.avg_vol_20d > 0
                THEN pd.volume / va.avg_vol_20d
                ELSE NULL
            END AS vol_ratio,
            -- 5-day return
            CASE
                WHEN d5.close_5d > 0
                THEN (pd.close - d5.close_5d) / d5.close_5d * 100
                ELSE NULL
            END AS return_5d_pct,
            -- 20-day return
            CASE
                WHEN d20.close_20d > 0
                THEN (pd.close - d20.close_20d) / d20.close_20d * 100
                ELSE NULL
            END AS return_20d_pct,
            -- Range position (where is close within 20-day high-low?)
            CASE
                WHEN va.high_20d > va.low_20d
                THEN (pd.close - va.low_20d) / (va.high_20d - va.low_20d) * 100
                ELSE 50
            END AS range_position_20d,
            -- MA alignment
            CASE
                WHEN va.ma_20d > 0
                THEN (pd.close - va.ma_20d) / va.ma_20d * 100
                ELSE NULL
            END AS ma_distance_pct
        FROM trades t
        LEFT JOIN prior_day pd ON pd.trade_id = t.trade_id
        LEFT JOIN day_5 d5 ON d5.trade_id = t.trade_id
        LEFT JOIN day_20 d20 ON d20.trade_id = t.trade_id
        LEFT JOIN vol_avg va ON va.trade_id = t.trade_id
    """).fetchdf()

    print(f"  Features computed ({time.time()-t1:.1f}s)")

    df = trades.merge(features, on="trade_id", how="left")

    # Create buckets
    df["range_bucket"] = pd.cut(
        df["prior_day_range_pct"],
        bins=[0, 2, 4, 6, np.inf],
        labels=["tight (<2%)", "normal (2-4%)", "wide (4-6%)", "very_wide (>6%)"]
    )

    df["return_bucket"] = pd.cut(
        df["prior_day_return_pct"],
        bins=[-np.inf, -3, -1, 0, 1, 3, np.inf],
        labels=["big_down", "down", "flat_down", "flat_up", "up", "big_up"]
    )

    df["vol_ratio_bucket"] = pd.cut(
        df["vol_ratio"],
        bins=[0, 0.5, 0.8, 1.2, 2.0, np.inf],
        labels=["very_low", "low", "normal", "high", "surge"]
    )

    df["trend_5d_bucket"] = pd.cut(
        df["return_5d_pct"],
        bins=[-np.inf, -5, -2, 0, 2, 5, np.inf],
        labels=["crash", "down", "drift_down", "drift_up", "up", "surge"]
    )

    df["range_pos_bucket"] = pd.cut(
        df["range_position_20d"],
        bins=[0, 20, 40, 60, 80, 100],
        labels=["bottom_20", "low_40", "mid_60", "high_80", "top_100"]
    )

    df["ma_bucket"] = pd.cut(
        df["ma_distance_pct"],
        bins=[-np.inf, -5, -2, 0, 2, 5, np.inf],
        labels=["far_below", "below", "near_below", "near_above", "above", "far_above"]
    )

    for col in ["prior_day_range_pct", "vol_ratio", "return_5d_pct", "range_position_20d", "ma_distance_pct"]:
        valid = df[col].notna().sum()
        print(f"  {col}: {valid:,} / {len(df):,} ({valid/len(df)*100:.1f}%)")

    print(f"  Total time: {time.time()-t0:.1f}s")
    return df


def bucket_analysis(df, col, label):
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
                    "cohens_d": t["cohens_d"]
                })
    lines.append("")
    return lines, tests


def continuous_analysis(df, col, label):
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


def strategy_interaction(df, col, label):
    lines = []
    top_strats = df["strategy"].value_counts().head(5).index.tolist()
    for strat in top_strats:
        sdf = df[(df["strategy"] == strat) & df[col].notna()]
        if len(sdf) < 30:
            continue
        lines.append(f"**{strat}** (n={len(sdf):,})")
        lines.append("")
        lines.append(f"| {label} | n | WR | Avg P&L |")
        lines.append("|--------|---|----|---------| ")
        for bucket in sorted(sdf[col].unique()):
            sub = sdf[sdf[col] == bucket]
            if len(sub) >= 5:
                lines.append(
                    f"| {bucket} | {len(sub):,} | {sub['win'].mean()*100:.1f}% "
                    f"| ${sub['holly_pnl'].mean():.0f} |"
                )
        lines.append("")
    return lines


def fdr_correction(tests, alpha=0.10):
    lines = []
    valid = [t for t in tests if not np.isnan(t.get("p_raw", np.nan))]
    if not valid:
        return lines
    valid.sort(key=lambda x: x["p_raw"])
    m = len(valid)
    for i, t in enumerate(valid):
        t["p_adj"] = min(t["p_raw"] * m / (i + 1), 1.0)
    for i in range(m - 2, -1, -1):
        valid[i]["p_adj"] = min(valid[i]["p_adj"], valid[i + 1]["p_adj"])

    sig = [t for t in valid if t["p_adj"] < alpha]
    lines.append(f"**{len(sig)} test(s) significant at FDR < {alpha}:**")
    lines.append("")
    lines.append("| Feature | p-raw | p-adj (BH) | Cohen's d | Verdict |")
    lines.append("|---------|-------|------------|-----------|---------|")
    for t in valid:
        if t["p_adj"] < 0.05:
            verdict = "**SIGNIFICANT**"
        elif t["p_adj"] < alpha:
            verdict = "**marginal**"
        else:
            continue
        d_str = f"{t['cohens_d']:.3f}" if not np.isnan(t.get("cohens_d", np.nan)) else "N/A"
        lines.append(
            f"| {t['feature']} | {t['p_raw']:.4f} | {t['p_adj']:.4f} | {d_str} | {verdict} |"
        )
    lines.append("")
    lines.append(f"Total tests conducted: {m}")
    return lines


def main():
    t0 = time.time()
    con = duckdb.connect(str(DUCKDB_PATH), read_only=True)
    print(f"Connected to {DUCKDB_PATH.name}")

    df = compute_features(con)
    con.close()

    all_tests = []
    report = []
    report.append("# Prior-Day Context Lift Analysis (Daily Bars)")
    report.append("")
    report.append(f"Generated: {pd.Timestamp.now().strftime('%Y-%m-%d %H:%M')}")
    report.append(f"Trades: {len(df):,}")
    report.append(f"Coverage: {df['prior_day_range_pct'].notna().sum():,} "
                  f"({df['prior_day_range_pct'].notna().mean()*100:.1f}%)")
    report.append("")
    report.append("---")
    report.append("")

    # 1. Prior day range
    report.append("## 1. Prior Day Range")
    report.append("")
    lines, tests = bucket_analysis(df, "range_bucket", "Prior Day Range")
    report.extend(lines)
    all_tests.extend(tests)

    # 2. Prior day return
    report.append("## 2. Prior Day Return")
    report.append("")
    lines, tests = bucket_analysis(df, "return_bucket", "Prior Day Return")
    report.extend(lines)
    all_tests.extend(tests)

    # 3. Volume ratio
    report.append("## 3. Volume Ratio (vs 20-day avg)")
    report.append("")
    lines, tests = bucket_analysis(df, "vol_ratio_bucket", "Volume Ratio")
    report.extend(lines)
    all_tests.extend(tests)

    # 4. 5-day trend
    report.append("## 4. 5-Day Trend")
    report.append("")
    lines, tests = bucket_analysis(df, "trend_5d_bucket", "5-Day Trend")
    report.extend(lines)
    all_tests.extend(tests)

    # 5. Range position
    report.append("## 5. 20-Day Range Position")
    report.append("")
    lines, tests = bucket_analysis(df, "range_pos_bucket", "Range Position")
    report.extend(lines)
    all_tests.extend(tests)

    # 6. MA distance
    report.append("## 6. Distance from 20-Day MA")
    report.append("")
    lines, tests = bucket_analysis(df, "ma_bucket", "MA Distance")
    report.extend(lines)
    all_tests.extend(tests)

    # 7. Continuous features
    report.append("## 7. Continuous Features (Median Split)")
    report.append("")
    report.append("| Feature | n(high) | n(low) | WR(high) | WR(low) | PnL(high) | PnL(low) | p-raw | Cohen's d | Corr |")
    report.append("|---------|---------|--------|----------|---------|-----------|----------|-------|-----------|------|")
    for col, label in [
        ("prior_day_range_pct", "Prior Day Range %"),
        ("prior_day_return_pct", "Prior Day Return %"),
        ("vol_ratio", "Volume Ratio"),
        ("return_5d_pct", "5-Day Return %"),
        ("return_20d_pct", "20-Day Return %"),
        ("range_position_20d", "20-Day Range Position"),
        ("ma_distance_pct", "MA Distance %"),
    ]:
        lines, tests = continuous_analysis(df, col, label)
        report.extend(lines)
        all_tests.extend(tests)
    report.append("")

    # 8. Strategy interactions
    report.append("## 8. Strategy x Range Position")
    report.append("")
    report.extend(strategy_interaction(df, "range_pos_bucket", "Range Pos"))

    report.append("## 9. Strategy x Volume Ratio")
    report.append("")
    report.extend(strategy_interaction(df, "vol_ratio_bucket", "Vol Ratio"))

    # 10. FDR
    report.append("## 10. FDR-Corrected Summary")
    report.append("")
    report.extend(fdr_correction(all_tests))
    report.append("")

    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    report_path = REPORT_DIR / "prior-day-context-lift.md"
    report_path.write_text("\n".join(report), encoding="utf-8")

    elapsed = time.time() - t0
    print(f"\nReport saved: {report_path}")
    print(f"Done in {elapsed:.1f}s")


if __name__ == "__main__":
    main()
