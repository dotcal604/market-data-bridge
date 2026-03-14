"""
46_benzinga_lift_analysis.py — Lift analysis: does Benzinga news provide edge?

Compares Holly trade outcomes (win rate, avg P&L, expectancy) for trades
WITH vs WITHOUT pre-entry news. Tests all 8 features individually with
Benjamini-Hochberg FDR correction for multiple comparisons.

Stratifications:
  - Overall (news vs no-news)
  - By strategy
  - By time-of-day bucket (open/midday/close)
  - Per-feature (continuous → median-split, binary → direct)

Output: reports/benzinga-lift-analysis.md

Usage:
    python scripts/46_benzinga_lift_analysis.py
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


def load_features(con: duckdb.DuckDBPyConnection) -> pd.DataFrame:
    """Load benzinga_features with outcome columns."""
    df = con.execute("""
        SELECT
            trade_id, symbol, entry_time, strategy, direction,
            holly_pnl, mfe, mae,
            news_count_24h, news_count_7d,
            has_earnings_news, has_analyst_rating,
            news_recency_hours, unique_sources_24h,
            ticker_news_breadth, channel_diversity,
            CASE WHEN holly_pnl > 0 THEN 1 ELSE 0 END AS win,
            EXTRACT(HOUR FROM entry_time) AS entry_hour
        FROM benzinga_features
    """).fetchdf()

    # Time-of-day buckets
    df["tod_bucket"] = pd.cut(
        df["entry_hour"],
        bins=[0, 10, 13, 16, 24],
        labels=["open (pre-10)", "midday (10-13)", "close (13-16)", "after-hours"],
        right=False
    )

    # Binary: has any 24h news
    df["has_news_24h"] = (df["news_count_24h"] > 0).astype(int)

    return df


def welch_t_test(group_a: pd.Series, group_b: pd.Series) -> dict:
    """Two-sample Welch's t-test with effect size (Cohen's d)."""
    a = group_a.dropna()
    b = group_b.dropna()

    if len(a) < 5 or len(b) < 5:
        return {"t_stat": np.nan, "p_value": np.nan, "cohens_d": np.nan,
                "n_a": len(a), "n_b": len(b)}

    t_stat, p_value = stats.ttest_ind(a, b, equal_var=False)

    # Cohen's d
    pooled_std = np.sqrt((a.std()**2 + b.std()**2) / 2)
    cohens_d = (a.mean() - b.mean()) / pooled_std if pooled_std > 0 else 0

    return {
        "t_stat": t_stat,
        "p_value": p_value,
        "cohens_d": cohens_d,
        "n_a": len(a),
        "n_b": len(b),
        "mean_a": a.mean(),
        "mean_b": b.mean(),
    }


def prop_z_test(wins_a: int, n_a: int, wins_b: int, n_b: int) -> dict:
    """Two-proportion z-test for win rates."""
    if n_a < 5 or n_b < 5:
        return {"z_stat": np.nan, "p_value": np.nan, "n_a": n_a, "n_b": n_b}

    p_a = wins_a / n_a
    p_b = wins_b / n_b
    p_pool = (wins_a + wins_b) / (n_a + n_b)

    se = np.sqrt(p_pool * (1 - p_pool) * (1/n_a + 1/n_b))
    if se == 0:
        return {"z_stat": 0, "p_value": 1.0, "n_a": n_a, "n_b": n_b}

    z = (p_a - p_b) / se
    p_value = 2 * (1 - stats.norm.cdf(abs(z)))

    return {
        "z_stat": z,
        "p_value": p_value,
        "rate_a": p_a,
        "rate_b": p_b,
        "n_a": n_a,
        "n_b": n_b,
    }


def benjamini_hochberg(p_values: list[float]) -> list[float]:
    """Benjamini-Hochberg FDR correction. Returns adjusted p-values."""
    n = len(p_values)
    if n == 0:
        return []

    # Sort p-values, keeping track of original indices
    indexed = sorted(enumerate(p_values), key=lambda x: x[1])
    adjusted = [0.0] * n

    # BH procedure
    prev = 1.0
    for rank_minus_1 in range(n - 1, -1, -1):
        orig_idx, p = indexed[rank_minus_1]
        rank = rank_minus_1 + 1
        adj = min(prev, p * n / rank)
        adjusted[orig_idx] = adj
        prev = adj

    return adjusted


def overall_analysis(df: pd.DataFrame) -> list[str]:
    """News vs no-news overall comparison."""
    lines = []
    lines.append("## 1. Overall: News vs No-News (24h window)")
    lines.append("")

    news = df[df["has_news_24h"] == 1]
    no_news = df[df["has_news_24h"] == 0]

    lines.append(f"| Metric | With News (n={len(news):,}) | Without News (n={len(no_news):,}) | Difference |")
    lines.append("|--------|-----------|--------------|------------|")

    # Win rate
    wr_news = news["win"].mean() * 100
    wr_none = no_news["win"].mean() * 100
    lines.append(f"| Win Rate | {wr_news:.1f}% | {wr_none:.1f}% | {wr_news - wr_none:+.1f}pp |")

    # Avg P&L
    pnl_news = news["holly_pnl"].mean()
    pnl_none = no_news["holly_pnl"].mean()
    lines.append(f"| Avg P&L | ${pnl_news:.2f} | ${pnl_none:.2f} | ${pnl_news - pnl_none:+.2f} |")

    # Avg MFE
    mfe_news = news["mfe"].mean()
    mfe_none = no_news["mfe"].mean()
    lines.append(f"| Avg MFE | ${mfe_news:.2f} | ${mfe_none:.2f} | ${mfe_news - mfe_none:+.2f} |")

    # Avg MAE
    mae_news = news["mae"].mean()
    mae_none = no_news["mae"].mean()
    lines.append(f"| Avg MAE | ${mae_news:.2f} | ${mae_none:.2f} | ${mae_news - mae_none:+.2f} |")

    lines.append("")

    # Statistical tests
    pnl_test = welch_t_test(news["holly_pnl"], no_news["holly_pnl"])
    wr_test = prop_z_test(news["win"].sum(), len(news), no_news["win"].sum(), len(no_news))

    lines.append(f"**P&L t-test:** t={pnl_test['t_stat']:.3f}, p={pnl_test['p_value']:.4f}, Cohen's d={pnl_test['cohens_d']:.3f}")
    lines.append(f"**Win rate z-test:** z={wr_test['z_stat']:.3f}, p={wr_test['p_value']:.4f}")
    lines.append("")

    return lines


def strategy_analysis(df: pd.DataFrame) -> list[str]:
    """Stratified by strategy."""
    lines = []
    lines.append("## 2. Stratified by Strategy (top 10 by trade count)")
    lines.append("")

    top_strats = df["strategy"].value_counts().head(10).index.tolist()

    lines.append("| Strategy | n(news) | n(none) | WR(news) | WR(none) | PnL(news) | PnL(none) | p-value |")
    lines.append("|----------|---------|---------|----------|----------|-----------|-----------|---------|")

    for strat in top_strats:
        sdf = df[df["strategy"] == strat]
        news = sdf[sdf["has_news_24h"] == 1]
        none = sdf[sdf["has_news_24h"] == 0]

        if len(news) < 5 or len(none) < 5:
            lines.append(f"| {strat} | {len(news)} | {len(none)} | — | — | — | — | n<5 |")
            continue

        test = welch_t_test(news["holly_pnl"], none["holly_pnl"])
        lines.append(
            f"| {strat} | {len(news):,} | {len(none):,} "
            f"| {news['win'].mean()*100:.1f}% | {none['win'].mean()*100:.1f}% "
            f"| ${news['holly_pnl'].mean():.2f} | ${none['holly_pnl'].mean():.2f} "
            f"| {test['p_value']:.4f} |"
        )

    lines.append("")
    return lines


def tod_analysis(df: pd.DataFrame) -> list[str]:
    """Stratified by time-of-day."""
    lines = []
    lines.append("## 3. Stratified by Time of Day")
    lines.append("")

    lines.append("| Period | n(news) | n(none) | WR(news) | WR(none) | PnL(news) | PnL(none) | p-value |")
    lines.append("|--------|---------|---------|----------|----------|-----------|-----------|---------|")

    for bucket in ["open (pre-10)", "midday (10-13)", "close (13-16)"]:
        bdf = df[df["tod_bucket"] == bucket]
        news = bdf[bdf["has_news_24h"] == 1]
        none = bdf[bdf["has_news_24h"] == 0]

        if len(news) < 5 or len(none) < 5:
            lines.append(f"| {bucket} | {len(news)} | {len(none)} | — | — | — | — | n<5 |")
            continue

        test = welch_t_test(news["holly_pnl"], none["holly_pnl"])
        lines.append(
            f"| {bucket} | {len(news):,} | {len(none):,} "
            f"| {news['win'].mean()*100:.1f}% | {none['win'].mean()*100:.1f}% "
            f"| ${news['holly_pnl'].mean():.2f} | ${none['holly_pnl'].mean():.2f} "
            f"| {test['p_value']:.4f} |"
        )

    lines.append("")
    return lines


def per_feature_analysis(df: pd.DataFrame) -> list[str]:
    """Test each of 8 features individually with BH-FDR correction."""
    lines = []
    lines.append("## 4. Per-Feature Lift Analysis (with BH-FDR Correction)")
    lines.append("")

    feature_configs = [
        ("news_count_24h", "continuous", "Articles in 24h pre-entry"),
        ("news_count_7d", "continuous", "Articles in 7d pre-entry"),
        ("has_earnings_news", "binary", "Earnings channel article (24h)"),
        ("has_analyst_rating", "binary", "Analyst rating article (24h)"),
        ("news_recency_hours", "continuous_inv", "Hours since latest article"),
        ("unique_sources_24h", "continuous", "Unique authors (24h)"),
        ("ticker_news_breadth", "continuous", "Avg co-mentioned tickers (24h)"),
        ("channel_diversity", "continuous", "Distinct channels (24h)"),
    ]

    results = []
    p_values = []

    for feat_name, feat_type, description in feature_configs:
        col = df[feat_name]

        if feat_type == "binary":
            high = df[col == 1]
            low = df[col == 0]
            split_desc = "1 vs 0"
        elif feat_type == "continuous_inv":
            # For recency, lower is "more news" — only among trades with news
            valid = df[col.notna() & (col > 0)]
            if len(valid) < 20:
                results.append({
                    "feature": feat_name, "description": description,
                    "split": "insufficient data", "n_high": 0, "n_low": 0,
                    "wr_high": np.nan, "wr_low": np.nan,
                    "pnl_high": np.nan, "pnl_low": np.nan,
                    "p_value": np.nan, "cohens_d": np.nan,
                })
                p_values.append(1.0)
                continue
            median = valid[feat_name].median()
            high = valid[valid[feat_name] <= median]  # recent = better?
            low = valid[valid[feat_name] > median]
            split_desc = f"<={median:.1f}h vs >{median:.1f}h"
        else:  # continuous
            # Only among trades that have any value > 0
            valid = df[col > 0] if col.min() >= 0 else df[col.notna()]
            no_news = df[col == 0] if col.min() >= 0 else None

            if len(valid) < 20:
                results.append({
                    "feature": feat_name, "description": description,
                    "split": "insufficient data", "n_high": 0, "n_low": 0,
                    "wr_high": np.nan, "wr_low": np.nan,
                    "pnl_high": np.nan, "pnl_low": np.nan,
                    "p_value": np.nan, "cohens_d": np.nan,
                })
                p_values.append(1.0)
                continue

            # Compare: has feature > 0 vs feature == 0
            high = valid
            low = no_news if no_news is not None else df[~df.index.isin(valid.index)]
            split_desc = f">0 (n={len(high):,}) vs =0 (n={len(low):,})"

        if len(high) < 5 or len(low) < 5:
            results.append({
                "feature": feat_name, "description": description,
                "split": split_desc, "n_high": len(high), "n_low": len(low),
                "wr_high": np.nan, "wr_low": np.nan,
                "pnl_high": np.nan, "pnl_low": np.nan,
                "p_value": np.nan, "cohens_d": np.nan,
            })
            p_values.append(1.0)
            continue

        test = welch_t_test(high["holly_pnl"], low["holly_pnl"])

        results.append({
            "feature": feat_name,
            "description": description,
            "split": split_desc,
            "n_high": len(high),
            "n_low": len(low),
            "wr_high": high["win"].mean() * 100,
            "wr_low": low["win"].mean() * 100,
            "pnl_high": high["holly_pnl"].mean(),
            "pnl_low": low["holly_pnl"].mean(),
            "p_value": test["p_value"],
            "cohens_d": test["cohens_d"],
        })
        p_values.append(test["p_value"] if not np.isnan(test["p_value"]) else 1.0)

    # BH-FDR correction
    adjusted = benjamini_hochberg(p_values)
    for i, r in enumerate(results):
        r["p_adj"] = adjusted[i]
        if np.isnan(r["p_value"]):
            r["verdict"] = "—"
        elif adjusted[i] < 0.05:
            r["verdict"] = "SIGNIFICANT"
        elif adjusted[i] < 0.10:
            r["verdict"] = "marginal"
        else:
            r["verdict"] = "not significant"

    # Render table
    lines.append("| # | Feature | Split | n(high) | n(low) | WR(high) | WR(low) | PnL(high) | PnL(low) | p-raw | p-adj(BH) | Cohen's d | Verdict |")
    lines.append("|---|---------|-------|---------|--------|----------|---------|-----------|----------|-------|-----------|-----------|---------|")

    for i, r in enumerate(results):
        wr_h = f"{r['wr_high']:.1f}%" if not np.isnan(r.get("wr_high", np.nan)) else "—"
        wr_l = f"{r['wr_low']:.1f}%" if not np.isnan(r.get("wr_low", np.nan)) else "—"
        pnl_h = f"${r['pnl_high']:.2f}" if not np.isnan(r.get("pnl_high", np.nan)) else "—"
        pnl_l = f"${r['pnl_low']:.2f}" if not np.isnan(r.get("pnl_low", np.nan)) else "—"
        p_raw = f"{r['p_value']:.4f}" if not np.isnan(r["p_value"]) else "—"
        p_adj = f"{r['p_adj']:.4f}" if not np.isnan(r["p_adj"]) else "—"
        cd = f"{r['cohens_d']:.3f}" if not np.isnan(r.get("cohens_d", np.nan)) else "—"

        lines.append(
            f"| {i+1} | {r['feature']} | {r['split']} "
            f"| {r['n_high']:,} | {r['n_low']:,} "
            f"| {wr_h} | {wr_l} | {pnl_h} | {pnl_l} "
            f"| {p_raw} | {p_adj} | {cd} | **{r['verdict']}** |"
        )

    lines.append("")

    # Verdict summary
    sig_features = [r for r in results if r["verdict"] == "SIGNIFICANT"]
    marginal = [r for r in results if r["verdict"] == "marginal"]

    lines.append("### Verdict")
    lines.append("")
    if sig_features:
        names = ", ".join(r["feature"] for r in sig_features)
        lines.append(f"**{len(sig_features)} feature(s) show statistically significant edge (FDR < 0.05):** {names}")
        lines.append("")
        lines.append("These features are candidates for inclusion in the eval engine.")
    elif marginal:
        names = ", ".join(r["feature"] for r in marginal)
        lines.append(f"**No features pass strict FDR < 0.05.** {len(marginal)} feature(s) are marginal (FDR < 0.10): {names}")
        lines.append("")
        lines.append("Consider larger sample or combining features before promoting to eval engine.")
    else:
        lines.append("**No features show statistically significant edge after FDR correction.**")
        lines.append("")
        lines.append("Benzinga news presence alone does not predict Holly trade outcomes. Consider:")
        lines.append("- Sentiment analysis (NLP) as a next step")
        lines.append("- News timing relative to price action (not just presence)")
        lines.append("- Interaction effects with strategy type")

    lines.append("")
    return lines


def main():
    t0 = time.time()
    con = duckdb.connect(str(DUCKDB_PATH), read_only=True)
    print(f"Connected to {DUCKDB_PATH.name}")

    # Check prerequisites
    tables = [r[0] for r in con.execute(
        "SELECT table_name FROM information_schema.tables"
    ).fetchall()]

    if "benzinga_features" not in tables:
        print("ERROR: benzinga_features table not found. Run script 45 first.")
        sys.exit(1)

    df = load_features(con)
    print(f"Loaded {len(df):,} trades with features")
    print(f"  Has 24h news: {(df['has_news_24h'] == 1).sum():,} ({(df['has_news_24h'] == 1).mean()*100:.1f}%)")

    # Build report
    report = []
    report.append("# Benzinga News Lift Analysis")
    report.append("")
    report.append(f"Generated: {pd.Timestamp.now().strftime('%Y-%m-%d %H:%M')}")
    report.append(f"Trades: {len(df):,} | With 24h news: {(df['has_news_24h']==1).sum():,} | Without: {(df['has_news_24h']==0).sum():,}")
    report.append(f"News date range: {df[df['has_news_24h']==1]['entry_time'].min()} to {df[df['has_news_24h']==1]['entry_time'].max()}")
    report.append("")
    report.append("---")
    report.append("")

    report.extend(overall_analysis(df))
    report.extend(strategy_analysis(df))
    report.extend(tod_analysis(df))
    report.extend(per_feature_analysis(df))

    # Write report
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    report_path = REPORT_DIR / "benzinga-lift-analysis.md"
    report_path.write_text("\n".join(report), encoding="utf-8")

    elapsed = time.time() - t0
    print(f"\nReport saved: {report_path}")
    print(f"Done in {elapsed:.1f}s")
    con.close()


if __name__ == "__main__":
    main()
