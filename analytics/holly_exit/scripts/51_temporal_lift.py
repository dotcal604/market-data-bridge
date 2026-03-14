"""
51_temporal_lift.py — Lift analysis on time-of-day and day-of-week patterns.

Tests whether entry timing predicts Holly trade outcomes.

Features tested:
  - entry_hour: categorical (each hour)
  - time_bucket: first_30min / first_hour / midday / late
  - day_of_week: Mon-Fri
  - month: Jan-Dec
  - quarter: Q1-Q4

Output: reports/temporal-lift.md

Usage:
    python scripts/51_temporal_lift.py
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
    print("Loading trades with temporal features...")
    t0 = time.time()

    df = con.execute(f"""
        SELECT
            trade_id, symbol, entry_time, entry_price,
            strategy, direction, holly_pnl, mfe, mae,
            CASE WHEN holly_pnl > 0 THEN 1 ELSE 0 END AS win,
            CAST(entry_time AS DATE) AS trade_date,
            EXTRACT(HOUR FROM entry_time) AS entry_hour,
            EXTRACT(MINUTE FROM entry_time) AS entry_minute,
            EXTRACT(DOW FROM entry_time) AS day_of_week,
            EXTRACT(MONTH FROM entry_time) AS month,
            EXTRACT(QUARTER FROM entry_time) AS quarter,
            EXTRACT(YEAR FROM entry_time) AS year
        FROM trades
        WHERE entry_time >= CAST('{since}' AS TIMESTAMP)
    """).fetchdf()

    # Derive time buckets based on stored time
    # Entry hours: 6=open, 7=first hour, 8-9=midday, 10+=late
    # (These appear to be ET-shifted; adjust if needed)
    df["time_bucket"] = "midday"
    df.loc[(df["entry_hour"] == 6) & (df["entry_minute"] < 30), "time_bucket"] = "pre_open"
    df.loc[(df["entry_hour"] == 6) & (df["entry_minute"] >= 30), "time_bucket"] = "first_5min"
    df.loc[(df["entry_hour"] == 7) & (df["entry_minute"] < 30), "time_bucket"] = "first_30min"
    df.loc[(df["entry_hour"] == 7) & (df["entry_minute"] >= 30), "time_bucket"] = "first_hour"
    df.loc[df["entry_hour"].isin([8, 9]), "time_bucket"] = "midday"
    df.loc[df["entry_hour"] >= 10, "time_bucket"] = "late"

    # Map DOW to names (DuckDB: 0=Sun, 1=Mon, ..., 5=Fri)
    dow_map = {1: "Mon", 2: "Tue", 3: "Wed", 4: "Thu", 5: "Fri"}
    df["dow_name"] = df["day_of_week"].map(dow_map).fillna("Unknown")

    month_map = {1: "Jan", 2: "Feb", 3: "Mar", 4: "Apr", 5: "May", 6: "Jun",
                 7: "Jul", 8: "Aug", 9: "Sep", 10: "Oct", 11: "Nov", 12: "Dec"}
    df["month_name"] = df["month"].map(month_map).fillna("Unknown")

    print(f"  Loaded {len(df):,} trades ({time.time()-t0:.1f}s)")
    return df


def hour_analysis(df: pd.DataFrame) -> tuple[list[str], list[float]]:
    lines = []
    p_values = []

    lines.append("### Entry Hour")
    lines.append("")
    lines.append("| Hour | n | WR | Avg P&L | Avg MFE | Avg MAE |")
    lines.append("|------|---|----|---------|---------|---------| ")

    for hr in sorted(df["entry_hour"].unique()):
        sub = df[df["entry_hour"] == hr]
        if len(sub) >= 20:
            lines.append(
                f"| {int(hr):02d}:00 | {len(sub):,} | {sub['win'].mean()*100:.1f}% "
                f"| ${sub['holly_pnl'].mean():.0f} "
                f"| ${sub['mfe'].mean():.0f} | ${sub['mae'].mean():.0f} |"
            )
    lines.append("")

    # Test each significant hour vs rest
    for hr in sorted(df["entry_hour"].unique()):
        this = df[df["entry_hour"] == hr]["holly_pnl"]
        rest = df[df["entry_hour"] != hr]["holly_pnl"]
        test = welch_t_test(this, rest)
        if not np.isnan(test["p_value"]):
            p_values.append(test["p_value"])
        else:
            p_values.append(1.0)

    return lines, p_values


def time_bucket_analysis(df: pd.DataFrame) -> tuple[list[str], list[float]]:
    lines = []
    p_values = []

    lines.append("### Time Bucket")
    lines.append("")
    lines.append("| Time Bucket | n | WR | Avg P&L | Avg MFE | Avg MAE |")
    lines.append("|-------------|---|----|---------|---------|---------| ")

    bucket_order = ["pre_open", "first_5min", "first_30min", "first_hour", "midday", "late"]
    for bucket in bucket_order:
        sub = df[df["time_bucket"] == bucket]
        if len(sub) >= 20:
            lines.append(
                f"| {bucket} | {len(sub):,} | {sub['win'].mean()*100:.1f}% "
                f"| ${sub['holly_pnl'].mean():.0f} "
                f"| ${sub['mfe'].mean():.0f} | ${sub['mae'].mean():.0f} |"
            )
    lines.append("")

    for bucket in bucket_order:
        this = df[df["time_bucket"] == bucket]["holly_pnl"]
        rest = df[df["time_bucket"] != bucket]["holly_pnl"]
        test = welch_t_test(this, rest)
        if not np.isnan(test["p_value"]):
            p_values.append(test["p_value"])
        else:
            p_values.append(1.0)

    return lines, p_values


def dow_analysis(df: pd.DataFrame) -> tuple[list[str], list[float]]:
    lines = []
    p_values = []

    lines.append("### Day of Week")
    lines.append("")
    lines.append("| Day | n | WR | Avg P&L | Avg MFE | Avg MAE |")
    lines.append("|-----|---|----|---------|---------|---------| ")

    for dow in ["Mon", "Tue", "Wed", "Thu", "Fri"]:
        sub = df[df["dow_name"] == dow]
        if len(sub) >= 20:
            lines.append(
                f"| {dow} | {len(sub):,} | {sub['win'].mean()*100:.1f}% "
                f"| ${sub['holly_pnl'].mean():.0f} "
                f"| ${sub['mfe'].mean():.0f} | ${sub['mae'].mean():.0f} |"
            )
    lines.append("")

    for dow in ["Mon", "Tue", "Wed", "Thu", "Fri"]:
        this = df[df["dow_name"] == dow]["holly_pnl"]
        rest = df[df["dow_name"] != dow]["holly_pnl"]
        test = welch_t_test(this, rest)
        if not np.isnan(test["p_value"]):
            p_values.append(test["p_value"])
        else:
            p_values.append(1.0)

    return lines, p_values


def month_analysis(df: pd.DataFrame) -> tuple[list[str], list[float]]:
    lines = []
    p_values = []

    lines.append("### Month of Year")
    lines.append("")
    lines.append("| Month | n | WR | Avg P&L |")
    lines.append("|-------|---|----|---------| ")

    months_order = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
                    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
    for m in months_order:
        sub = df[df["month_name"] == m]
        if len(sub) >= 20:
            lines.append(
                f"| {m} | {len(sub):,} | {sub['win'].mean()*100:.1f}% "
                f"| ${sub['holly_pnl'].mean():.0f} |"
            )
    lines.append("")

    for m in months_order:
        this = df[df["month_name"] == m]["holly_pnl"]
        rest = df[df["month_name"] != m]["holly_pnl"]
        test = welch_t_test(this, rest)
        if not np.isnan(test["p_value"]):
            p_values.append(test["p_value"])
        else:
            p_values.append(1.0)

    return lines, p_values


def quarter_analysis(df: pd.DataFrame) -> tuple[list[str], list[float]]:
    lines = []
    p_values = []

    lines.append("### Quarter")
    lines.append("")
    lines.append("| Quarter | n | WR | Avg P&L | Avg MFE |")
    lines.append("|---------|---|----|---------|---------| ")

    for q in [1, 2, 3, 4]:
        sub = df[df["quarter"] == q]
        if len(sub) >= 20:
            lines.append(
                f"| Q{q} | {len(sub):,} | {sub['win'].mean()*100:.1f}% "
                f"| ${sub['holly_pnl'].mean():.0f} "
                f"| ${sub['mfe'].mean():.0f} |"
            )
    lines.append("")

    for q in [1, 2, 3, 4]:
        this = df[df["quarter"] == q]["holly_pnl"]
        rest = df[df["quarter"] != q]["holly_pnl"]
        test = welch_t_test(this, rest)
        if not np.isnan(test["p_value"]):
            p_values.append(test["p_value"])
        else:
            p_values.append(1.0)

    return lines, p_values


def strategy_time_interaction(df: pd.DataFrame) -> list[str]:
    lines = []
    lines.append("### Strategy x Time Bucket (top 5)")
    lines.append("")

    top_strats = df["strategy"].value_counts().head(5).index.tolist()

    for strat in top_strats:
        sdf = df[df["strategy"] == strat]
        lines.append(f"**{strat}** (n={len(sdf):,})")
        lines.append("")
        lines.append("| Time Bucket | n | WR | Avg P&L |")
        lines.append("|-------------|---|----|---------| ")

        for bucket in ["first_5min", "first_30min", "first_hour", "midday", "late"]:
            sub = sdf[sdf["time_bucket"] == bucket]
            if len(sub) >= 10:
                lines.append(
                    f"| {bucket} | {len(sub):,} | {sub['win'].mean()*100:.1f}% "
                    f"| ${sub['holly_pnl'].mean():.0f} |"
                )
        lines.append("")

    return lines


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--since", default="2016-01-01")
    args = parser.parse_args()

    t0 = time.time()
    con = duckdb.connect(str(DUCKDB_PATH), read_only=True)
    print(f"Connected to {DUCKDB_PATH.name}")

    df = load_data(con, args.since)
    if len(df) == 0:
        print("No data found!")
        sys.exit(1)

    all_p_values = []
    all_labels = []

    report = []
    report.append("# Temporal Lift Analysis (Time-of-Day, DOW, Seasonality)")
    report.append("")
    report.append(f"Generated: {pd.Timestamp.now().strftime('%Y-%m-%d %H:%M')}")
    report.append(f"Trades: {len(df):,} (since {args.since})")
    report.append(f"Date range: {df['trade_date'].min()} to {df['trade_date'].max()}")
    report.append("")
    report.append("---")
    report.append("")

    # Section 1: Entry hour
    report.append("## 1. Entry Hour")
    report.append("")
    hr_lines, hr_p = hour_analysis(df)
    report.extend(hr_lines)
    all_p_values.extend(hr_p)
    all_labels.extend([f"hour:{int(h):02d}" for h in sorted(df["entry_hour"].unique())])

    # Section 2: Time buckets
    report.append("## 2. Time Buckets")
    report.append("")
    tb_lines, tb_p = time_bucket_analysis(df)
    report.extend(tb_lines)
    all_p_values.extend(tb_p)
    all_labels.extend([f"bucket:{b}" for b in
                       ["pre_open", "first_5min", "first_30min", "first_hour", "midday", "late"]])

    # Section 3: Day of week
    report.append("## 3. Day of Week")
    report.append("")
    dow_lines, dow_p = dow_analysis(df)
    report.extend(dow_lines)
    all_p_values.extend(dow_p)
    all_labels.extend(["Mon", "Tue", "Wed", "Thu", "Fri"])

    # Section 4: Month
    report.append("## 4. Month of Year")
    report.append("")
    mo_lines, mo_p = month_analysis(df)
    report.extend(mo_lines)
    all_p_values.extend(mo_p)
    all_labels.extend(["Jan", "Feb", "Mar", "Apr", "May", "Jun",
                        "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"])

    # Section 5: Quarter
    report.append("## 5. Quarter")
    report.append("")
    q_lines, q_p = quarter_analysis(df)
    report.extend(q_lines)
    all_p_values.extend(q_p)
    all_labels.extend(["Q1", "Q2", "Q3", "Q4"])

    # Section 6: Strategy x Time
    report.append("## 6. Strategy x Time Bucket Interaction")
    report.append("")
    report.extend(strategy_time_interaction(df))

    # Section 7: FDR
    report.append("## 7. FDR-Corrected Summary")
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

    report.append(f"Total tests conducted: {len(all_p_values)}")
    report.append("")

    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    report_path = REPORT_DIR / "temporal-lift.md"
    report_path.write_text("\n".join(report), encoding="utf-8")

    elapsed = time.time() - t0
    print(f"\nReport saved: {report_path}")
    print(f"  Tests: {len(all_p_values)}, Significant: {len(sig_results)}")
    print(f"Done in {elapsed:.1f}s")
    con.close()


if __name__ == "__main__":
    main()
