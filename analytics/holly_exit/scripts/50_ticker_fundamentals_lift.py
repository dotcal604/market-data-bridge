"""
50_ticker_fundamentals_lift.py — Lift analysis on ticker fundamentals.

Tests whether company characteristics (market cap, sector/SIC, employees,
exchange, listing age) predict Holly trade outcomes.

Features tested:
  Categorical: sic_sector (2-digit SIC), primary_exchange, cap_bucket
  Continuous:  market_cap, total_employees, listing_age_years

Output: reports/ticker-fundamentals-lift.md

Usage:
    python scripts/50_ticker_fundamentals_lift.py
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
    print("Loading trades + ticker details...")
    t0 = time.time()

    df = con.execute(f"""
        SELECT
            t.trade_id, t.symbol, t.entry_time, t.entry_price,
            t.strategy, t.direction, t.holly_pnl, t.mfe, t.mae,
            CASE WHEN t.holly_pnl > 0 THEN 1 ELSE 0 END AS win,
            CAST(t.entry_time AS DATE) AS trade_date,
            td.market_cap,
            td.total_employees,
            td.primary_exchange,
            td.sic_code,
            td.sic_description,
            td.list_date,
            -- Derived: market cap bucket
            CASE
                WHEN td.market_cap IS NULL THEN 'unknown'
                WHEN td.market_cap < 300e6 THEN 'micro (<300M)'
                WHEN td.market_cap < 2e9 THEN 'small (300M-2B)'
                WHEN td.market_cap < 10e9 THEN 'mid (2B-10B)'
                WHEN td.market_cap < 200e9 THEN 'large (10B-200B)'
                ELSE 'mega (200B+)'
            END AS cap_bucket,
            -- Derived: 2-digit SIC sector
            CASE
                WHEN td.sic_code IS NULL THEN 'unknown'
                ELSE LEFT(td.sic_code, 2)
            END AS sic_sector
        FROM trades t
        LEFT JOIN ticker_details td ON td.symbol = t.symbol
        WHERE t.entry_time >= CAST('{since}' AS TIMESTAMP)
    """).fetchdf()

    # Derived: listing age in years
    if "list_date" in df.columns:
        df["list_date_parsed"] = pd.to_datetime(df["list_date"], errors="coerce")
        df["listing_age_years"] = (
            (pd.to_datetime(df["trade_date"]) - df["list_date_parsed"]).dt.days / 365.25
        )

    print(f"  Loaded {len(df):,} trades ({time.time()-t0:.1f}s)")
    has_details = df["market_cap"].notna().sum()
    print(f"  Ticker detail coverage: {has_details:,} ({has_details/len(df)*100:.1f}%)")
    return df


def cap_bucket_analysis(df: pd.DataFrame) -> tuple[list[str], list[float]]:
    lines = []
    p_values = []

    lines.append("### Market Cap Buckets")
    lines.append("")
    lines.append("| Cap Bucket | n | WR | Avg P&L | Avg MFE | Avg MAE |")
    lines.append("|------------|---|----|---------|---------|---------| ")

    bucket_order = ["micro (<300M)", "small (300M-2B)", "mid (2B-10B)",
                    "large (10B-200B)", "mega (200B+)", "unknown"]
    for bucket in bucket_order:
        sub = df[df["cap_bucket"] == bucket]
        if len(sub) >= 10:
            lines.append(
                f"| {bucket} | {len(sub):,} | {sub['win'].mean()*100:.1f}% "
                f"| ${sub['holly_pnl'].mean():.0f} "
                f"| ${sub['mfe'].mean():.0f} | ${sub['mae'].mean():.0f} |"
            )
    lines.append("")

    # Pairwise tests
    lines.append("**Pairwise tests (bucket vs rest):**")
    lines.append("")
    for bucket in bucket_order:
        if bucket == "unknown":
            continue
        this = df[df["cap_bucket"] == bucket]["holly_pnl"]
        rest = df[(df["cap_bucket"] != bucket) & (df["cap_bucket"] != "unknown")]["holly_pnl"]
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
    return lines, p_values


def exchange_analysis(df: pd.DataFrame) -> tuple[list[str], list[float]]:
    lines = []
    p_values = []

    lines.append("### Primary Exchange")
    lines.append("")

    exchanges = df["primary_exchange"].value_counts()
    lines.append("| Exchange | n | WR | Avg P&L | Avg MFE |")
    lines.append("|----------|---|----|---------|---------| ")

    for ex in exchanges.head(10).index:
        sub = df[df["primary_exchange"] == ex]
        if len(sub) >= 20:
            lines.append(
                f"| {ex} | {len(sub):,} | {sub['win'].mean()*100:.1f}% "
                f"| ${sub['holly_pnl'].mean():.0f} "
                f"| ${sub['mfe'].mean():.0f} |"
            )
    lines.append("")

    # Test top 3 exchanges vs rest
    for ex in exchanges.head(3).index:
        this = df[df["primary_exchange"] == ex]["holly_pnl"]
        rest = df[df["primary_exchange"] != ex]["holly_pnl"]
        test = welch_t_test(this, rest)
        if not np.isnan(test["p_value"]):
            p_values.append(test["p_value"])
    lines.append("")
    return lines, p_values


def sic_sector_analysis(df: pd.DataFrame) -> tuple[list[str], list[float]]:
    lines = []
    p_values = []

    lines.append("### SIC Sector (2-digit)")
    lines.append("")

    # Map 2-digit SIC to sector names
    sic_names = {
        "10": "Metal Mining", "13": "Oil & Gas", "15": "Construction",
        "20": "Food", "28": "Chemicals/Pharma", "33": "Primary Metals",
        "35": "Machinery", "36": "Electronics", "37": "Transportation Eq.",
        "38": "Instruments", "48": "Communications", "49": "Utilities",
        "50": "Wholesale Durable", "51": "Wholesale Nondurable",
        "53": "General Merch", "56": "Apparel Stores", "58": "Eating/Drinking",
        "59": "Retail Misc", "60": "Banking", "61": "Credit",
        "62": "Security Brokers", "63": "Insurance", "67": "Holding Companies",
        "73": "Business Services", "80": "Health Services",
        "87": "Engineering/Mgmt Services",
    }

    sectors = df[df["sic_sector"] != "unknown"]["sic_sector"].value_counts()
    lines.append("| SIC | Sector | n | WR | Avg P&L |")
    lines.append("|-----|--------|---|----|---------| ")

    for sic in sectors.head(15).index:
        sub = df[df["sic_sector"] == sic]
        name = sic_names.get(sic, "Other")
        if len(sub) >= 20:
            lines.append(
                f"| {sic} | {name} | {len(sub):,} | {sub['win'].mean()*100:.1f}% "
                f"| ${sub['holly_pnl'].mean():.0f} |"
            )
    lines.append("")

    # Test top 5 SIC sectors vs rest
    for sic in sectors.head(5).index:
        this = df[df["sic_sector"] == sic]["holly_pnl"]
        rest = df[df["sic_sector"] != sic]["holly_pnl"]
        test = welch_t_test(this, rest)
        if not np.isnan(test["p_value"]):
            p_values.append(test["p_value"])
    lines.append("")
    return lines, p_values


def continuous_analysis(df: pd.DataFrame) -> tuple[list[str], list[float]]:
    lines = []
    p_values = []

    features = [
        ("market_cap", "Market Cap ($)", "Higher = larger company"),
        ("total_employees", "Total Employees", "Higher = larger org"),
        ("listing_age_years", "Listing Age (years)", "Years since IPO"),
    ]

    lines.append("### Continuous Features (Median Split)")
    lines.append("")
    lines.append("| Feature | n(high) | n(low) | WR(high) | WR(low) | PnL(high) | PnL(low) | p-raw | Cohen's d | Corr(PnL) |")
    lines.append("|---------|---------|--------|----------|---------|-----------|----------|-------|-----------|-----------|")

    for col, label, desc in features:
        if col not in df.columns:
            lines.append(f"| {label} | — | — | — | — | — | — | — | — | — |")
            p_values.append(1.0)
            continue

        valid = df[df[col].notna() & np.isfinite(df[col])]
        if len(valid) < 50:
            lines.append(f"| {label} | — | — | — | — | — | — | — | — | — |")
            p_values.append(1.0)
            continue

        median = valid[col].median()
        high = valid[valid[col] >= median]
        low = valid[valid[col] < median]

        test = welch_t_test(high["holly_pnl"], low["holly_pnl"])
        corr, corr_p = stats.spearmanr(valid[col], valid["holly_pnl"])

        p_values.append(test["p_value"] if not np.isnan(test["p_value"]) else 1.0)

        wr_h = f"{high['win'].mean()*100:.1f}%"
        wr_l = f"{low['win'].mean()*100:.1f}%"
        p_raw = f"{test['p_value']:.4f}" if not np.isnan(test["p_value"]) else "—"
        cd = f"{test['cohens_d']:.3f}" if not np.isnan(test.get("cohens_d", np.nan)) else "—"

        lines.append(
            f"| {label} (med={median:,.0f}) | {len(high):,} | {len(low):,} "
            f"| {wr_h} | {wr_l} "
            f"| ${high['holly_pnl'].mean():.0f} | ${low['holly_pnl'].mean():.0f} "
            f"| {p_raw} | {cd} | {corr:.3f} (p={corr_p:.4f}) |"
        )

    lines.append("")
    return lines, p_values


def strategy_cap_interaction(df: pd.DataFrame) -> list[str]:
    lines = []
    lines.append("### Strategy x Cap Bucket (top 5)")
    lines.append("")

    top_strats = df["strategy"].value_counts().head(5).index.tolist()

    for strat in top_strats:
        sdf = df[df["strategy"] == strat]
        lines.append(f"**{strat}** (n={len(sdf):,})")
        lines.append("")
        lines.append("| Cap Bucket | n | WR | Avg P&L |")
        lines.append("|------------|---|----|---------| ")

        for bucket in ["micro (<300M)", "small (300M-2B)", "mid (2B-10B)",
                        "large (10B-200B)", "mega (200B+)"]:
            sub = sdf[sdf["cap_bucket"] == bucket]
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
    report.append("# Ticker Fundamentals Lift Analysis")
    report.append("")
    report.append(f"Generated: {pd.Timestamp.now().strftime('%Y-%m-%d %H:%M')}")
    report.append(f"Trades: {len(df):,} (since {args.since})")
    report.append(f"Detail coverage: {df['market_cap'].notna().sum():,} ({df['market_cap'].notna().mean()*100:.1f}%)")
    report.append("")
    report.append("---")
    report.append("")

    # Section 1: Cap buckets
    report.append("## 1. Market Cap Buckets")
    report.append("")
    cap_lines, cap_p = cap_bucket_analysis(df)
    report.extend(cap_lines)
    all_p_values.extend(cap_p)
    all_labels.extend(["cap:micro", "cap:small", "cap:mid", "cap:large", "cap:mega"])

    # Section 2: Exchange
    report.append("## 2. Primary Exchange")
    report.append("")
    ex_lines, ex_p = exchange_analysis(df)
    report.extend(ex_lines)
    all_p_values.extend(ex_p)
    all_labels.extend([f"exchange:{i}" for i in range(len(ex_p))])

    # Section 3: SIC sector
    report.append("## 3. SIC Sector")
    report.append("")
    sic_lines, sic_p = sic_sector_analysis(df)
    report.extend(sic_lines)
    all_p_values.extend(sic_p)
    all_labels.extend([f"sic:{i}" for i in range(len(sic_p))])

    # Section 4: Continuous
    report.append("## 4. Continuous Fundamentals")
    report.append("")
    cont_lines, cont_p = continuous_analysis(df)
    report.extend(cont_lines)
    all_p_values.extend(cont_p)
    all_labels.extend(["market_cap", "employees", "listing_age"])

    # Section 5: Strategy x Cap
    report.append("## 5. Strategy x Market Cap Interaction")
    report.append("")
    report.extend(strategy_cap_interaction(df))

    # Section 6: FDR
    report.append("## 6. FDR-Corrected Summary")
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
    report_path = REPORT_DIR / "ticker-fundamentals-lift.md"
    report_path.write_text("\n".join(report), encoding="utf-8")

    elapsed = time.time() - t0
    print(f"\nReport saved: {report_path}")
    print(f"  Tests: {len(all_p_values)}, Significant: {len(sig_results)}")
    print(f"Done in {elapsed:.1f}s")
    con.close()


if __name__ == "__main__":
    main()
