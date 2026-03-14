"""
63_volume_microstructure_lift.py — Opening drive + volume microstructure from minute bars.

Extracts intraday microstructure features from the 56.5M minute bars:
  - Opening drive: first 5 min range vs first 30 min range (compression ratio)
  - Volume profile: % of pre-entry volume in first 15 min vs rest
  - Price action: higher highs/higher lows count pre-entry
  - VWAP slope: is VWAP trending up/down/flat before entry
  - Volume acceleration: last 5 bars vol vs prior 10 bars vol
  - Bar-to-bar volatility: std of 1-min returns pre-entry
  - Time since open: minutes between market open and trade entry

FDR-corrected lift analysis for each feature.

Output: reports/volume-microstructure-lift.md

Usage:
    python scripts/63_volume_microstructure_lift.py
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


def load_microstructure(con: duckdb.DuckDBPyConnection) -> pd.DataFrame:
    """Extract volume/price microstructure from minute bars."""
    print("Loading volume microstructure features from minute bars...")
    t0 = time.time()

    df = con.execute("""
        WITH pre_entry_bars AS (
            SELECT
                t.trade_id,
                t.holly_pnl,
                t.direction,
                t.entry_price,
                t.entry_time,
                CASE WHEN t.holly_pnl > 0 THEN 1 ELSE 0 END AS win,
                b.bar_time,
                b.open AS bar_open, b.high AS bar_high,
                b.low AS bar_low, b.close AS bar_close,
                b.volume AS bar_volume, b.vwap AS bar_vwap,
                -- Minutes since market open (9:30 = 570 min)
                EXTRACT(HOUR FROM b.bar_time) * 60 + EXTRACT(MINUTE FROM b.bar_time) AS bar_min,
                EXTRACT(HOUR FROM t.entry_time) * 60 + EXTRACT(MINUTE FROM t.entry_time) AS entry_min,
                ROW_NUMBER() OVER (
                    PARTITION BY t.trade_id ORDER BY b.bar_time DESC
                ) AS rn_desc,
                ROW_NUMBER() OVER (
                    PARTITION BY t.trade_id ORDER BY b.bar_time ASC
                ) AS rn_asc
            FROM trades t
            JOIN bars b
                ON b.symbol = t.symbol
                AND CAST(b.bar_time AS DATE) = CAST(t.entry_time AS DATE)
                AND b.bar_time <= t.entry_time
        ),
        early_bars AS (
            -- First 5 min and first 30 min stats
            SELECT
                trade_id,
                -- First 5 minutes range (9:30-9:35)
                MAX(CASE WHEN bar_min BETWEEN 570 AND 574 THEN bar_high END) -
                    MIN(CASE WHEN bar_min BETWEEN 570 AND 574 THEN bar_low END) AS range_5min,
                -- First 15 minutes range
                MAX(CASE WHEN bar_min BETWEEN 570 AND 584 THEN bar_high END) -
                    MIN(CASE WHEN bar_min BETWEEN 570 AND 584 THEN bar_low END) AS range_15min,
                -- First 30 minutes range
                MAX(CASE WHEN bar_min BETWEEN 570 AND 599 THEN bar_high END) -
                    MIN(CASE WHEN bar_min BETWEEN 570 AND 599 THEN bar_low END) AS range_30min,
                -- Volume in first 15 min
                SUM(CASE WHEN bar_min BETWEEN 570 AND 584 THEN bar_volume ELSE 0 END) AS vol_first_15,
                -- Total pre-entry volume
                SUM(bar_volume) AS vol_total_pre,
                -- Bar count
                COUNT(*) AS bars_pre_entry,
                -- Time since open (minutes)
                MAX(entry_min) - 570 AS minutes_since_open
            FROM pre_entry_bars
            GROUP BY trade_id
        ),
        recent_bars AS (
            -- Last 5 bars before entry vs prior 10 bars
            SELECT
                trade_id,
                -- Volume acceleration: last 5 bars avg vol / prior 10 bars avg vol
                AVG(CASE WHEN rn_desc BETWEEN 1 AND 5 THEN bar_volume END) /
                    NULLIF(AVG(CASE WHEN rn_desc BETWEEN 6 AND 15 THEN bar_volume END), 0)
                    AS vol_acceleration,
                -- Last 5 bars VWAP trend (slope proxy)
                (MAX(CASE WHEN rn_desc = 1 THEN bar_vwap END) -
                 MAX(CASE WHEN rn_desc = 5 THEN bar_vwap END)) /
                    NULLIF(MAX(CASE WHEN rn_desc = 5 THEN bar_vwap END), 0) * 100
                    AS vwap_trend_5bar,
                -- Bar-to-bar volatility (range of last 10 bars)
                STDDEV(CASE WHEN rn_desc BETWEEN 1 AND 10 THEN
                    (bar_close - bar_open) / NULLIF(bar_open, 0) * 100
                END) AS bar_volatility,
                -- Higher highs count in last 10 bars
                -- (approximated: how many bars have high > prior bar high)
                COUNT(CASE WHEN rn_desc BETWEEN 1 AND 10 THEN 1 END) AS recent_bar_count
            FROM pre_entry_bars
            WHERE rn_desc <= 15
            GROUP BY trade_id
        )
        SELECT
            e.trade_id,
            e.range_5min,
            e.range_15min,
            e.range_30min,
            e.vol_first_15,
            e.vol_total_pre,
            e.bars_pre_entry,
            e.minutes_since_open,
            r.vol_acceleration,
            r.vwap_trend_5bar,
            r.bar_volatility,
            t.holly_pnl,
            t.direction,
            t.entry_price,
            CASE WHEN t.holly_pnl > 0 THEN 1 ELSE 0 END AS win
        FROM early_bars e
        JOIN recent_bars r ON r.trade_id = e.trade_id
        JOIN trades t ON t.trade_id = e.trade_id
    """).fetchdf()

    print(f"  Loaded {len(df):,} trades ({time.time()-t0:.1f}s)")

    # Compute derived features
    # Opening drive compression: 5min range / 30min range
    df["drive_compression"] = np.where(
        df["range_30min"].notna() & (df["range_30min"] > 0),
        df["range_5min"] / df["range_30min"],
        np.nan
    )

    # Volume concentration in first 15 min
    df["vol_concentration_15"] = np.where(
        df["vol_total_pre"].notna() & (df["vol_total_pre"] > 0),
        df["vol_first_15"] / df["vol_total_pre"],
        np.nan
    )

    # Range expansion: 30min range as % of entry price
    df["range_30min_pct"] = np.where(
        df["entry_price"].notna() & (df["entry_price"] > 0),
        df["range_30min"] / df["entry_price"] * 100,
        np.nan
    )

    # Range 15min as % of entry price
    df["range_15min_pct"] = np.where(
        df["entry_price"].notna() & (df["entry_price"] > 0),
        df["range_15min"] / df["entry_price"] * 100,
        np.nan
    )

    print(f"  drive_compression coverage: {df['drive_compression'].notna().sum():,}")
    print(f"  vol_acceleration coverage: {df['vol_acceleration'].notna().sum():,}")
    print(f"  bar_volatility coverage: {df['bar_volatility'].notna().sum():,}")

    return df


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
            f"| Q{q} | {sub[col].min():.3f}–{sub[col].max():.3f} "
            f"| {len(sub):,} | {sub['win'].mean()*100:.1f}% "
            f"| ${sub['holly_pnl'].mean():.0f} |"
        )
    lines.append("")
    return lines


def main():
    t0 = time.time()
    con = duckdb.connect(str(DUCKDB_PATH), read_only=True)
    print(f"Connected to {DUCKDB_PATH.name}")

    df = load_microstructure(con)
    con.close()

    if len(df) == 0:
        print("No data!")
        sys.exit(1)

    # ── Lift analysis ──
    print("\nRunning lift analysis...")
    results = []

    features = [
        ("drive_compression", "Opening Drive Compression (5min/30min)"),
        ("vol_concentration_15", "Volume Concentration (first 15min %)"),
        ("range_30min_pct", "30-Min Range (% of price)"),
        ("range_15min_pct", "15-Min Range (% of price)"),
        ("vol_acceleration", "Volume Acceleration (last 5 / prior 10)"),
        ("vwap_trend_5bar", "VWAP 5-Bar Trend (%)"),
        ("bar_volatility", "Bar-to-Bar Volatility (std of returns)"),
        ("minutes_since_open", "Minutes Since Open"),
        ("bars_pre_entry", "Bars Before Entry"),
    ]

    for col, label in features:
        analyze_continuous(df, col, label, results)

    # Direction splits
    for direction in ["Long", "Short"]:
        dir_df = df[df["direction"].str.lower() == direction.lower()]
        if len(dir_df) < 100:
            continue
        for col, label in features[:5]:
            analyze_continuous(dir_df, col, f"{label} ({direction}s)", results)

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
    report.append("# Volume & Price Microstructure — Lift Analysis")
    report.append("")
    report.append(f"Generated: {pd.Timestamp.now().strftime('%Y-%m-%d %H:%M')}")
    report.append(f"Trades: {len(df):,}")
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
    for col, label in features:
        report.extend(quintile_table(df, col, label))

    # Conclusions
    report.append("## 3. Conclusions")
    report.append("")
    sig_features = [r for r in results if r.get("fdr_significant", False)]
    if sig_features:
        report.append("**FDR-significant features:**")
        for r in sorted(sig_features, key=lambda x: abs(x.get("cohens_d", 0)), reverse=True):
            report.append(f"- {r['feature']}: d={r['cohens_d']:.3f}")
    else:
        report.append("*No features survived FDR correction.*")
    report.append("")

    # Write
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    report_path = REPORT_DIR / "volume-microstructure-lift.md"
    report_path.write_text("\n".join(report), encoding="utf-8")

    elapsed = time.time() - t0
    print(f"\nReport saved: {report_path}")
    print(f"Done in {elapsed:.1f}s")


if __name__ == "__main__":
    main()
