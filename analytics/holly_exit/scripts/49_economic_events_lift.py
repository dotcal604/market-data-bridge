"""
49_economic_events_lift.py — Lift analysis on macro economic events.

Tests whether FOMC, NFP, and other major economic events affect Holly trade
outcomes. Uses economic_event_flags table + fred_macro_daily for VIX/yield context.

Features tested:
  - is_fomc_day: binary (FOMC announcement day)
  - is_nfp_day: binary (Non-Farm Payrolls release day)
  - is_any_event: binary (any major economic event)
  - vix_level: continuous (VIX at trade entry, from fred_macro_daily)
  - yield_spread_10y2y: continuous (10y-2y Treasury spread)
  - vix_bucket: categorical (low/normal/high/extreme)

Output: reports/economic-events-lift.md

Usage:
    python scripts/49_economic_events_lift.py
    python scripts/49_economic_events_lift.py --since 2021-01-01
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
    """Load trades joined with economic event flags and macro context."""
    print("Loading trades + economic events + macro data...")
    t0 = time.time()

    # Check which tables exist
    tables = [r[0] for r in con.execute(
        "SELECT table_name FROM information_schema.tables"
    ).fetchall()]

    has_events = "economic_event_flags" in tables
    has_fred = "fred_macro_daily" in tables

    print(f"  economic_event_flags: {'YES' if has_events else 'NO'}")
    print(f"  fred_macro_daily: {'YES' if has_fred else 'NO'}")

    # Build the JOIN clause dynamically
    event_cols = ""
    event_join = ""
    if has_events:
        event_cols = """
            , COALESCE(ef.is_fomc_day, 0) AS is_fomc_day
            , COALESCE(ef.is_nfp_day, 0) AS is_nfp_day
            , COALESCE(ef.is_event_day, 0) AS is_any_event
        """
        event_join = """
            LEFT JOIN economic_event_flags ef
              ON ef.date = CAST(t.entry_time AS DATE)
        """

    fred_cols = ""
    fred_join = ""
    if has_fred:
        fred_cols = """
            , fm.vix
            , fm.yield_spread_10y2y
            , fm.put_call_equity
        """
        fred_join = """
            LEFT JOIN fred_macro_daily fm
              ON fm.date = CAST(t.entry_time AS DATE)
        """

    df = con.execute(f"""
        SELECT
            t.trade_id, t.symbol, t.entry_time, t.entry_price,
            t.strategy, t.direction, t.holly_pnl, t.mfe, t.mae,
            CASE WHEN t.holly_pnl > 0 THEN 1 ELSE 0 END AS win,
            EXTRACT(HOUR FROM t.entry_time) AS entry_hour,
            CAST(t.entry_time AS DATE) AS trade_date
            {event_cols}
            {fred_cols}
        FROM trades t
        {event_join}
        {fred_join}
        WHERE t.entry_time >= CAST('{since}' AS TIMESTAMP)
    """).fetchdf()

    # Derive VIX bucket
    if "vix" in df.columns:
        df["vix_bucket"] = pd.cut(
            df["vix"],
            bins=[0, 15, 20, 30, 100],
            labels=["low (<15)", "normal (15-20)", "high (20-30)", "extreme (30+)"],
            right=True
        )
    else:
        df["vix_bucket"] = "unknown"

    print(f"  Loaded {len(df):,} trades ({time.time()-t0:.1f}s)")
    return df


def event_analysis(df: pd.DataFrame) -> tuple[list[str], list[float]]:
    """Analyze binary event flags."""
    lines = []
    p_values = []

    features = [
        ("is_fomc_day", "FOMC Day"),
        ("is_nfp_day", "NFP Day"),
        ("is_any_event", "Any Macro Event"),
    ]

    lines.append("### Economic Event Flags")
    lines.append("")
    lines.append("| Event | n(yes) | n(no) | WR(yes) | WR(no) | PnL(yes) | PnL(no) | MFE(yes) | MFE(no) | p-raw | Cohen's d |")
    lines.append("|-------|--------|-------|---------|--------|----------|---------|----------|---------|-------|-----------|")

    for col, label in features:
        if col not in df.columns:
            lines.append(f"| {label} | — | — | — | — | — | — | — | — | — | — |")
            p_values.append(1.0)
            continue

        yes = df[df[col] == 1]
        no = df[df[col] == 0]
        test = welch_t_test(yes["holly_pnl"], no["holly_pnl"])

        p_raw = f"{test['p_value']:.4f}" if not np.isnan(test["p_value"]) else "—"
        cd = f"{test['cohens_d']:.3f}" if not np.isnan(test.get("cohens_d", np.nan)) else "—"
        wr_y = f"{yes['win'].mean()*100:.1f}%" if len(yes) > 0 else "—"
        wr_n = f"{no['win'].mean()*100:.1f}%" if len(no) > 0 else "—"

        p_values.append(test["p_value"] if not np.isnan(test["p_value"]) else 1.0)

        lines.append(
            f"| {label} | {len(yes):,} | {len(no):,} "
            f"| {wr_y} | {wr_n} "
            f"| ${yes['holly_pnl'].mean():.0f} | ${no['holly_pnl'].mean():.0f} "
            f"| ${yes['mfe'].mean():.0f} | ${no['mfe'].mean():.0f} "
            f"| {p_raw} | {cd} |"
        )

    lines.append("")
    return lines, p_values


def vix_analysis(df: pd.DataFrame) -> tuple[list[str], list[float]]:
    """Analyze VIX level impact."""
    lines = []
    p_values = []

    if "vix" not in df.columns or df["vix"].isna().all():
        lines.append("### VIX Analysis")
        lines.append("")
        lines.append("*No VIX data available (fred_macro_daily table missing or empty)*")
        lines.append("")
        return lines, []

    lines.append("### VIX Level Impact")
    lines.append("")

    # Categorical: VIX bucket
    lines.append("**By VIX Bucket:**")
    lines.append("")
    lines.append("| VIX Bucket | n | WR | Avg P&L | Avg MFE | Avg MAE |")
    lines.append("|------------|---|----|---------|---------|---------| ")

    for bucket in ["low (<15)", "normal (15-20)", "high (20-30)", "extreme (30+)"]:
        sub = df[df["vix_bucket"] == bucket]
        if len(sub) >= 10:
            lines.append(
                f"| {bucket} | {len(sub):,} | {sub['win'].mean()*100:.1f}% "
                f"| ${sub['holly_pnl'].mean():.0f} "
                f"| ${sub['mfe'].mean():.0f} | ${sub['mae'].mean():.0f} |"
            )
    lines.append("")

    # Pairwise: each VIX bucket vs rest
    lines.append("**Pairwise tests (bucket vs rest):**")
    lines.append("")
    for bucket in ["low (<15)", "normal (15-20)", "high (20-30)", "extreme (30+)"]:
        this = df[df["vix_bucket"] == bucket]["holly_pnl"]
        rest = df[df["vix_bucket"] != bucket]["holly_pnl"]
        test = welch_t_test(this, rest)
        if not np.isnan(test["p_value"]):
            p_values.append(test["p_value"])
            lines.append(
                f"- **{bucket}** vs rest: p={test['p_value']:.4f}, "
                f"d={test['cohens_d']:.3f}, "
                f"${test['mean_a']:.0f} vs ${test['mean_b']:.0f}"
            )
        else:
            p_values.append(1.0)
            lines.append(f"- **{bucket}** vs rest: insufficient data (n={test['n_a']})")
    lines.append("")

    # Continuous: Spearman correlation
    valid = df[df["vix"].notna() & np.isfinite(df["vix"])]
    if len(valid) >= 50:
        corr, corr_p = stats.spearmanr(valid["vix"], valid["holly_pnl"])
        lines.append(f"**Spearman correlation (VIX vs P&L):** r={corr:.3f}, p={corr_p:.4f}")
        lines.append("")

    return lines, p_values


def yield_analysis(df: pd.DataFrame) -> tuple[list[str], list[float]]:
    """Analyze yield spread impact."""
    lines = []
    p_values = []

    if "yield_spread_10y2y" not in df.columns or df["yield_spread_10y2y"].isna().all():
        lines.append("### Yield Spread Analysis")
        lines.append("")
        lines.append("*No yield spread data available*")
        lines.append("")
        return lines, []

    lines.append("### Yield Spread (10Y-2Y) Impact")
    lines.append("")

    valid = df[df["yield_spread_10y2y"].notna() & np.isfinite(df["yield_spread_10y2y"])]
    if len(valid) < 50:
        lines.append("*Insufficient data for yield spread analysis*")
        lines.append("")
        return lines, []

    # Bucket: inverted (<0), flat (0-0.5), normal (0.5-1.5), steep (>1.5)
    valid = valid.copy()
    valid["yield_bucket"] = pd.cut(
        valid["yield_spread_10y2y"],
        bins=[-10, 0, 0.5, 1.5, 10],
        labels=["inverted (<0)", "flat (0-0.5)", "normal (0.5-1.5)", "steep (>1.5)"],
        right=True
    )

    lines.append("| Yield Curve | n | WR | Avg P&L | Avg MFE |")
    lines.append("|-------------|---|----|---------|---------| ")

    for bucket in ["inverted (<0)", "flat (0-0.5)", "normal (0.5-1.5)", "steep (>1.5)"]:
        sub = valid[valid["yield_bucket"] == bucket]
        if len(sub) >= 10:
            lines.append(
                f"| {bucket} | {len(sub):,} | {sub['win'].mean()*100:.1f}% "
                f"| ${sub['holly_pnl'].mean():.0f} "
                f"| ${sub['mfe'].mean():.0f} |"
            )
    lines.append("")

    # Pairwise tests
    for bucket in ["inverted (<0)", "flat (0-0.5)", "normal (0.5-1.5)", "steep (>1.5)"]:
        this = valid[valid["yield_bucket"] == bucket]["holly_pnl"]
        rest = valid[valid["yield_bucket"] != bucket]["holly_pnl"]
        test = welch_t_test(this, rest)
        if not np.isnan(test["p_value"]):
            p_values.append(test["p_value"])

    # Spearman
    corr, corr_p = stats.spearmanr(valid["yield_spread_10y2y"], valid["holly_pnl"])
    lines.append(f"**Spearman correlation (yield spread vs P&L):** r={corr:.3f}, p={corr_p:.4f}")
    lines.append("")

    return lines, p_values


def strategy_event_interaction(df: pd.DataFrame) -> list[str]:
    """Top 5 strategies: performance on FOMC/NFP days."""
    lines = []
    lines.append("### Strategy x Event Day Interaction (top 5)")
    lines.append("")

    if "is_fomc_day" not in df.columns:
        lines.append("*No event data available*")
        lines.append("")
        return lines

    top_strats = df["strategy"].value_counts().head(5).index.tolist()

    for strat in top_strats:
        sdf = df[df["strategy"] == strat]
        lines.append(f"**{strat}** (n={len(sdf):,})")
        lines.append("")
        lines.append("| Context | n | WR | Avg P&L |")
        lines.append("|---------|---|----|---------| ")

        for label, mask in [
            ("FOMC day", sdf["is_fomc_day"] == 1),
            ("NFP day", sdf["is_nfp_day"] == 1),
            ("No event", sdf["is_any_event"] == 0),
        ]:
            sub = sdf[mask]
            if len(sub) >= 5:
                lines.append(
                    f"| {label} | {len(sub):,} | {sub['win'].mean()*100:.1f}% "
                    f"| ${sub['holly_pnl'].mean():.0f} |"
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
    report.append("# Economic Events & Macro Context Lift Analysis")
    report.append("")
    report.append(f"Generated: {pd.Timestamp.now().strftime('%Y-%m-%d %H:%M')}")
    report.append(f"Trades: {len(df):,} (since {args.since})")
    report.append(f"Date range: {df['trade_date'].min()} to {df['trade_date'].max()}")

    if "is_fomc_day" in df.columns:
        fomc_n = (df["is_fomc_day"] == 1).sum()
        nfp_n = (df["is_nfp_day"] == 1).sum()
        event_n = (df["is_any_event"] == 1).sum()
        report.append(f"FOMC day trades: {fomc_n:,} | NFP day trades: {nfp_n:,} | Any event: {event_n:,}")

    if "vix" in df.columns:
        vix_valid = df["vix"].notna().sum()
        report.append(f"VIX data coverage: {vix_valid:,} trades ({vix_valid/len(df)*100:.1f}%)")

    report.append("")
    report.append("---")
    report.append("")

    # Section 1: Event flags
    report.append("## 1. Economic Event Flags")
    report.append("")
    evt_lines, evt_p = event_analysis(df)
    report.extend(evt_lines)
    all_p_values.extend(evt_p)
    all_labels.extend(["FOMC", "NFP", "any_event"])

    # Section 2: VIX
    report.append("## 2. VIX Level Impact")
    report.append("")
    vix_lines, vix_p = vix_analysis(df)
    report.extend(vix_lines)
    all_p_values.extend(vix_p)
    all_labels.extend([f"vix:{b}" for b in ["low", "normal", "high", "extreme"]][:len(vix_p)])

    # Section 3: Yield spread
    report.append("## 3. Yield Curve Impact")
    report.append("")
    yield_lines, yield_p = yield_analysis(df)
    report.extend(yield_lines)
    all_p_values.extend(yield_p)
    all_labels.extend([f"yield:{b}" for b in ["inverted", "flat", "normal", "steep"]][:len(yield_p)])

    # Section 4: Strategy interaction
    report.append("## 4. Strategy x Event Day Interaction")
    report.append("")
    report.extend(strategy_event_interaction(df))

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
    report_path = REPORT_DIR / "economic-events-lift.md"
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
