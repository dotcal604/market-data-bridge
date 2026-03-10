"""
57_fundamentals_lift.py — Financial fundamentals + industry context lift.

Joins trades against:
  1. financials table (315K rows) — most recent quarterly filing before trade
     → Revenue growth QoQ, gross margin, operating margin, debt-to-equity,
       current ratio, EPS, profitability flag
  2. ticker_details (3.7K rows) — SIC industry codes
  3. fred_macro_daily — put/call ratio at trade date (not yet explored)

Output: reports/fundamentals-lift.md

Usage:
    python scripts/57_fundamentals_lift.py
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
    """Compute financial fundamentals features."""
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

    # ── 1. Most recent quarterly financials before trade ──
    print("Joining financials (most recent quarterly filing before trade)...")
    fin_df = con.execute("""
        WITH ranked AS (
            SELECT
                t.trade_id,
                f.revenues,
                f.gross_profit,
                f.operating_income,
                f.net_income,
                f.eps_diluted,
                f.total_assets,
                f.total_liabilities,
                f.total_equity,
                f.current_assets,
                f.current_liabilities,
                f.operating_cash_flow,
                f.cost_of_revenue,
                f.fiscal_period,
                f.fiscal_year,
                CAST(f.filing_date AS DATE) AS filing_date,
                CAST(f.end_date AS DATE) AS period_end,
                ROW_NUMBER() OVER (
                    PARTITION BY t.trade_id
                    ORDER BY CAST(f.filing_date AS DATE) DESC
                ) AS rn
            FROM trades t
            JOIN financials f
                ON f.ticker = t.symbol
                AND CAST(f.filing_date AS DATE) < CAST(t.entry_time AS DATE)
                AND f.timeframe = 'quarterly'
                AND f.revenues IS NOT NULL
        )
        SELECT * FROM ranked WHERE rn = 1
    """).fetchdf()
    print(f"  {len(fin_df):,} trades with financials")

    # Compute derived metrics
    if len(fin_df) > 0:
        fin_df["gross_margin"] = np.where(
            fin_df["revenues"] > 0,
            fin_df["gross_profit"] / fin_df["revenues"] * 100,
            np.nan
        )
        fin_df["operating_margin"] = np.where(
            fin_df["revenues"] > 0,
            fin_df["operating_income"] / fin_df["revenues"] * 100,
            np.nan
        )
        fin_df["net_margin"] = np.where(
            fin_df["revenues"] > 0,
            fin_df["net_income"] / fin_df["revenues"] * 100,
            np.nan
        )
        fin_df["debt_to_equity"] = np.where(
            fin_df["total_equity"].abs() > 0,
            fin_df["total_liabilities"] / fin_df["total_equity"].abs(),
            np.nan
        )
        fin_df["current_ratio"] = np.where(
            fin_df["current_liabilities"].abs() > 0,
            fin_df["current_assets"] / fin_df["current_liabilities"].abs(),
            np.nan
        )
        fin_df["profitable"] = (fin_df["net_income"] > 0).astype(int)
        fin_df["cash_flow_positive"] = (fin_df["operating_cash_flow"] > 0).astype(int)

    # ── 2. Prior quarter comparison (revenue growth) ──
    print("Computing revenue growth (prior quarter comparison)...")
    rev_growth = con.execute("""
        WITH latest_two AS (
            SELECT
                t.trade_id,
                f.revenues,
                CAST(f.filing_date AS DATE) AS filing_date,
                ROW_NUMBER() OVER (
                    PARTITION BY t.trade_id
                    ORDER BY CAST(f.filing_date AS DATE) DESC
                ) AS rn
            FROM trades t
            JOIN financials f
                ON f.ticker = t.symbol
                AND CAST(f.filing_date AS DATE) < CAST(t.entry_time AS DATE)
                AND f.timeframe = 'quarterly'
                AND f.revenues IS NOT NULL
        )
        SELECT
            a.trade_id,
            a.revenues AS rev_current,
            b.revenues AS rev_prior,
            CASE WHEN b.revenues > 0
                THEN (a.revenues - b.revenues) / b.revenues * 100
                ELSE NULL
            END AS revenue_growth_pct
        FROM latest_two a
        JOIN latest_two b ON a.trade_id = b.trade_id AND b.rn = 2
        WHERE a.rn = 1
    """).fetchdf()
    print(f"  {len(rev_growth):,} trades with revenue growth data")

    # ── 3. SIC industry from ticker_details ──
    print("Joining SIC industry codes...")
    sic_df = con.execute("""
        SELECT
            t.trade_id,
            td.sic_code,
            td.sic_description,
            td.total_employees
        FROM trades t
        JOIN ticker_details td ON td.symbol = t.symbol
    """).fetchdf()
    print(f"  {len(sic_df):,} trades with SIC codes")

    # Map SIC to broad sector
    def sic_to_sector(sic):
        if pd.isna(sic) or sic == "":
            return "unknown"
        try:
            code = int(sic)
        except (ValueError, TypeError):
            return "unknown"
        if code < 1000:
            return "agriculture"
        elif code < 1500:
            return "mining"
        elif code < 1800:
            return "construction"
        elif code < 4000:
            return "manufacturing"
        elif code < 5000:
            return "transport_utilities"
        elif code < 5200:
            return "wholesale"
        elif code < 6000:
            return "retail"
        elif code < 6800:
            return "finance"
        elif code < 7000:
            return "real_estate"
        elif code < 9000:
            return "services"
        else:
            return "public_admin"

    if len(sic_df) > 0:
        sic_df["sector"] = sic_df["sic_code"].apply(sic_to_sector)

    # ── 4. Put/call ratio from fred_macro_daily ──
    print("Joining put/call ratio data...")
    pc_df = con.execute("""
        SELECT
            t.trade_id,
            m.put_call_equity,
            m.put_call_total,
            m.put_call_regime,
            m.put_call_5d_change
        FROM trades t
        JOIN fred_macro_daily m ON m.date = CAST(t.entry_time AS DATE)
        WHERE m.put_call_equity IS NOT NULL
    """).fetchdf()
    print(f"  {len(pc_df):,} trades with put/call data")

    # ── 5. Days since last filing (staleness) ──
    if len(fin_df) > 0:
        trades_with_filing = trades.merge(
            fin_df[["trade_id", "filing_date"]], on="trade_id", how="inner"
        )
        trades_with_filing["days_since_filing"] = (
            pd.to_datetime(trades_with_filing["trade_date"]) -
            pd.to_datetime(trades_with_filing["filing_date"])
        ).dt.days
        filing_staleness = trades_with_filing[["trade_id", "days_since_filing"]]
    else:
        filing_staleness = pd.DataFrame(columns=["trade_id", "days_since_filing"])

    # ── Merge everything ──
    print("Merging all features...")
    df = trades.copy()

    if len(fin_df) > 0:
        df = df.merge(
            fin_df[["trade_id", "gross_margin", "operating_margin", "net_margin",
                     "debt_to_equity", "current_ratio", "profitable",
                     "cash_flow_positive", "eps_diluted"]],
            on="trade_id", how="left"
        )

    if len(rev_growth) > 0:
        df = df.merge(rev_growth[["trade_id", "revenue_growth_pct"]],
                       on="trade_id", how="left")

    if len(sic_df) > 0:
        df = df.merge(sic_df[["trade_id", "sector", "total_employees"]],
                       on="trade_id", how="left")

    if len(pc_df) > 0:
        df = df.merge(pc_df[["trade_id", "put_call_equity", "put_call_regime"]],
                       on="trade_id", how="left")

    if len(filing_staleness) > 0:
        df = df.merge(filing_staleness, on="trade_id", how="left")

    elapsed = time.time() - t0
    print(f"Features computed in {elapsed:.1f}s")
    return df


def bucket_analysis(df, col, bucket_col, pnl_col="holly_pnl"):
    """Compute WR, avg P&L, MFE, MAE per bucket."""
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


def fdr_correction(p_values: list[float], alpha: float = 0.1) -> list[float]:
    """Benjamini-Hochberg FDR correction."""
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


def generate_report(df: pd.DataFrame) -> str:
    """Generate the fundamentals lift analysis report."""
    lines = []
    lines.append("# Financial Fundamentals & Industry Context Lift Analysis")
    lines.append("")
    lines.append(f"Generated: {pd.Timestamp.now().strftime('%Y-%m-%d %H:%M')}")
    lines.append(f"Trades: {len(df):,}")

    # Coverage stats
    has_margin = df["gross_margin"].notna().sum() if "gross_margin" in df else 0
    has_growth = df["revenue_growth_pct"].notna().sum() if "revenue_growth_pct" in df else 0
    has_sector = (df["sector"].notna() & (df["sector"] != "unknown")).sum() if "sector" in df else 0
    has_pc = df["put_call_equity"].notna().sum() if "put_call_equity" in df else 0
    lines.append(f"Coverage: margins={has_margin:,} ({has_margin/len(df)*100:.1f}%), "
                 f"rev_growth={has_growth:,} ({has_growth/len(df)*100:.1f}%), "
                 f"sector={has_sector:,} ({has_sector/len(df)*100:.1f}%), "
                 f"put_call={has_pc:,} ({has_pc/len(df)*100:.1f}%)")
    lines.append("")
    lines.append("---")

    all_tests = []  # (name, p_value, cohens_d)

    # ── Section 1: Profitability ──
    if "profitable" in df.columns:
        lines.append("")
        lines.append("## 1. Profitability (Net Income > 0)")
        sub = df[df["profitable"].notna()].copy()
        sub["profit_bucket"] = sub["profitable"].map({1: "profitable", 0: "unprofitable"})
        tbl = bucket_analysis(sub, "profitable", "profit_bucket")
        lines.append("")
        lines.append("| Bucket | n | WR | Avg P&L | Avg MFE | Avg MAE |")
        lines.append("|--------|---|----|---------|---------|---------| ")
        for _, row in tbl.iterrows():
            lines.append(f"| {row['Bucket']} | {row['n']:,} | {row['WR']} | {row['Avg P&L']} | {row['Avg MFE']} | {row['Avg MAE']} |")
        test = welch_t_test(
            sub[sub["profitable"] == 1]["holly_pnl"],
            sub[sub["profitable"] == 0]["holly_pnl"]
        )
        all_tests.append(("profitable", test["p_value"], test["cohens_d"]))

    # ── Section 2: Gross Margin ──
    if "gross_margin" in df.columns:
        lines.append("")
        lines.append("## 2. Gross Margin")
        sub = df[df["gross_margin"].notna()].copy()
        sub["gm_bucket"] = pd.cut(
            sub["gross_margin"],
            bins=[-np.inf, 0, 30, 50, 70, np.inf],
            labels=["negative", "low (0-30%)", "mid (30-50%)", "high (50-70%)", "very_high (>70%)"]
        )
        tbl = bucket_analysis(sub, "gross_margin", "gm_bucket")
        lines.append("")
        lines.append("### Gross Margin")
        lines.append("")
        lines.append("| Bucket | n | WR | Avg P&L | Avg MFE | Avg MAE |")
        lines.append("|--------|---|----|---------|---------|---------| ")
        for _, row in tbl.iterrows():
            lines.append(f"| {row['Bucket']} | {row['n']:,} | {row['WR']} | {row['Avg P&L']} | {row['Avg MFE']} | {row['Avg MAE']} |")
        med = sub["gross_margin"].median()
        test = welch_t_test(
            sub[sub["gross_margin"] >= med]["holly_pnl"],
            sub[sub["gross_margin"] < med]["holly_pnl"]
        )
        all_tests.append(("gross_margin", test["p_value"], test["cohens_d"]))

    # ── Section 3: Operating Margin ──
    if "operating_margin" in df.columns:
        lines.append("")
        lines.append("## 3. Operating Margin")
        sub = df[df["operating_margin"].notna()].copy()
        sub["om_bucket"] = pd.cut(
            sub["operating_margin"],
            bins=[-np.inf, -20, 0, 15, 30, np.inf],
            labels=["deep_loss (<-20%)", "loss (0 to -20%)", "low (0-15%)",
                     "healthy (15-30%)", "high (>30%)"]
        )
        tbl = bucket_analysis(sub, "operating_margin", "om_bucket")
        lines.append("")
        lines.append("| Bucket | n | WR | Avg P&L | Avg MFE | Avg MAE |")
        lines.append("|--------|---|----|---------|---------|---------| ")
        for _, row in tbl.iterrows():
            lines.append(f"| {row['Bucket']} | {row['n']:,} | {row['WR']} | {row['Avg P&L']} | {row['Avg MFE']} | {row['Avg MAE']} |")
        med = sub["operating_margin"].median()
        test = welch_t_test(
            sub[sub["operating_margin"] >= med]["holly_pnl"],
            sub[sub["operating_margin"] < med]["holly_pnl"]
        )
        all_tests.append(("operating_margin", test["p_value"], test["cohens_d"]))

    # ── Section 4: Revenue Growth ──
    if "revenue_growth_pct" in df.columns:
        lines.append("")
        lines.append("## 4. Revenue Growth (QoQ)")
        sub = df[df["revenue_growth_pct"].notna()].copy()
        # Clip extreme outliers
        sub["revenue_growth_pct"] = sub["revenue_growth_pct"].clip(-200, 500)
        sub["rg_bucket"] = pd.cut(
            sub["revenue_growth_pct"],
            bins=[-np.inf, -20, -5, 5, 20, np.inf],
            labels=["big_decline (<-20%)", "decline (-5 to -20%)",
                     "flat (-5 to 5%)", "growth (5-20%)", "strong_growth (>20%)"]
        )
        tbl = bucket_analysis(sub, "revenue_growth_pct", "rg_bucket")
        lines.append("")
        lines.append("| Bucket | n | WR | Avg P&L | Avg MFE | Avg MAE |")
        lines.append("|--------|---|----|---------|---------|---------| ")
        for _, row in tbl.iterrows():
            lines.append(f"| {row['Bucket']} | {row['n']:,} | {row['WR']} | {row['Avg P&L']} | {row['Avg MFE']} | {row['Avg MAE']} |")
        med = sub["revenue_growth_pct"].median()
        test = welch_t_test(
            sub[sub["revenue_growth_pct"] >= med]["holly_pnl"],
            sub[sub["revenue_growth_pct"] < med]["holly_pnl"]
        )
        all_tests.append(("revenue_growth_pct", test["p_value"], test["cohens_d"]))

    # ── Section 5: Debt-to-Equity ──
    if "debt_to_equity" in df.columns:
        lines.append("")
        lines.append("## 5. Debt-to-Equity Ratio")
        sub = df[df["debt_to_equity"].notna()].copy()
        sub["debt_to_equity"] = sub["debt_to_equity"].clip(0, 20)  # cap outliers
        sub["de_bucket"] = pd.cut(
            sub["debt_to_equity"],
            bins=[-np.inf, 0.5, 1.0, 2.0, 5.0, np.inf],
            labels=["low (<0.5)", "moderate (0.5-1)", "elevated (1-2)",
                     "high (2-5)", "very_high (>5)"]
        )
        tbl = bucket_analysis(sub, "debt_to_equity", "de_bucket")
        lines.append("")
        lines.append("| Bucket | n | WR | Avg P&L | Avg MFE | Avg MAE |")
        lines.append("|--------|---|----|---------|---------|---------| ")
        for _, row in tbl.iterrows():
            lines.append(f"| {row['Bucket']} | {row['n']:,} | {row['WR']} | {row['Avg P&L']} | {row['Avg MFE']} | {row['Avg MAE']} |")
        med = sub["debt_to_equity"].median()
        test = welch_t_test(
            sub[sub["debt_to_equity"] >= med]["holly_pnl"],
            sub[sub["debt_to_equity"] < med]["holly_pnl"]
        )
        all_tests.append(("debt_to_equity", test["p_value"], test["cohens_d"]))

    # ── Section 6: Current Ratio ──
    if "current_ratio" in df.columns:
        lines.append("")
        lines.append("## 6. Current Ratio")
        sub = df[df["current_ratio"].notna()].copy()
        sub["current_ratio"] = sub["current_ratio"].clip(0, 20)
        sub["cr_bucket"] = pd.cut(
            sub["current_ratio"],
            bins=[-np.inf, 1.0, 2.0, 4.0, np.inf],
            labels=["weak (<1)", "adequate (1-2)", "strong (2-4)", "very_strong (>4)"]
        )
        tbl = bucket_analysis(sub, "current_ratio", "cr_bucket")
        lines.append("")
        lines.append("| Bucket | n | WR | Avg P&L | Avg MFE | Avg MAE |")
        lines.append("|--------|---|----|---------|---------|---------| ")
        for _, row in tbl.iterrows():
            lines.append(f"| {row['Bucket']} | {row['n']:,} | {row['WR']} | {row['Avg P&L']} | {row['Avg MFE']} | {row['Avg MAE']} |")
        med = sub["current_ratio"].median()
        test = welch_t_test(
            sub[sub["current_ratio"] >= med]["holly_pnl"],
            sub[sub["current_ratio"] < med]["holly_pnl"]
        )
        all_tests.append(("current_ratio", test["p_value"], test["cohens_d"]))

    # ── Section 7: Days Since Filing ──
    if "days_since_filing" in df.columns:
        lines.append("")
        lines.append("## 7. Filing Staleness (Days Since Last Quarterly Filing)")
        sub = df[df["days_since_filing"].notna()].copy()
        sub["staleness_bucket"] = pd.cut(
            sub["days_since_filing"],
            bins=[-np.inf, 30, 60, 90, 120, np.inf],
            labels=["fresh (<30d)", "recent (30-60d)", "aging (60-90d)",
                     "stale (90-120d)", "very_stale (>120d)"]
        )
        tbl = bucket_analysis(sub, "days_since_filing", "staleness_bucket")
        lines.append("")
        lines.append("| Bucket | n | WR | Avg P&L | Avg MFE | Avg MAE |")
        lines.append("|--------|---|----|---------|---------|---------| ")
        for _, row in tbl.iterrows():
            lines.append(f"| {row['Bucket']} | {row['n']:,} | {row['WR']} | {row['Avg P&L']} | {row['Avg MFE']} | {row['Avg MAE']} |")
        med = sub["days_since_filing"].median()
        test = welch_t_test(
            sub[sub["days_since_filing"] >= med]["holly_pnl"],
            sub[sub["days_since_filing"] < med]["holly_pnl"]
        )
        all_tests.append(("days_since_filing", test["p_value"], test["cohens_d"]))

    # ── Section 8: SIC Sector ──
    if "sector" in df.columns:
        lines.append("")
        lines.append("## 8. Industry Sector (SIC)")
        sub = df[df["sector"].notna() & (df["sector"] != "unknown")].copy()
        tbl = bucket_analysis(sub, "sector", "sector")
        lines.append("")
        lines.append("| Sector | n | WR | Avg P&L | Avg MFE | Avg MAE |")
        lines.append("|--------|---|----|---------|---------|---------| ")
        for _, row in tbl.sort_values("n", ascending=False).iterrows():
            lines.append(f"| {row['Bucket']} | {row['n']:,} | {row['WR']} | {row['Avg P&L']} | {row['Avg MFE']} | {row['Avg MAE']} |")

        # Test each sector vs rest
        for sector in sub["sector"].unique():
            if sub[sub["sector"] == sector].shape[0] < 50:
                continue
            test = welch_t_test(
                sub[sub["sector"] == sector]["holly_pnl"],
                sub[sub["sector"] != sector]["holly_pnl"]
            )
            all_tests.append((f"sector:{sector}", test["p_value"], test["cohens_d"]))

    # ── Section 9: Put/Call Ratio ──
    if "put_call_equity" in df.columns:
        lines.append("")
        lines.append("## 9. Equity Put/Call Ratio")
        sub = df[df["put_call_equity"].notna()].copy()
        sub["pc_bucket"] = pd.cut(
            sub["put_call_equity"],
            bins=[-np.inf, 0.5, 0.7, 0.9, 1.1, np.inf],
            labels=["very_bullish (<0.5)", "bullish (0.5-0.7)",
                     "neutral (0.7-0.9)", "bearish (0.9-1.1)",
                     "very_bearish (>1.1)"]
        )
        tbl = bucket_analysis(sub, "put_call_equity", "pc_bucket")
        lines.append("")
        lines.append("| Bucket | n | WR | Avg P&L | Avg MFE | Avg MAE |")
        lines.append("|--------|---|----|---------|---------|---------| ")
        for _, row in tbl.iterrows():
            lines.append(f"| {row['Bucket']} | {row['n']:,} | {row['WR']} | {row['Avg P&L']} | {row['Avg MFE']} | {row['Avg MAE']} |")
        med = sub["put_call_equity"].median()
        test = welch_t_test(
            sub[sub["put_call_equity"] >= med]["holly_pnl"],
            sub[sub["put_call_equity"] < med]["holly_pnl"]
        )
        all_tests.append(("put_call_equity", test["p_value"], test["cohens_d"]))

    # ── Section 10: Put/Call Regime ──
    if "put_call_regime" in df.columns:
        lines.append("")
        lines.append("## 10. Put/Call Regime")
        sub = df[df["put_call_regime"].notna()].copy()
        tbl = bucket_analysis(sub, "put_call_regime", "put_call_regime")
        lines.append("")
        lines.append("| Regime | n | WR | Avg P&L | Avg MFE | Avg MAE |")
        lines.append("|--------|---|----|---------|---------|---------| ")
        for _, row in tbl.iterrows():
            lines.append(f"| {row['Bucket']} | {row['n']:,} | {row['WR']} | {row['Avg P&L']} | {row['Avg MFE']} | {row['Avg MAE']} |")
        for regime in sub["put_call_regime"].unique():
            if sub[sub["put_call_regime"] == regime].shape[0] < 50:
                continue
            test = welch_t_test(
                sub[sub["put_call_regime"] == regime]["holly_pnl"],
                sub[sub["put_call_regime"] != regime]["holly_pnl"]
            )
            all_tests.append((f"pc_regime:{regime}", test["p_value"], test["cohens_d"]))

    # ── Section 11: Cash Flow Positive ──
    if "cash_flow_positive" in df.columns:
        lines.append("")
        lines.append("## 11. Operating Cash Flow (Positive vs Negative)")
        sub = df[df["cash_flow_positive"].notna()].copy()
        sub["cf_bucket"] = sub["cash_flow_positive"].map({1: "positive", 0: "negative"})
        tbl = bucket_analysis(sub, "cash_flow_positive", "cf_bucket")
        lines.append("")
        lines.append("| Bucket | n | WR | Avg P&L | Avg MFE | Avg MAE |")
        lines.append("|--------|---|----|---------|---------|---------| ")
        for _, row in tbl.iterrows():
            lines.append(f"| {row['Bucket']} | {row['n']:,} | {row['WR']} | {row['Avg P&L']} | {row['Avg MFE']} | {row['Avg MAE']} |")
        test = welch_t_test(
            sub[sub["cash_flow_positive"] == 1]["holly_pnl"],
            sub[sub["cash_flow_positive"] == 0]["holly_pnl"]
        )
        all_tests.append(("cash_flow_positive", test["p_value"], test["cohens_d"]))

    # ── Section 12: EPS ──
    if "eps_diluted" in df.columns:
        lines.append("")
        lines.append("## 12. EPS (Diluted)")
        sub = df[df["eps_diluted"].notna()].copy()
        sub["eps_bucket"] = pd.cut(
            sub["eps_diluted"],
            bins=[-np.inf, -1.0, 0, 0.5, 2.0, np.inf],
            labels=["deep_loss (<-$1)", "loss ($0 to -$1)",
                     "breakeven ($0-$0.50)", "earnings ($0.50-$2)",
                     "strong_earnings (>$2)"]
        )
        tbl = bucket_analysis(sub, "eps_diluted", "eps_bucket")
        lines.append("")
        lines.append("| Bucket | n | WR | Avg P&L | Avg MFE | Avg MAE |")
        lines.append("|--------|---|----|---------|---------|---------| ")
        for _, row in tbl.iterrows():
            lines.append(f"| {row['Bucket']} | {row['n']:,} | {row['WR']} | {row['Avg P&L']} | {row['Avg MFE']} | {row['Avg MAE']} |")
        med = sub["eps_diluted"].median()
        test = welch_t_test(
            sub[sub["eps_diluted"] >= med]["holly_pnl"],
            sub[sub["eps_diluted"] < med]["holly_pnl"]
        )
        all_tests.append(("eps_diluted", test["p_value"], test["cohens_d"]))

    # ── Section 13: Continuous Features (Median Split) ──
    lines.append("")
    lines.append("## 13. Continuous Features (Median Split)")
    lines.append("")
    lines.append("| Feature | n(high) | n(low) | WR(high) | WR(low) | "
                 "PnL(high) | PnL(low) | p-raw | Cohen's d | Corr |")
    lines.append("|---------|---------|--------|----------|---------|"
                 "-----------|----------|-------|-----------|------|")

    continuous_features = [
        ("gross_margin", "Gross Margin %"),
        ("operating_margin", "Operating Margin %"),
        ("revenue_growth_pct", "Revenue Growth QoQ %"),
        ("debt_to_equity", "Debt-to-Equity"),
        ("current_ratio", "Current Ratio"),
        ("days_since_filing", "Days Since Filing"),
        ("put_call_equity", "Put/Call Equity"),
        ("eps_diluted", "EPS Diluted"),
    ]

    for col, label in continuous_features:
        if col not in df.columns:
            continue
        sub = df[df[col].notna()].copy()
        if len(sub) < 100:
            continue
        med = sub[col].median()
        high = sub[sub[col] >= med]
        low = sub[sub[col] < med]
        test = welch_t_test(high["holly_pnl"], low["holly_pnl"])
        corr = sub[col].corr(sub["holly_pnl"])
        lines.append(
            f"| {label} (med={med:.2f}) | {len(high):,} | {len(low):,} | "
            f"{high['win'].mean()*100:.1f}% | {low['win'].mean()*100:.1f}% | "
            f"${high['holly_pnl'].mean():.0f} | ${low['holly_pnl'].mean():.0f} | "
            f"{test['p_value']:.4f} | {test['cohens_d']:.3f} | {corr:.3f} |"
        )

    # ── Section 14: FDR-Corrected Summary ──
    lines.append("")
    lines.append("## 14. FDR-Corrected Summary")

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

    return "\n".join(lines)


def main():
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    con = duckdb.connect(str(DUCKDB_PATH), read_only=True)

    try:
        df = compute_features(con)
        report = generate_report(df)
        out_path = REPORT_DIR / "fundamentals-lift.md"
        out_path.write_text(report, encoding="utf-8")
        print(f"\nReport written to {out_path}")
        print(f"\n{'='*60}")
        print(report[:3000])
        print(f"\n... (truncated, full report at {out_path})")
    finally:
        con.close()


if __name__ == "__main__":
    main()
