"""
48_earnings_proximity_lift.py — Lift analysis on earnings calendar proximity.

Tests whether trading near earnings events (before, during, after) predicts
Holly trade outcomes. Uses BH-FDR correction for multiple comparisons.

Features tested:
  - earnings_proximity: earnings_day / pre_3d / post_3d / normal
  - earnings_days_since: continuous (days since last earnings)
  - earnings_days_until: continuous (days until next earnings)
  - is_earnings_day: binary (entry on earnings report day)
  - earnings_week: binary (within 5 trading days of earnings)

Output: reports/earnings-proximity-lift.md

Usage:
    python scripts/48_earnings_proximity_lift.py
    python scripts/48_earnings_proximity_lift.py --since 2021-01-01
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
    """Load trades joined with earnings calendar proximity."""
    print("Loading trades + earnings calendar...")
    t0 = time.time()

    df = con.execute(f"""
        WITH trade_dates AS (
            SELECT
                t.trade_id, t.symbol, t.entry_time, t.entry_price,
                t.strategy, t.direction, t.holly_pnl, t.mfe, t.mae,
                t.stop_price, t.exit_price,
                CASE WHEN t.holly_pnl > 0 THEN 1 ELSE 0 END AS win,
                EXTRACT(HOUR FROM t.entry_time) AS entry_hour,
                CAST(t.entry_time AS DATE) AS trade_date
            FROM trades t
            WHERE t.entry_time >= CAST('{since}' AS TIMESTAMP)
        ),
        with_earnings AS (
            SELECT
                td.*,
                -- Most recent earnings on or before trade date
                (SELECT MAX(earnings_date)
                 FROM earnings_calendar ec
                 WHERE ec.symbol = td.symbol
                   AND ec.earnings_date <= td.trade_date
                ) AS prev_earnings_date,
                -- Next earnings after trade date
                (SELECT MIN(earnings_date)
                 FROM earnings_calendar ec
                 WHERE ec.symbol = td.symbol
                   AND ec.earnings_date > td.trade_date
                ) AS next_earnings_date
            FROM trade_dates td
        )
        SELECT *,
            -- Days since last earnings (NULL if no earnings history)
            DATEDIFF('day', prev_earnings_date, trade_date) AS earnings_days_since,
            -- Days until next earnings (NULL if no future earnings)
            DATEDIFF('day', trade_date, next_earnings_date) AS earnings_days_until,
            -- Binary: is this an earnings day?
            CASE WHEN prev_earnings_date = trade_date THEN 1 ELSE 0 END AS is_earnings_day,
            -- Proximity bucket
            CASE
                WHEN prev_earnings_date = trade_date THEN 'earnings_day'
                WHEN DATEDIFF('day', trade_date, next_earnings_date) BETWEEN 1 AND 3
                    THEN 'pre_earnings_3d'
                WHEN DATEDIFF('day', prev_earnings_date, trade_date) BETWEEN 1 AND 3
                    THEN 'post_earnings_3d'
                ELSE 'normal'
            END AS earnings_proximity,
            -- Within 5 trading days of earnings (either side)?
            CASE
                WHEN DATEDIFF('day', prev_earnings_date, trade_date) <= 5
                  OR DATEDIFF('day', trade_date, next_earnings_date) <= 5
                THEN 1 ELSE 0
            END AS earnings_week
        FROM with_earnings
    """).fetchdf()

    print(f"  Loaded {len(df):,} trades with earnings context ({time.time()-t0:.1f}s)")

    # Coverage stats
    has_prev = df["prev_earnings_date"].notna().sum()
    has_next = df["next_earnings_date"].notna().sum()
    print(f"  Earnings coverage: {has_prev:,} have prev earnings, {has_next:,} have next earnings")

    return df


def proximity_analysis(df: pd.DataFrame) -> tuple[list[str], list[float]]:
    """Analyze earnings proximity categories."""
    lines = []
    p_values = []

    lines.append("### Earnings Proximity Buckets")
    lines.append("")
    lines.append("| Proximity | n | WR | Avg P&L | Avg MFE | Avg MAE |")
    lines.append("|-----------|---|----|---------|---------|---------| ")

    for cat in ["earnings_day", "pre_earnings_3d", "post_earnings_3d", "normal"]:
        sub = df[df["earnings_proximity"] == cat]
        if len(sub) > 0:
            lines.append(
                f"| {cat} | {len(sub):,} | {sub['win'].mean()*100:.1f}% "
                f"| ${sub['holly_pnl'].mean():.0f} "
                f"| ${sub['mfe'].mean():.0f} | ${sub['mae'].mean():.0f} |"
            )

    lines.append("")

    # Pairwise t-tests: each bucket vs rest
    lines.append("**Pairwise tests (bucket vs rest):**")
    lines.append("")
    for cat in ["earnings_day", "pre_earnings_3d", "post_earnings_3d"]:
        this = df[df["earnings_proximity"] == cat]["holly_pnl"]
        rest = df[df["earnings_proximity"] != cat]["holly_pnl"]
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


def binary_feature_analysis(df: pd.DataFrame) -> tuple[list[str], list[float]]:
    """Analyze binary earnings features."""
    lines = []
    p_values = []

    features = [
        ("is_earnings_day", "Earnings Day", "Entry on earnings report day"),
        ("earnings_week", "Earnings Week", "Within 5 days of earnings (either side)"),
    ]

    lines.append("### Binary Features")
    lines.append("")
    lines.append("| Feature | n(yes) | n(no) | WR(yes) | WR(no) | PnL(yes) | PnL(no) | p-raw | Cohen's d |")
    lines.append("|---------|--------|-------|---------|--------|----------|---------|-------|-----------|")

    for col, label, desc in features:
        yes = df[df[col] == 1]
        no = df[df[col] == 0]
        test = welch_t_test(yes["holly_pnl"], no["holly_pnl"])

        p_raw = f"{test['p_value']:.4f}" if not np.isnan(test["p_value"]) else "—"
        cd = f"{test['cohens_d']:.3f}" if not np.isnan(test.get("cohens_d", np.nan)) else "—"
        wr_y = f"{yes['win'].mean()*100:.1f}%" if len(yes) > 0 else "—"
        wr_n = f"{no['win'].mean()*100:.1f}%" if len(no) > 0 else "—"
        pnl_y = f"${yes['holly_pnl'].mean():.0f}" if len(yes) > 0 else "—"
        pnl_n = f"${no['holly_pnl'].mean():.0f}" if len(no) > 0 else "—"

        p_values.append(test["p_value"] if not np.isnan(test["p_value"]) else 1.0)

        lines.append(
            f"| {label} | {len(yes):,} | {len(no):,} "
            f"| {wr_y} | {wr_n} "
            f"| {pnl_y} | {pnl_n} "
            f"| {p_raw} | {cd} |"
        )

    lines.append("")
    return lines, p_values


def continuous_analysis(df: pd.DataFrame) -> tuple[list[str], list[float]]:
    """Analyze continuous earnings distance features via median split."""
    lines = []
    p_values = []

    features = [
        ("earnings_days_since", "Days Since Earnings", "Days since most recent earnings"),
        ("earnings_days_until", "Days Until Earnings", "Days until next earnings"),
    ]

    lines.append("### Continuous Features (Median Split)")
    lines.append("")
    lines.append("| Feature | n(close) | n(far) | WR(close) | WR(far) | PnL(close) | PnL(far) | p-raw | Cohen's d | Corr(PnL) |")
    lines.append("|---------|----------|--------|-----------|---------|------------|----------|-------|-----------|-----------|")

    for col, label, desc in features:
        valid = df[df[col].notna() & np.isfinite(df[col])]
        if len(valid) < 50:
            lines.append(f"| {label} | — | — | — | — | — | — | — | — | — |")
            p_values.append(1.0)
            continue

        median = valid[col].median()
        close = valid[valid[col] <= median]  # closer to earnings
        far = valid[valid[col] > median]     # farther from earnings

        test = welch_t_test(close["holly_pnl"], far["holly_pnl"])
        corr, corr_p = stats.spearmanr(valid[col], valid["holly_pnl"])

        p_values.append(test["p_value"] if not np.isnan(test["p_value"]) else 1.0)

        wr_c = f"{close['win'].mean()*100:.1f}%"
        wr_f = f"{far['win'].mean()*100:.1f}%"
        p_raw = f"{test['p_value']:.4f}" if not np.isnan(test["p_value"]) else "—"
        cd = f"{test['cohens_d']:.3f}" if not np.isnan(test.get("cohens_d", np.nan)) else "—"

        lines.append(
            f"| {label} (median={median:.0f}d) | {len(close):,} | {len(far):,} "
            f"| {wr_c} | {wr_f} "
            f"| ${close['holly_pnl'].mean():.0f} | ${far['holly_pnl'].mean():.0f} "
            f"| {p_raw} | {cd} | {corr:.3f} (p={corr_p:.4f}) |"
        )

    lines.append("")
    return lines, p_values


def strategy_interaction(df: pd.DataFrame) -> list[str]:
    """Check if earnings effect varies by strategy (top 5)."""
    lines = []
    lines.append("### Strategy x Earnings Interaction (top 5)")
    lines.append("")

    top_strats = df["strategy"].value_counts().head(5).index.tolist()

    for strat in top_strats:
        sdf = df[df["strategy"] == strat]
        lines.append(f"**{strat}** (n={len(sdf):,})")
        lines.append("")
        lines.append("| Proximity | n | WR | Avg P&L |")
        lines.append("|-----------|---|----|---------| ")

        for prox in ["earnings_day", "pre_earnings_3d", "post_earnings_3d", "normal"]:
            sub = sdf[sdf["earnings_proximity"] == prox]
            if len(sub) >= 5:
                lines.append(
                    f"| {prox} | {len(sub):,} | {sub['win'].mean()*100:.1f}% "
                    f"| ${sub['holly_pnl'].mean():.0f} |"
                )
        lines.append("")

    return lines


def direction_earnings(df: pd.DataFrame) -> list[str]:
    """Long vs short performance by earnings proximity."""
    lines = []
    lines.append("### Direction x Earnings Proximity")
    lines.append("")
    lines.append("| Direction | Proximity | n | WR | Avg P&L | Avg MFE |")
    lines.append("|-----------|-----------|---|----|---------|---------| ")

    for direction in ["long", "short"]:
        ddf = df[df["direction"] == direction]
        for prox in ["earnings_day", "pre_earnings_3d", "post_earnings_3d", "normal"]:
            sub = ddf[ddf["earnings_proximity"] == prox]
            if len(sub) >= 10:
                lines.append(
                    f"| {direction} | {prox} | {len(sub):,} "
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

    # Check earnings_calendar exists
    tables = [r[0] for r in con.execute(
        "SELECT table_name FROM information_schema.tables"
    ).fetchall()]
    if "earnings_calendar" not in tables:
        print("ERROR: earnings_calendar table not found.")
        sys.exit(1)

    ec_count = con.execute("SELECT COUNT(*) FROM earnings_calendar").fetchone()[0]
    ec_symbols = con.execute("SELECT COUNT(DISTINCT symbol) FROM earnings_calendar").fetchone()[0]
    print(f"  earnings_calendar: {ec_count:,} events, {ec_symbols:,} symbols")

    df = load_data(con, args.since)

    if len(df) == 0:
        print("No data found!")
        sys.exit(1)

    # Collect all p-values for FDR
    all_p_values = []
    all_labels = []

    # Build report
    report = []
    report.append("# Earnings Proximity Lift Analysis")
    report.append("")
    report.append(f"Generated: {pd.Timestamp.now().strftime('%Y-%m-%d %H:%M')}")
    report.append(f"Trades: {len(df):,} (since {args.since})")
    report.append(f"Date range: {df['trade_date'].min()} to {df['trade_date'].max()}")

    # Coverage
    has_earnings = (df["earnings_proximity"] != "normal").sum()
    report.append(f"Trades near earnings: {has_earnings:,} ({has_earnings/len(df)*100:.1f}%)")
    report.append(f"Earnings day trades: {(df['is_earnings_day'] == 1).sum():,}")
    report.append("")
    report.append("---")
    report.append("")

    # Section 1: Proximity buckets
    report.append("## 1. Earnings Proximity Buckets")
    report.append("")
    prox_lines, prox_p = proximity_analysis(df)
    report.extend(prox_lines)
    all_p_values.extend(prox_p)
    all_labels.extend(["earnings_day", "pre_earnings_3d", "post_earnings_3d"])

    # Section 2: Binary features
    report.append("## 2. Binary Features")
    report.append("")
    bin_lines, bin_p = binary_feature_analysis(df)
    report.extend(bin_lines)
    all_p_values.extend(bin_p)
    all_labels.extend(["is_earnings_day", "earnings_week"])

    # Section 3: Continuous features
    report.append("## 3. Continuous Distance Features")
    report.append("")
    cont_lines, cont_p = continuous_analysis(df)
    report.extend(cont_lines)
    all_p_values.extend(cont_p)
    all_labels.extend(["earnings_days_since", "earnings_days_until"])

    # Section 4: Direction x Earnings
    report.append("## 4. Direction x Earnings Interaction")
    report.append("")
    report.extend(direction_earnings(df))

    # Section 5: Strategy x Earnings
    report.append("## 5. Strategy x Earnings Interaction")
    report.append("")
    report.extend(strategy_interaction(df))

    # Section 6: FDR summary
    report.append("## 6. FDR-Corrected Summary (All Tests)")
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
    report_path = REPORT_DIR / "earnings-proximity-lift.md"
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
