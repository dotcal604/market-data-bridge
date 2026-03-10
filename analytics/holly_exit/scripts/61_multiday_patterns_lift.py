"""
61_multiday_patterns_lift.py — Multi-day pattern features from daily bars.

Extracts pattern-based features from the 5 days BEFORE each trade:
  - Inside day (today's range within yesterday's range)
  - Narrow range (NR4/NR7 — smallest range in 4/7 days)
  - Consecutive up/down days
  - Gap patterns (gap up/down from prior close)
  - Distance from 20-day moving average (% above/below)
  - 5-day return (prior week momentum)
  - 3-day volume trend (increasing/decreasing)
  - ATR contraction (current ATR vs 20-day ATR)

FDR-corrected lift analysis for each feature.

Output: reports/multiday-patterns-lift.md

Usage:
    python scripts/61_multiday_patterns_lift.py
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
    """Benjamini-Hochberg FDR correction."""
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


def load_multiday_features(con: duckdb.DuckDBPyConnection) -> pd.DataFrame:
    """Extract multi-day pattern features from daily bars."""
    print("Loading multi-day pattern features from daily bars...")
    t0 = time.time()

    df = con.execute("""
        WITH daily_window AS (
            SELECT
                t.trade_id,
                t.holly_pnl,
                t.direction,
                CASE WHEN t.holly_pnl > 0 THEN 1 ELSE 0 END AS win,
                d.bar_date,
                d.open, d.high, d.low, d.close, d.volume,
                ROW_NUMBER() OVER (
                    PARTITION BY t.trade_id
                    ORDER BY d.bar_date DESC
                ) AS rn
            FROM trades t
            JOIN daily_bars d
                ON d.symbol = t.symbol
                AND d.bar_date < CAST(t.entry_time AS DATE)
                AND d.bar_date >= CAST(t.entry_time AS DATE) - 30
        ),
        day_features AS (
            SELECT
                trade_id,
                holly_pnl,
                direction,
                win,
                -- Prior day (rn=1) OHLCV
                MAX(CASE WHEN rn = 1 THEN high END) AS d1_high,
                MAX(CASE WHEN rn = 1 THEN low END) AS d1_low,
                MAX(CASE WHEN rn = 1 THEN close END) AS d1_close,
                MAX(CASE WHEN rn = 1 THEN open END) AS d1_open,
                MAX(CASE WHEN rn = 1 THEN volume END) AS d1_volume,
                MAX(CASE WHEN rn = 1 THEN high - low END) AS d1_range,
                -- Day -2
                MAX(CASE WHEN rn = 2 THEN high END) AS d2_high,
                MAX(CASE WHEN rn = 2 THEN low END) AS d2_low,
                MAX(CASE WHEN rn = 2 THEN close END) AS d2_close,
                MAX(CASE WHEN rn = 2 THEN open END) AS d2_open,
                MAX(CASE WHEN rn = 2 THEN volume END) AS d2_volume,
                MAX(CASE WHEN rn = 2 THEN high - low END) AS d2_range,
                -- Day -3
                MAX(CASE WHEN rn = 3 THEN high END) AS d3_high,
                MAX(CASE WHEN rn = 3 THEN low END) AS d3_low,
                MAX(CASE WHEN rn = 3 THEN open END) AS d3_open,
                MAX(CASE WHEN rn = 3 THEN close END) AS d3_close,
                MAX(CASE WHEN rn = 3 THEN volume END) AS d3_volume,
                MAX(CASE WHEN rn = 3 THEN high - low END) AS d3_range,
                -- Day -4 through -7 ranges for NR detection
                MAX(CASE WHEN rn = 4 THEN high - low END) AS d4_range,
                MAX(CASE WHEN rn = 5 THEN high - low END) AS d5_range,
                MAX(CASE WHEN rn = 6 THEN high - low END) AS d6_range,
                MAX(CASE WHEN rn = 7 THEN high - low END) AS d7_range,
                -- Day -5 close for 5-day return
                MAX(CASE WHEN rn = 5 THEN close END) AS d5_close,
                -- 20-day moving average
                AVG(CASE WHEN rn BETWEEN 1 AND 20 THEN close END) AS ma_20,
                -- 20-day ATR proxy (average daily range)
                AVG(CASE WHEN rn BETWEEN 1 AND 20 THEN high - low END) AS avg_range_20
            FROM daily_window
            WHERE rn <= 20
            GROUP BY trade_id, holly_pnl, direction, win
        )
        SELECT * FROM day_features
    """).fetchdf()

    print(f"  Loaded {len(df):,} trades with daily data ({time.time()-t0:.1f}s)")
    print(f"  d1_high coverage: {df['d1_high'].notna().sum():,}")
    print(f"  d5_close coverage: {df['d5_close'].notna().sum():,}")

    # Compute derived features
    print("  Computing derived features...")

    # Inside day: d1 range within d2 range
    df["inside_day"] = (
        (df["d1_high"] <= df["d2_high"]) &
        (df["d1_low"] >= df["d2_low"])
    ).astype(int)

    # NR4: d1 range is smallest in last 4 days
    df["nr4"] = (
        (df["d1_range"] < df["d2_range"]) &
        (df["d1_range"] < df["d3_range"]) &
        (df["d1_range"] < df["d4_range"])
    ).astype(int)

    # NR7: d1 range is smallest in last 7 days
    df["nr7"] = (
        (df["d1_range"] < df["d2_range"]) &
        (df["d1_range"] < df["d3_range"]) &
        (df["d1_range"] < df["d4_range"]) &
        (df["d1_range"] < df["d5_range"]) &
        (df["d1_range"] < df["d6_range"]) &
        (df["d1_range"] < df["d7_range"])
    ).astype(int)

    # Consecutive up/down days (last 3 days)
    df["d1_up"] = (df["d1_close"] > df["d1_open"]).astype(int)
    df["d2_up"] = (df["d2_close"] > df["d2_open"]).astype(int)
    df["d3_up"] = (df["d3_close"] > df["d3_open"]).astype(int)
    df["consec_up"] = df["d1_up"] + df["d2_up"] + df["d3_up"]  # 0-3
    df["consec_down"] = 3 - df["consec_up"]

    # Gap from d2 close to d1 open (prior day had a gap)
    df["prior_gap_pct"] = np.where(
        df["d2_close"].notna() & (df["d2_close"] > 0),
        (df["d1_open"] - df["d2_close"]) / df["d2_close"] * 100,
        np.nan
    )

    # Gap direction
    df["prior_gap_up"] = (df["prior_gap_pct"] > 0.5).astype(int)
    df["prior_gap_down"] = (df["prior_gap_pct"] < -0.5).astype(int)

    # Distance from 20-day MA (%)
    df["dist_from_ma20_pct"] = np.where(
        df["ma_20"].notna() & (df["ma_20"] > 0),
        (df["d1_close"] - df["ma_20"]) / df["ma_20"] * 100,
        np.nan
    )

    # 5-day return (%)
    df["return_5d_pct"] = np.where(
        df["d5_close"].notna() & (df["d5_close"] > 0),
        (df["d1_close"] - df["d5_close"]) / df["d5_close"] * 100,
        np.nan
    )

    # Prior day return (%)
    df["prior_return_pct"] = np.where(
        df["d1_open"].notna() & (df["d1_open"] > 0),
        (df["d1_close"] - df["d1_open"]) / df["d1_open"] * 100,
        np.nan
    )

    # 3-day volume trend (d1/d3 ratio)
    df["vol_trend_3d"] = np.where(
        df["d3_volume"].notna() & (df["d3_volume"] > 0),
        df["d1_volume"] / df["d3_volume"],
        np.nan
    )

    # ATR contraction (d1 range / 20-day avg range)
    df["atr_contraction"] = np.where(
        df["avg_range_20"].notna() & (df["avg_range_20"] > 0),
        df["d1_range"] / df["avg_range_20"],
        np.nan
    )

    # Prior day body size relative to range (doji detection)
    df["body_to_range"] = np.where(
        df["d1_range"].notna() & (df["d1_range"] > 0),
        abs(df["d1_close"] - df["d1_open"]) / df["d1_range"],
        np.nan
    )

    return df


def analyze_binary_feature(df, feature_col, label, results_list):
    """Analyze a binary feature (0/1) for lift."""
    valid = df[df[feature_col].notna()].copy()
    group_1 = valid[valid[feature_col] == 1]["holly_pnl"]
    group_0 = valid[valid[feature_col] == 0]["holly_pnl"]

    test = welch_t_test(group_1, group_0)
    results_list.append({
        "feature": label,
        "type": "binary",
        "n_total": len(valid),
        "n_1": len(group_1),
        "pct_1": len(group_1) / len(valid) * 100 if len(valid) > 0 else 0,
        "avg_pnl_1": group_1.mean() if len(group_1) > 0 else np.nan,
        "avg_pnl_0": group_0.mean() if len(group_0) > 0 else np.nan,
        "wr_1": valid[valid[feature_col] == 1]["win"].mean() * 100 if len(group_1) > 0 else np.nan,
        "wr_0": valid[valid[feature_col] == 0]["win"].mean() * 100 if len(group_0) > 0 else np.nan,
        "cohens_d": test["cohens_d"],
        "p_value": test["p_value"],
    })


def analyze_continuous_feature(df, feature_col, label, results_list, n_bins=5):
    """Analyze a continuous feature by quintile bins."""
    valid = df[df[feature_col].notna()].copy()
    if len(valid) < 100:
        return

    try:
        valid["bin"] = pd.qcut(valid[feature_col], n_bins, labels=False, duplicates="drop")
    except ValueError:
        return

    top_bin = valid["bin"].max()
    bot_bin = valid["bin"].min()

    top = valid[valid["bin"] == top_bin]["holly_pnl"]
    bot = valid[valid["bin"] == bot_bin]["holly_pnl"]

    test = welch_t_test(top, bot)
    results_list.append({
        "feature": label,
        "type": "continuous",
        "n_total": len(valid),
        "n_1": len(top),
        "pct_1": len(top) / len(valid) * 100 if len(valid) > 0 else 0,
        "avg_pnl_1": top.mean(),
        "avg_pnl_0": bot.mean(),
        "wr_1": valid[valid["bin"] == top_bin]["win"].mean() * 100,
        "wr_0": valid[valid["bin"] == bot_bin]["win"].mean() * 100,
        "cohens_d": test["cohens_d"],
        "p_value": test["p_value"],
    })


def quintile_table(df, feature_col, label) -> list:
    """Generate quintile breakdown table."""
    lines = []
    valid = df[df[feature_col].notna()].copy()
    if len(valid) < 100:
        lines.append(f"*Insufficient data for {label}*")
        return lines

    try:
        valid["q"] = pd.qcut(valid[feature_col], 5, labels=False, duplicates="drop") + 1
    except ValueError:
        return lines

    lines.append(f"**{label}** (n={len(valid):,})")
    lines.append("")
    lines.append("| Quintile | Range | n | WR | Avg P&L |")
    lines.append("|----------|-------|---|----|---------| ")

    for q in sorted(valid["q"].unique()):
        sub = valid[valid["q"] == q]
        lines.append(
            f"| Q{q} | {sub[feature_col].min():.2f}–{sub[feature_col].max():.2f} "
            f"| {len(sub):,} | {sub['win'].mean()*100:.1f}% "
            f"| ${sub['holly_pnl'].mean():.0f} |"
        )
    lines.append("")
    return lines


def main():
    t0 = time.time()
    con = duckdb.connect(str(DUCKDB_PATH), read_only=True)
    print(f"Connected to {DUCKDB_PATH.name}")

    df = load_multiday_features(con)
    con.close()

    if len(df) == 0:
        print("No data!")
        sys.exit(1)

    # ── Lift analysis ──
    print("\nRunning lift analysis...")
    results = []

    # Binary features
    binary_features = [
        ("inside_day", "Inside Day"),
        ("nr4", "NR4 (Narrow Range 4)"),
        ("nr7", "NR7 (Narrow Range 7)"),
        ("prior_gap_up", "Prior Day Gap Up (>0.5%)"),
        ("prior_gap_down", "Prior Day Gap Down (<-0.5%)"),
    ]
    for col, label in binary_features:
        analyze_binary_feature(df, col, label, results)

    # Continuous features
    continuous_features = [
        ("dist_from_ma20_pct", "Distance from 20-Day MA (%)"),
        ("return_5d_pct", "5-Day Return (%)"),
        ("prior_return_pct", "Prior Day Return (%)"),
        ("prior_gap_pct", "Prior Day Gap (%)"),
        ("vol_trend_3d", "3-Day Volume Trend"),
        ("atr_contraction", "ATR Contraction Ratio"),
        ("body_to_range", "Body-to-Range Ratio (Doji)"),
        ("consec_up", "Consecutive Up Days (0-3)"),
    ]
    for col, label in continuous_features:
        analyze_continuous_feature(df, col, label, results)

    # Direction split
    for direction in ["Long", "Short"]:
        dir_df = df[df["direction"].str.lower() == direction.lower()]
        if len(dir_df) < 100:
            continue
        for col, label in continuous_features[:4]:  # Top features only
            analyze_continuous_feature(dir_df, col, f"{label} ({direction}s)", results)

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
    report.append("# Multi-Day Pattern Features Lift Analysis")
    report.append("")
    report.append(f"Generated: {pd.Timestamp.now().strftime('%Y-%m-%d %H:%M')}")
    report.append(f"Trades: {len(df):,}")
    report.append(f"FDR-Significant: {n_sig}/{len(results)}")
    report.append("")

    # Summary table
    report.append("## 1. Feature Summary")
    report.append("")
    report.append("| Feature | Type | n | Cohen's d | p-value | FDR Sig |")
    report.append("|---------|------|---|-----------|---------|---------|")

    for r in sorted(results, key=lambda x: abs(x.get("cohens_d", 0) or 0), reverse=True):
        d_val = r.get("cohens_d", np.nan)
        p_val = r.get("p_value", np.nan)
        sig = "✓" if r.get("fdr_significant", False) else ""
        report.append(
            f"| {r['feature']} | {r['type']} | {r['n_total']:,} "
            f"| {d_val:.3f} | {p_val:.4f} | {sig} |"
        )
    report.append("")

    # Quintile breakdowns for key features
    report.append("## 2. Feature Quintile Breakdowns")
    report.append("")

    for col, label in continuous_features:
        report.extend(quintile_table(df, col, label))

    # Binary feature details
    report.append("## 3. Binary Feature Details")
    report.append("")
    report.append("| Feature | Prevalence | WR (Yes) | WR (No) | Avg P&L (Yes) | Avg P&L (No) | d |")
    report.append("|---------|-----------|----------|---------|---------------|--------------|---|")
    for r in results:
        if r["type"] == "binary":
            report.append(
                f"| {r['feature']} | {r['pct_1']:.1f}% "
                f"| {r['wr_1']:.1f}% | {r['wr_0']:.1f}% "
                f"| ${r['avg_pnl_1']:.0f} | ${r['avg_pnl_0']:.0f} "
                f"| {r['cohens_d']:.3f} |"
            )
    report.append("")

    # Direction-specific findings
    report.append("## 4. Direction-Specific Features")
    report.append("")
    dir_results = [r for r in results if "Long" in r["feature"] or "Short" in r["feature"]]
    if dir_results:
        report.append("| Feature | Cohen's d | p-value | FDR Sig |")
        report.append("|---------|-----------|---------|---------|")
        for r in sorted(dir_results, key=lambda x: abs(x.get("cohens_d", 0) or 0), reverse=True):
            sig = "✓" if r.get("fdr_significant", False) else ""
            report.append(
                f"| {r['feature']} | {r['cohens_d']:.3f} "
                f"| {r['p_value']:.4f} | {sig} |"
            )
        report.append("")

    # Conclusions
    report.append("## 5. Conclusions")
    report.append("")
    sig_features = [r for r in results if r.get("fdr_significant", False)]
    if sig_features:
        report.append("**FDR-significant features for composite consideration:**")
        report.append("")
        for r in sorted(sig_features, key=lambda x: abs(x.get("cohens_d", 0)), reverse=True):
            report.append(f"- {r['feature']}: d={r['cohens_d']:.3f}")
    else:
        report.append("*No features survived FDR correction.*")
    report.append("")

    # Write
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    report_path = REPORT_DIR / "multiday-patterns-lift.md"
    report_path.write_text("\n".join(report), encoding="utf-8")

    elapsed = time.time() - t0
    print(f"\nReport saved: {report_path}")
    print(f"Done in {elapsed:.1f}s")


if __name__ == "__main__":
    main()
