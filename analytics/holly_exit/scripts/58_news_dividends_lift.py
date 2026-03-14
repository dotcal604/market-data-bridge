"""
58_news_dividends_lift.py — News volume, dividend proximity, and
related-companies context lift analysis.

Joins trades against:
  1. news table (783K rows) — Polygon news volume in 24h/7d before trade
  2. dividends (1.96M rows) — proximity to ex-dividend dates
  3. related_companies (10K rows) — whether symbol has related companies data

Output: reports/news-dividends-lift.md

Usage:
    python scripts/58_news_dividends_lift.py
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


def fdr_correction(p_values: list[float], alpha: float = 0.1) -> list[float]:
    n = len(p_values)
    if n == 0:
        return []
    sorted_indices = np.argsort(p_values)
    sorted_pvals = np.array(p_values)[sorted_indices]
    adjusted = np.zeros(n)
    for i in range(n - 1, -1, -1):
        if i == n - 1:
            adjusted[i] = sorted_pvals[i]
        else:
            adjusted[i] = min(adjusted[i + 1],
                              sorted_pvals[i] * n / (i + 1))
    result = np.zeros(n)
    result[sorted_indices] = adjusted
    return result.tolist()


def compute_features(con: duckdb.DuckDBPyConnection) -> pd.DataFrame:
    """Compute news, dividend, and related company features."""
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

    # ── 1. News volume (Polygon news) ──
    # Explode tickers column and join — more efficient than LIKE
    print("Computing news volume per symbol per day...")
    news_daily = con.execute("""
        WITH exploded AS (
            SELECT
                TRIM(ticker) AS ticker,
                CAST(published_utc AS DATE) AS news_date,
                ticker_count
            FROM news,
            UNNEST(STRING_SPLIT(tickers, ',')) AS t(ticker)
            WHERE tickers IS NOT NULL AND tickers != ''
        ),
        daily_counts AS (
            SELECT
                ticker,
                news_date,
                COUNT(*) AS news_count,
                AVG(ticker_count) AS avg_ticker_breadth
            FROM exploded
            GROUP BY ticker, news_date
        )
        SELECT
            t.trade_id,
            COALESCE(SUM(CASE WHEN dc.news_date >= CAST(t.entry_time AS DATE) - 1
                         THEN dc.news_count END), 0) AS news_1d,
            COALESCE(SUM(CASE WHEN dc.news_date >= CAST(t.entry_time AS DATE) - 7
                         THEN dc.news_count END), 0) AS news_7d,
            COALESCE(SUM(CASE WHEN dc.news_date >= CAST(t.entry_time AS DATE) - 30
                         THEN dc.news_count END), 0) AS news_30d,
            COALESCE(MAX(dc.avg_ticker_breadth), 0) AS avg_breadth
        FROM trades t
        LEFT JOIN daily_counts dc
            ON dc.ticker = t.symbol
            AND dc.news_date BETWEEN CAST(t.entry_time AS DATE) - 30
                AND CAST(t.entry_time AS DATE)
        GROUP BY t.trade_id
    """).fetchdf()
    has_news = (news_daily["news_7d"] > 0).sum()
    print(f"  {has_news:,} trades with news in prior 7 days")

    # ── 2. Dividend proximity ──
    print("Computing dividend proximity...")
    div_df = con.execute("""
        WITH div_nearest AS (
            SELECT
                t.trade_id,
                d.ex_dividend_date,
                d.cash_amount,
                d.frequency,
                ABS(DATEDIFF('day',
                    CAST(d.ex_dividend_date AS DATE),
                    CAST(t.entry_time AS DATE)
                )) AS days_to_exdiv,
                SIGN(DATEDIFF('day',
                    CAST(d.ex_dividend_date AS DATE),
                    CAST(t.entry_time AS DATE)
                )) AS direction_sign,
                ROW_NUMBER() OVER (
                    PARTITION BY t.trade_id
                    ORDER BY ABS(DATEDIFF('day',
                        CAST(d.ex_dividend_date AS DATE),
                        CAST(t.entry_time AS DATE)
                    ))
                ) AS rn
            FROM trades t
            JOIN dividends d ON d.ticker = t.symbol
            WHERE d.cash_amount > 0
                AND CAST(d.ex_dividend_date AS DATE) BETWEEN
                    CAST(t.entry_time AS DATE) - 60
                    AND CAST(t.entry_time AS DATE) + 60
        )
        SELECT
            trade_id,
            days_to_exdiv,
            direction_sign,
            cash_amount AS div_amount,
            frequency AS div_frequency
        FROM div_nearest
        WHERE rn = 1
    """).fetchdf()
    print(f"  {len(div_df):,} trades with dividend within 60 days")

    # ── 3. Has related companies ──
    print("Checking related companies...")
    related = con.execute("""
        SELECT
            t.trade_id,
            COUNT(DISTINCT r.related_ticker) AS num_related
        FROM trades t
        LEFT JOIN related_companies r ON r.symbol = t.symbol
        GROUP BY t.trade_id
    """).fetchdf()
    related["has_related"] = (related["num_related"] > 0).astype(int)
    has_related = related["has_related"].sum()
    print(f"  {has_related:,} trades with related companies data")

    # ── 4. Is dividend payer ──
    print("Checking dividend payer status...")
    div_payer = con.execute("""
        SELECT
            t.trade_id,
            CASE WHEN COUNT(d.ticker) > 0 THEN 1 ELSE 0 END AS is_div_payer
        FROM trades t
        LEFT JOIN dividends d ON d.ticker = t.symbol AND d.cash_amount > 0
        GROUP BY t.trade_id
    """).fetchdf()
    print(f"  {div_payer['is_div_payer'].sum():,} trades on dividend-paying stocks")

    # ── Merge ──
    print("Merging all features...")
    df = trades.copy()
    df = df.merge(news_daily, on="trade_id", how="left")
    df = df.merge(div_df, on="trade_id", how="left")
    df = df.merge(related[["trade_id", "num_related", "has_related"]],
                   on="trade_id", how="left")
    df = df.merge(div_payer, on="trade_id", how="left")

    elapsed = time.time() - t0
    print(f"Features computed in {elapsed:.1f}s")
    return df


def bucket_analysis(df, col, bucket_col, pnl_col="holly_pnl"):
    rows = []
    for bucket, grp in df.groupby(bucket_col):
        rows.append({
            "Bucket": bucket,
            "n": len(grp),
            "WR": f"{grp['win'].mean() * 100:.1f}%",
            "Avg P&L": f"${grp[pnl_col].mean():.0f}",
            "Avg MFE": f"${grp['mfe'].mean():.0f}" if "mfe" in grp else "N/A",
            "Avg MAE": f"${grp['mae'].mean():.0f}" if "mae" in grp else "N/A",
        })
    return pd.DataFrame(rows)


def generate_report(df: pd.DataFrame) -> str:
    lines = []
    lines.append("# News Volume, Dividend Proximity & Related Companies Lift")
    lines.append("")
    lines.append(f"Generated: {pd.Timestamp.now().strftime('%Y-%m-%d %H:%M')}")
    lines.append(f"Trades: {len(df):,}")

    has_news = (df["news_7d"] > 0).sum()
    has_div = df["days_to_exdiv"].notna().sum()
    has_rel = df["has_related"].sum() if "has_related" in df else 0
    lines.append(f"Coverage: news_7d={has_news:,} ({has_news/len(df)*100:.1f}%), "
                 f"div_60d={has_div:,} ({has_div/len(df)*100:.1f}%), "
                 f"related={has_rel:,} ({has_rel/len(df)*100:.1f}%)")
    lines.append("")
    lines.append("---")

    all_tests = []

    # ── 1. News Volume 7d ──
    lines.append("")
    lines.append("## 1. News Volume (Prior 7 Days)")
    df["news_7d_bucket"] = pd.cut(
        df["news_7d"],
        bins=[-1, 0, 2, 5, 15, np.inf],
        labels=["none", "low (1-2)", "moderate (3-5)",
                "high (6-15)", "very_high (>15)"]
    )
    tbl = bucket_analysis(df, "news_7d", "news_7d_bucket")
    lines.append("")
    lines.append("| Bucket | n | WR | Avg P&L | Avg MFE | Avg MAE |")
    lines.append("|--------|---|----|---------|---------|---------| ")
    for _, row in tbl.iterrows():
        lines.append(f"| {row['Bucket']} | {row['n']:,} | {row['WR']} | "
                     f"{row['Avg P&L']} | {row['Avg MFE']} | {row['Avg MAE']} |")
    # Test: any news vs no news
    test = welch_t_test(
        df[df["news_7d"] > 0]["holly_pnl"],
        df[df["news_7d"] == 0]["holly_pnl"]
    )
    all_tests.append(("news_7d_any", test["p_value"], test["cohens_d"]))
    # Median split for continuous
    sub = df[df["news_7d"] > 0]
    if len(sub) > 100:
        med = sub["news_7d"].median()
        test = welch_t_test(
            sub[sub["news_7d"] >= med]["holly_pnl"],
            sub[sub["news_7d"] < med]["holly_pnl"]
        )
        all_tests.append(("news_7d_median", test["p_value"], test["cohens_d"]))

    # ── 2. News Volume 1d ──
    lines.append("")
    lines.append("## 2. News Volume (Prior Day)")
    df["news_1d_bucket"] = pd.cut(
        df["news_1d"],
        bins=[-1, 0, 1, 3, np.inf],
        labels=["none", "one", "few (2-3)", "many (4+)"]
    )
    tbl = bucket_analysis(df, "news_1d", "news_1d_bucket")
    lines.append("")
    lines.append("| Bucket | n | WR | Avg P&L | Avg MFE | Avg MAE |")
    lines.append("|--------|---|----|---------|---------|---------| ")
    for _, row in tbl.iterrows():
        lines.append(f"| {row['Bucket']} | {row['n']:,} | {row['WR']} | "
                     f"{row['Avg P&L']} | {row['Avg MFE']} | {row['Avg MAE']} |")
    test = welch_t_test(
        df[df["news_1d"] > 0]["holly_pnl"],
        df[df["news_1d"] == 0]["holly_pnl"]
    )
    all_tests.append(("news_1d_any", test["p_value"], test["cohens_d"]))

    # ── 3. News Volume 30d ──
    lines.append("")
    lines.append("## 3. News Volume (Prior 30 Days)")
    df["news_30d_bucket"] = pd.cut(
        df["news_30d"],
        bins=[-1, 0, 5, 15, 40, np.inf],
        labels=["none", "low (1-5)", "moderate (6-15)",
                "high (16-40)", "very_high (>40)"]
    )
    tbl = bucket_analysis(df, "news_30d", "news_30d_bucket")
    lines.append("")
    lines.append("| Bucket | n | WR | Avg P&L | Avg MFE | Avg MAE |")
    lines.append("|--------|---|----|---------|---------|---------| ")
    for _, row in tbl.iterrows():
        lines.append(f"| {row['Bucket']} | {row['n']:,} | {row['WR']} | "
                     f"{row['Avg P&L']} | {row['Avg MFE']} | {row['Avg MAE']} |")
    test = welch_t_test(
        df[df["news_30d"] > 0]["holly_pnl"],
        df[df["news_30d"] == 0]["holly_pnl"]
    )
    all_tests.append(("news_30d_any", test["p_value"], test["cohens_d"]))

    # ── 4. Dividend Proximity ──
    lines.append("")
    lines.append("## 4. Dividend Proximity (Days to Nearest Ex-Div)")
    sub = df[df["days_to_exdiv"].notna()].copy()
    if len(sub) > 100:
        sub["div_prox_bucket"] = pd.cut(
            sub["days_to_exdiv"],
            bins=[-1, 5, 15, 30, 60, np.inf],
            labels=["very_close (0-5d)", "close (6-15d)",
                     "near (16-30d)", "far (31-60d)", "distant (>60d)"]
        )
        tbl = bucket_analysis(sub, "days_to_exdiv", "div_prox_bucket")
        lines.append("")
        lines.append("| Bucket | n | WR | Avg P&L | Avg MFE | Avg MAE |")
        lines.append("|--------|---|----|---------|---------|---------| ")
        for _, row in tbl.iterrows():
            lines.append(f"| {row['Bucket']} | {row['n']:,} | {row['WR']} | "
                         f"{row['Avg P&L']} | {row['Avg MFE']} | {row['Avg MAE']} |")
        med = sub["days_to_exdiv"].median()
        test = welch_t_test(
            sub[sub["days_to_exdiv"] >= med]["holly_pnl"],
            sub[sub["days_to_exdiv"] < med]["holly_pnl"]
        )
        all_tests.append(("div_proximity", test["p_value"], test["cohens_d"]))

    # ── 5. Is Dividend Payer ──
    lines.append("")
    lines.append("## 5. Dividend Payer Status")
    if "is_div_payer" in df.columns:
        df["div_status"] = df["is_div_payer"].map({1: "dividend_payer", 0: "non_payer"})
        tbl = bucket_analysis(df, "is_div_payer", "div_status")
        lines.append("")
        lines.append("| Bucket | n | WR | Avg P&L | Avg MFE | Avg MAE |")
        lines.append("|--------|---|----|---------|---------|---------| ")
        for _, row in tbl.iterrows():
            lines.append(f"| {row['Bucket']} | {row['n']:,} | {row['WR']} | "
                         f"{row['Avg P&L']} | {row['Avg MFE']} | {row['Avg MAE']} |")
        test = welch_t_test(
            df[df["is_div_payer"] == 1]["holly_pnl"],
            df[df["is_div_payer"] == 0]["holly_pnl"]
        )
        all_tests.append(("is_div_payer", test["p_value"], test["cohens_d"]))

    # ── 6. Before vs After Ex-Div ──
    lines.append("")
    lines.append("## 6. Before vs After Ex-Dividend Date")
    sub = df[df["days_to_exdiv"].notna()].copy()
    if len(sub) > 100:
        sub["div_timing"] = np.where(sub["direction_sign"] > 0, "after_exdiv", "before_exdiv")
        tbl = bucket_analysis(sub, "direction_sign", "div_timing")
        lines.append("")
        lines.append("| Timing | n | WR | Avg P&L | Avg MFE | Avg MAE |")
        lines.append("|--------|---|----|---------|---------|---------| ")
        for _, row in tbl.iterrows():
            lines.append(f"| {row['Bucket']} | {row['n']:,} | {row['WR']} | "
                         f"{row['Avg P&L']} | {row['Avg MFE']} | {row['Avg MAE']} |")
        test = welch_t_test(
            sub[sub["direction_sign"] > 0]["holly_pnl"],
            sub[sub["direction_sign"] <= 0]["holly_pnl"]
        )
        all_tests.append(("div_before_vs_after", test["p_value"], test["cohens_d"]))

    # ── 7. Has Related Companies ──
    lines.append("")
    lines.append("## 7. Has Related Companies Data")
    if "has_related" in df.columns:
        df["related_status"] = df["has_related"].map(
            {1: "has_related", 0: "no_related"}
        )
        tbl = bucket_analysis(df, "has_related", "related_status")
        lines.append("")
        lines.append("| Status | n | WR | Avg P&L | Avg MFE | Avg MAE |")
        lines.append("|--------|---|----|---------|---------|---------| ")
        for _, row in tbl.iterrows():
            lines.append(f"| {row['Bucket']} | {row['n']:,} | {row['WR']} | "
                         f"{row['Avg P&L']} | {row['Avg MFE']} | {row['Avg MAE']} |")
        test = welch_t_test(
            df[df["has_related"] == 1]["holly_pnl"],
            df[df["has_related"] == 0]["holly_pnl"]
        )
        all_tests.append(("has_related", test["p_value"], test["cohens_d"]))

    # ── 8. Number of Related Companies ──
    if "num_related" in df.columns:
        lines.append("")
        lines.append("## 8. Number of Related Companies")
        df["related_count_bucket"] = pd.cut(
            df["num_related"],
            bins=[-1, 0, 3, 8, np.inf],
            labels=["none", "few (1-3)", "several (4-8)", "many (9+)"]
        )
        tbl = bucket_analysis(df, "num_related", "related_count_bucket")
        lines.append("")
        lines.append("| Bucket | n | WR | Avg P&L | Avg MFE | Avg MAE |")
        lines.append("|--------|---|----|---------|---------|---------| ")
        for _, row in tbl.iterrows():
            lines.append(f"| {row['Bucket']} | {row['n']:,} | {row['WR']} | "
                         f"{row['Avg P&L']} | {row['Avg MFE']} | {row['Avg MAE']} |")

    # ── 9. Continuous Features Summary ──
    lines.append("")
    lines.append("## 9. Continuous Features (Median Split)")
    lines.append("")
    lines.append("| Feature | n(high) | n(low) | WR(high) | WR(low) | "
                 "PnL(high) | PnL(low) | p-raw | Cohen's d | Corr |")
    lines.append("|---------|---------|--------|----------|---------|"
                 "-----------|----------|-------|-----------|------|")

    continuous = [
        ("news_1d", "News Count 1d"),
        ("news_7d", "News Count 7d"),
        ("news_30d", "News Count 30d"),
        ("days_to_exdiv", "Days to Ex-Div"),
        ("num_related", "Num Related Co"),
    ]
    for col, label in continuous:
        if col not in df.columns:
            continue
        sub = df[df[col].notna()].copy()
        if len(sub) < 100:
            continue
        med = sub[col].median()
        high = sub[sub[col] >= med]
        low = sub[sub[col] < med]
        if len(high) < 10 or len(low) < 10:
            continue
        test = welch_t_test(high["holly_pnl"], low["holly_pnl"])
        corr = sub[col].corr(sub["holly_pnl"])
        lines.append(
            f"| {label} (med={med:.1f}) | {len(high):,} | {len(low):,} | "
            f"{high['win'].mean()*100:.1f}% | {low['win'].mean()*100:.1f}% | "
            f"${high['holly_pnl'].mean():.0f} | ${low['holly_pnl'].mean():.0f} | "
            f"{test['p_value']:.4f} | {test['cohens_d']:.3f} | {corr:.3f} |"
        )

    # ── 10. Strategy x News Volume ──
    lines.append("")
    lines.append("## 10. Strategy x News Volume (7d)")
    top_strats = df["strategy"].value_counts().head(5).index
    for strat in top_strats:
        sub = df[df["strategy"] == strat].copy()
        if len(sub) < 100:
            continue
        sub["news_bucket"] = pd.cut(
            sub["news_7d"],
            bins=[-1, 0, 3, np.inf],
            labels=["no_news", "some (1-3)", "heavy (4+)"]
        )
        lines.append(f"")
        lines.append(f"**{strat}** (n={len(sub):,})")
        lines.append("")
        lines.append("| News 7d | n | WR | Avg P&L |")
        lines.append("|---------|---|----|---------| ")
        for bucket, grp in sub.groupby("news_bucket", observed=True):
            lines.append(f"| {bucket} | {len(grp):,} | "
                         f"{grp['win'].mean()*100:.1f}% | "
                         f"${grp['holly_pnl'].mean():.0f} |")

    # ── 11. FDR-Corrected Summary ──
    lines.append("")
    lines.append("## 11. FDR-Corrected Summary")

    valid_tests = [(name, p, d) for name, p, d in all_tests
                   if not np.isnan(p) and not np.isnan(d)]
    if valid_tests:
        names = [t[0] for t in valid_tests]
        p_values = [t[1] for t in valid_tests]
        d_values = [t[2] for t in valid_tests]
        p_adj = fdr_correction(p_values)

        sig_rows = [(n, p, pa, d) for n, p, pa, d in
                     zip(names, p_values, p_adj, d_values) if pa < 0.1]
        sig_rows.sort(key=lambda x: x[2])

        lines.append("")
        lines.append(f"**{len(sig_rows)} test(s) significant at FDR < 0.1:**")
        lines.append("")
        lines.append("| Feature | p-raw | p-adj (BH) | Cohen's d | Verdict |")
        lines.append("|---------|-------|------------|-----------|---------| ")
        for name, p_raw, p_adj_val, d in sig_rows:
            verdict = "**SIGNIFICANT**" if p_adj_val < 0.05 else "**marginal**"
            lines.append(f"| {name} | {p_raw:.4f} | {p_adj_val:.4f} | "
                         f"{d:.3f} | {verdict} |")

        lines.append("")
        lines.append(f"Total tests conducted: {len(valid_tests)}")
    else:
        lines.append("")
        lines.append("No valid tests to report.")

    return "\n".join(lines)


def main():
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    con = duckdb.connect(str(DUCKDB_PATH), read_only=True)

    try:
        df = compute_features(con)
        report = generate_report(df)
        out_path = REPORT_DIR / "news-dividends-lift.md"
        out_path.write_text(report, encoding="utf-8")
        print(f"\nReport written to {out_path}")
        print(f"\n{'='*60}")
        print(report[:3000])
        print(f"\n... (truncated, full report at {out_path})")
    finally:
        con.close()


if __name__ == "__main__":
    main()
