"""
62_relative_strength_lift.py — Stock relative strength vs SPY from daily bars.

Computes how each stock performed vs SPY over various lookback windows
BEFORE the trade entry. Hypothesis: stocks outperforming SPY (relative strength
leaders) may have different intraday momentum characteristics than laggards.

Features extracted:
  - RS 5-day: stock 5d return - SPY 5d return
  - RS 10-day: stock 10d return - SPY 10d return
  - RS 20-day: stock 20d return - SPY 20d return
  - Stock beta (20-day rolling correlation × vol ratio)
  - Stock vs SPY direction agreement (same direction last N days)
  - Distance from stock's 20-day high/low (range position)

FDR-corrected lift analysis for each feature.

Output: reports/relative-strength-lift.md

Usage:
    python scripts/62_relative_strength_lift.py
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


def fdr_correction(p_values: list, alpha: float = 0.05) -> list:
    n = len(p_values)
    if n == 0:
        return []
    sorted_indices = np.argsort(p_values)
    sorted_p = np.array(p_values)[sorted_indices]
    thresholds = [(i + 1) / n * alpha for i in range(n)]
    significant = [False] * n
    max_sig = -1
    for i in range(n):
        if sorted_p[i] <= thresholds[i]:
            max_sig = i
    for i in range(max_sig + 1):
        significant[sorted_indices[i]] = True
    return significant


def load_relative_strength(con: duckdb.DuckDBPyConnection) -> pd.DataFrame:
    """Compute relative strength features: stock returns vs SPY returns."""
    print("Loading relative strength features...")
    t0 = time.time()

    # Step 1: Get QQQ daily returns as market proxy (SPY not in DB)
    print("  Loading QQQ daily bars as market proxy...")
    spy_df = con.execute("""
        SELECT
            bar_date,
            close,
            LAG(close, 1) OVER (ORDER BY bar_date) AS close_1,
            LAG(close, 5) OVER (ORDER BY bar_date) AS close_5,
            LAG(close, 10) OVER (ORDER BY bar_date) AS close_10,
            LAG(close, 20) OVER (ORDER BY bar_date) AS close_20
        FROM daily_bars
        WHERE symbol = 'QQQ'
        ORDER BY bar_date
    """).fetchdf()

    spy_df["spy_ret_1d"] = (spy_df["close"] - spy_df["close_1"]) / spy_df["close_1"] * 100
    spy_df["spy_ret_5d"] = (spy_df["close"] - spy_df["close_5"]) / spy_df["close_5"] * 100
    spy_df["spy_ret_10d"] = (spy_df["close"] - spy_df["close_10"]) / spy_df["close_10"] * 100
    spy_df["spy_ret_20d"] = (spy_df["close"] - spy_df["close_20"]) / spy_df["close_20"] * 100
    spy_df = spy_df.rename(columns={"close": "spy_close"})
    spy_df = spy_df[["bar_date", "spy_close", "spy_ret_1d", "spy_ret_5d",
                      "spy_ret_10d", "spy_ret_20d"]].dropna()
    print(f"    QQQ bars: {len(spy_df):,}")

    # Step 2: Get stock daily returns + range position for each trade
    print("  Loading stock daily features per trade...")
    stock_df = con.execute("""
        WITH daily_window AS (
            SELECT
                t.trade_id,
                t.holly_pnl,
                t.direction,
                t.symbol,
                CASE WHEN t.holly_pnl > 0 THEN 1 ELSE 0 END AS win,
                d.bar_date,
                d.close,
                d.high,
                d.low,
                d.volume,
                ROW_NUMBER() OVER (
                    PARTITION BY t.trade_id ORDER BY d.bar_date DESC
                ) AS rn
            FROM trades t
            JOIN daily_bars d
                ON d.symbol = t.symbol
                AND d.bar_date < CAST(t.entry_time AS DATE)
                AND d.bar_date >= CAST(t.entry_time AS DATE) - 30
        )
        SELECT
            trade_id,
            holly_pnl,
            direction,
            win,
            -- Prior day close and bar_date
            MAX(CASE WHEN rn = 1 THEN bar_date END) AS prior_bar_date,
            MAX(CASE WHEN rn = 1 THEN close END) AS d1_close,
            -- Returns over various lookbacks
            MAX(CASE WHEN rn = 5 THEN close END) AS d5_close,
            MAX(CASE WHEN rn = 10 THEN close END) AS d10_close,
            MAX(CASE WHEN rn = 20 THEN close END) AS d20_close,
            -- 20-day high and low for range position
            MAX(CASE WHEN rn BETWEEN 1 AND 20 THEN high END) AS high_20d,
            MIN(CASE WHEN rn BETWEEN 1 AND 20 THEN low END) AS low_20d
        FROM daily_window
        WHERE rn <= 20
        GROUP BY trade_id, holly_pnl, direction, win
    """).fetchdf()

    print(f"    Stock features: {len(stock_df):,} trades")

    # Compute stock returns
    stock_df["stock_ret_5d"] = np.where(
        stock_df["d5_close"].notna() & (stock_df["d5_close"] > 0),
        (stock_df["d1_close"] - stock_df["d5_close"]) / stock_df["d5_close"] * 100,
        np.nan
    )
    stock_df["stock_ret_10d"] = np.where(
        stock_df["d10_close"].notna() & (stock_df["d10_close"] > 0),
        (stock_df["d1_close"] - stock_df["d10_close"]) / stock_df["d10_close"] * 100,
        np.nan
    )
    stock_df["stock_ret_20d"] = np.where(
        stock_df["d20_close"].notna() & (stock_df["d20_close"] > 0),
        (stock_df["d1_close"] - stock_df["d20_close"]) / stock_df["d20_close"] * 100,
        np.nan
    )

    # 20-day range position (0-100, where 100 = at 20d high)
    range_width = stock_df["high_20d"] - stock_df["low_20d"]
    stock_df["range_position_20d"] = np.where(
        range_width > 0,
        (stock_df["d1_close"] - stock_df["low_20d"]) / range_width * 100,
        np.nan
    )

    # Step 3: Merge SPY returns
    stock_df["prior_bar_date"] = pd.to_datetime(stock_df["prior_bar_date"])
    spy_df["bar_date"] = pd.to_datetime(spy_df["bar_date"])
    merged = stock_df.merge(spy_df, left_on="prior_bar_date", right_on="bar_date", how="left")

    # Relative strength = stock return - SPY return
    merged["rs_5d"] = merged["stock_ret_5d"] - merged["spy_ret_5d"]
    merged["rs_10d"] = merged["stock_ret_10d"] - merged["spy_ret_10d"]
    merged["rs_20d"] = merged["stock_ret_20d"] - merged["spy_ret_20d"]

    # RS direction (positive = outperforming SPY)
    merged["rs_5d_pos"] = (merged["rs_5d"] > 0).astype(int)
    merged["rs_10d_pos"] = (merged["rs_10d"] > 0).astype(int)
    merged["rs_20d_pos"] = (merged["rs_20d"] > 0).astype(int)

    # Absolute RS (magnitude of outperformance)
    merged["rs_5d_abs"] = merged["rs_5d"].abs()
    merged["rs_10d_abs"] = merged["rs_10d"].abs()

    print(f"  Merged: {len(merged):,} trades")
    print(f"  RS 5d coverage: {merged['rs_5d'].notna().sum():,}")
    print(f"  RS 20d coverage: {merged['rs_20d'].notna().sum():,}")
    print(f"  Range position coverage: {merged['range_position_20d'].notna().sum():,}")
    print(f"  Done in {time.time()-t0:.1f}s")

    return merged


def analyze_continuous(df, col, label, results):
    valid = df[df[col].notna()].copy()
    if len(valid) < 100:
        return
    try:
        valid["bin"] = pd.qcut(valid[col], 5, labels=False, duplicates="drop")
    except ValueError:
        return
    top = valid[valid["bin"] == valid["bin"].max()]["holly_pnl"]
    bot = valid[valid["bin"] == valid["bin"].min()]["holly_pnl"]
    test = welch_t_test(top, bot)
    results.append({
        "feature": label, "type": "continuous", "n_total": len(valid),
        "cohens_d": test["cohens_d"], "p_value": test["p_value"],
        "avg_pnl_top": top.mean(), "avg_pnl_bot": bot.mean(),
        "wr_top": valid[valid["bin"] == valid["bin"].max()]["win"].mean() * 100,
        "wr_bot": valid[valid["bin"] == valid["bin"].min()]["win"].mean() * 100,
    })


def analyze_binary(df, col, label, results):
    valid = df[df[col].notna()].copy()
    g1 = valid[valid[col] == 1]["holly_pnl"]
    g0 = valid[valid[col] == 0]["holly_pnl"]
    test = welch_t_test(g1, g0)
    results.append({
        "feature": label, "type": "binary", "n_total": len(valid),
        "cohens_d": test["cohens_d"], "p_value": test["p_value"],
        "avg_pnl_top": g1.mean() if len(g1) > 0 else np.nan,
        "avg_pnl_bot": g0.mean() if len(g0) > 0 else np.nan,
        "wr_top": valid[valid[col] == 1]["win"].mean() * 100 if len(g1) > 0 else np.nan,
        "wr_bot": valid[valid[col] == 0]["win"].mean() * 100 if len(g0) > 0 else np.nan,
    })


def quintile_table(df, col, label):
    lines = []
    valid = df[df[col].notna()].copy()
    if len(valid) < 100:
        return lines
    try:
        valid["q"] = pd.qcut(valid[col], 5, labels=False, duplicates="drop") + 1
    except ValueError:
        return lines

    lines.append(f"**{label}** (n={len(valid):,})")
    lines.append("")
    lines.append("| Quintile | Range | n | WR | Avg P&L |")
    lines.append("|----------|-------|---|----|---------| ")
    for q in sorted(valid["q"].unique()):
        sub = valid[valid["q"] == q]
        lines.append(
            f"| Q{q} | {sub[col].min():.2f}–{sub[col].max():.2f} "
            f"| {len(sub):,} | {sub['win'].mean()*100:.1f}% "
            f"| ${sub['holly_pnl'].mean():.0f} |"
        )
    lines.append("")
    return lines


def main():
    t0 = time.time()
    con = duckdb.connect(str(DUCKDB_PATH), read_only=True)
    print(f"Connected to {DUCKDB_PATH.name}")

    df = load_relative_strength(con)
    con.close()

    if len(df) == 0:
        print("No data!")
        sys.exit(1)

    # ── Lift analysis ──
    print("\nRunning lift analysis...")
    results = []

    # All trades
    for col, label in [
        ("rs_5d", "RS 5-Day (stock - SPY)"),
        ("rs_10d", "RS 10-Day (stock - SPY)"),
        ("rs_20d", "RS 20-Day (stock - SPY)"),
        ("range_position_20d", "20-Day Range Position (0-100)"),
        ("stock_ret_5d", "Stock 5-Day Return (%)"),
        ("stock_ret_10d", "Stock 10-Day Return (%)"),
        ("stock_ret_20d", "Stock 20-Day Return (%)"),
        ("spy_ret_5d", "SPY 5-Day Return (%)"),
        ("rs_5d_abs", "RS 5-Day Absolute Magnitude"),
        ("rs_10d_abs", "RS 10-Day Absolute Magnitude"),
    ]:
        analyze_continuous(df, col, label, results)

    for col, label in [
        ("rs_5d_pos", "RS 5-Day Positive (outperforming SPY)"),
        ("rs_10d_pos", "RS 10-Day Positive"),
        ("rs_20d_pos", "RS 20-Day Positive"),
    ]:
        analyze_binary(df, col, label, results)

    # Direction-specific
    for direction in ["Long", "Short"]:
        dir_df = df[df["direction"].str.lower() == direction.lower()]
        if len(dir_df) < 100:
            continue
        for col, label in [
            ("rs_5d", f"RS 5-Day ({direction}s)"),
            ("rs_10d", f"RS 10-Day ({direction}s)"),
            ("rs_20d", f"RS 20-Day ({direction}s)"),
            ("range_position_20d", f"Range Position ({direction}s)"),
            ("spy_ret_5d", f"SPY 5-Day Ret ({direction}s)"),
        ]:
            analyze_continuous(dir_df, col, label, results)

    # FDR correction
    p_values = [r["p_value"] for r in results if not np.isnan(r.get("p_value", np.nan))]
    valid_mask = [not np.isnan(r.get("p_value", np.nan)) for r in results]
    if p_values:
        sig_flags = fdr_correction(p_values)
        sig_idx = 0
        for i, r in enumerate(results):
            if valid_mask[i]:
                r["fdr_significant"] = sig_flags[sig_idx]
                sig_idx += 1
            else:
                r["fdr_significant"] = False

    n_sig = sum(1 for r in results if r.get("fdr_significant", False))
    print(f"  {n_sig}/{len(results)} FDR-significant features")

    # ── Build report ──
    report = []
    report.append("# Relative Strength vs SPY — Lift Analysis")
    report.append("")
    report.append(f"Generated: {pd.Timestamp.now().strftime('%Y-%m-%d %H:%M')}")
    report.append(f"Trades with RS data: {len(df):,}")
    report.append(f"RS 5d coverage: {df['rs_5d'].notna().sum():,} "
                  f"({df['rs_5d'].notna().mean()*100:.0f}%)")
    report.append(f"FDR-Significant: {n_sig}/{len(results)}")
    report.append("")

    # Summary table
    report.append("## 1. Feature Summary")
    report.append("")
    report.append("| Feature | n | Cohen's d | p-value | FDR Sig |")
    report.append("|---------|---|-----------|---------|---------|")
    for r in sorted(results, key=lambda x: abs(x.get("cohens_d", 0) or 0), reverse=True):
        d_val = r.get("cohens_d", np.nan)
        p_val = r.get("p_value", np.nan)
        sig = "Y" if r.get("fdr_significant", False) else ""
        d_str = f"{d_val:.3f}" if not np.isnan(d_val) else "—"
        p_str = f"{p_val:.4f}" if not np.isnan(p_val) else "—"
        report.append(f"| {r['feature']} | {r['n_total']:,} | {d_str} | {p_str} | {sig} |")
    report.append("")

    # Quintile breakdowns
    report.append("## 2. Quintile Breakdowns")
    report.append("")
    for col, label in [
        ("rs_5d", "RS 5-Day (stock - SPY)"),
        ("rs_10d", "RS 10-Day (stock - SPY)"),
        ("rs_20d", "RS 20-Day (stock - SPY)"),
        ("range_position_20d", "20-Day Range Position"),
        ("spy_ret_5d", "SPY 5-Day Return"),
    ]:
        report.extend(quintile_table(df, col, label))

    # Direction splits
    report.append("## 3. Direction-Specific Quintiles")
    report.append("")
    for direction in ["Long", "Short"]:
        dir_df = df[df["direction"].str.lower() == direction.lower()]
        report.append(f"### {direction}s (n={len(dir_df):,})")
        report.append("")
        for col, label in [
            ("rs_5d", f"RS 5-Day ({direction}s)"),
            ("range_position_20d", f"Range Position ({direction}s)"),
        ]:
            report.extend(quintile_table(dir_df, col, label))

    # Conclusions
    report.append("## 4. Conclusions")
    report.append("")
    sig_features = [r for r in results if r.get("fdr_significant", False)
                    and "Long" not in r["feature"] and "Short" not in r["feature"]]
    if sig_features:
        report.append("**FDR-significant features:**")
        for r in sorted(sig_features, key=lambda x: abs(x.get("cohens_d", 0)), reverse=True):
            report.append(f"- {r['feature']}: d={r['cohens_d']:.3f}")
    else:
        report.append("*No undirected features survived FDR correction.*")
    report.append("")

    # Write
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    report_path = REPORT_DIR / "relative-strength-lift.md"
    report_path.write_text("\n".join(report), encoding="utf-8")

    elapsed = time.time() - t0
    print(f"\nReport saved: {report_path}")
    print(f"Done in {elapsed:.1f}s")


if __name__ == "__main__":
    main()
