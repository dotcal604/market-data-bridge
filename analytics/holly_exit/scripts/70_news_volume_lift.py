"""
Script 70 — News Volume & Sentiment Lift Analysis
====================================================
Mine the `news` table (783K articles) and `benzinga_features` for
news-related predictive features.

Features from news table:
  - news_count_1d: Articles mentioning this ticker in prior 24h
  - news_count_7d: Articles in prior 7 days
  - news_recency_hours: Hours since most recent article
  - has_news_today: Binary — any article in last 24h
  - multi_ticker_news: Whether articles mention multiple tickers

Features from benzinga_features:
  - All pre-computed columns (news_count_24h, unique_sources, etc.)
"""

import sys, time
from pathlib import Path
import numpy as np
import pandas as pd
import duckdb
from scipy import stats
from statsmodels.stats.multitest import multipletests

sys.path.insert(0, str(Path(__file__).parent.parent))
from config.settings import DUCKDB_PATH

REPORT_DIR = Path(__file__).parent.parent / "output" / "reports"


def welch_t(a, b):
    na, nb = len(a), len(b)
    if na < 10 or nb < 10:
        return {"cohens_d": np.nan, "p_value": np.nan}
    ma, mb = np.mean(a), np.mean(b)
    sa, sb = np.std(a, ddof=1), np.std(b, ddof=1)
    pooled = np.sqrt((sa**2 + sb**2) / 2)
    d = (ma - mb) / pooled if pooled > 0 else 0
    _, p_val = stats.ttest_ind(a, b, equal_var=False)
    return {"cohens_d": d, "p_value": p_val}


def quintile_breakdown(df, col):
    valid = df.dropna(subset=[col])
    if len(valid) < 100:
        return None
    try:
        valid = valid.copy()
        valid["q"] = pd.qcut(valid[col], 5, labels=False, duplicates="drop")
    except ValueError:
        return None
    rows = []
    for q in sorted(valid["q"].unique()):
        qdf = valid[valid["q"] == q]
        rows.append({
            "quintile": f"Q{q+1}",
            "range": f"{qdf[col].min():.2f}–{qdf[col].max():.2f}",
            "n": len(qdf),
            "wr": qdf["win"].mean() * 100,
            "avg_pnl": qdf["holly_pnl"].mean(),
        })
    return rows


def main():
    t0 = time.time()
    con = duckdb.connect(str(DUCKDB_PATH), read_only=True)
    print(f"Connected to {DUCKDB_PATH.name}")

    # Check news table structure
    news_count = con.execute("SELECT COUNT(*) FROM news").fetchone()[0]
    print(f"News articles: {news_count:,}")

    # Load trades
    trades = con.execute("""
        SELECT trade_id, symbol, strategy, direction,
            entry_time, holly_pnl,
            CASE WHEN holly_pnl > 0 THEN 1 ELSE 0 END AS win
        FROM trades
    """).fetchdf()
    print(f"Trades: {len(trades):,}")

    # ── News features from polygon news table ──
    # Count articles mentioning each trade's ticker in the 24h and 7d before entry
    print("Computing news features from polygon news...")
    news_features = con.execute("""
        SELECT t.trade_id,
            COUNT(CASE WHEN CAST(n.published_utc AS TIMESTAMP) >= t.entry_time - INTERVAL '24 hours'
                       AND CAST(n.published_utc AS TIMESTAMP) < t.entry_time THEN 1 END) AS news_count_1d,
            COUNT(CASE WHEN CAST(n.published_utc AS TIMESTAMP) >= t.entry_time - INTERVAL '7 days'
                       AND CAST(n.published_utc AS TIMESTAMP) < t.entry_time THEN 1 END) AS news_count_7d,
            MIN(CASE WHEN CAST(n.published_utc AS TIMESTAMP) < t.entry_time THEN
                EXTRACT(EPOCH FROM (t.entry_time - CAST(n.published_utc AS TIMESTAMP))) / 3600 END) AS news_recency_hours,
            MAX(CASE WHEN CAST(n.published_utc AS TIMESTAMP) >= t.entry_time - INTERVAL '24 hours'
                      AND CAST(n.published_utc AS TIMESTAMP) < t.entry_time
                      AND n.ticker_count > 1 THEN 1 ELSE 0 END) AS multi_ticker_news
        FROM trades t
        LEFT JOIN news n ON n.tickers LIKE '%' || t.symbol || '%'
            AND CAST(n.published_utc AS TIMESTAMP) >= t.entry_time - INTERVAL '7 days'
            AND CAST(n.published_utc AS TIMESTAMP) < t.entry_time
        GROUP BY t.trade_id
    """).fetchdf()
    trades = trades.merge(news_features, on="trade_id", how="left")
    print(f"  News join complete ({time.time()-t0:.1f}s)")

    # Binary: has_news_today
    trades["has_news_today"] = (trades["news_count_1d"] > 0).astype(int)

    # Cap extreme recency
    trades["news_recency_hours"] = trades["news_recency_hours"].clip(upper=168)  # 7 days max

    # ── Benzinga features (pre-computed) ──
    print("Loading benzinga features...")
    benz = con.execute("""
        SELECT trade_id, news_count_24h AS benz_news_24h, news_count_7d AS benz_news_7d,
            has_earnings_news AS benz_has_earnings, has_analyst_rating AS benz_has_analyst,
            news_recency_hours AS benz_recency, unique_sources_24h AS benz_sources,
            ticker_news_breadth AS benz_breadth, channel_diversity AS benz_channel_div
        FROM benzinga_features
    """).fetchdf()
    trades = trades.merge(benz, on="trade_id", how="left")
    con.close()
    print(f"  Benzinga: {benz['trade_id'].nunique():,} trades covered")

    # ── Lift analysis ──
    features = [
        ("news_count_1d", "Polygon News Count (24h)"),
        ("news_count_7d", "Polygon News Count (7d)"),
        ("news_recency_hours", "News Recency (hours)"),
        ("multi_ticker_news", "Multi-Ticker News (24h)"),
        ("benz_news_24h", "Benzinga News Count (24h)"),
        ("benz_news_7d", "Benzinga News Count (7d)"),
        ("benz_recency", "Benzinga News Recency (hours)"),
        ("benz_sources", "Benzinga Unique Sources (24h)"),
        ("benz_breadth", "Benzinga Ticker News Breadth"),
        ("benz_channel_div", "Benzinga Channel Diversity"),
    ]

    feature_summary = []
    for col, label in features:
        valid = trades.dropna(subset=[col])
        if len(valid) < 50:
            continue
        winners = valid[valid["win"] == 1][col]
        losers = valid[valid["win"] == 0][col]
        t = welch_t(winners, losers)
        if np.isnan(t["cohens_d"]):
            continue
        feature_summary.append({
            "feature": label, "col": col,
            "n": len(valid), "d": t["cohens_d"], "p": t["p_value"],
        })

    # FDR
    if feature_summary:
        pvals = [f["p"] for f in feature_summary]
        reject, _, _, _ = multipletests(pvals, method="fdr_bh", alpha=0.05)
        for i, fs in enumerate(feature_summary):
            fs["fdr_sig"] = reject[i]
    feature_summary.sort(key=lambda x: abs(x["d"]), reverse=True)

    # Binary features
    binary_results = []
    for col, label in [("has_news_today", "Has News Today (Polygon)"),
                       ("benz_has_earnings", "Benzinga: Earnings News"),
                       ("benz_has_analyst", "Benzinga: Analyst Rating")]:
        valid = trades.dropna(subset=[col])
        if len(valid) < 50:
            continue
        yes = valid[valid[col] == 1]
        no = valid[valid[col] == 0]
        if len(yes) < 10 or len(no) < 10:
            continue
        t = welch_t(yes["holly_pnl"], no["holly_pnl"])
        binary_results.append({
            "feature": label,
            "prevalence": len(yes) / len(valid) * 100,
            "wr_yes": yes["win"].mean() * 100 if len(yes) > 0 else 0,
            "wr_no": no["win"].mean() * 100 if len(no) > 0 else 0,
            "pnl_yes": yes["holly_pnl"].mean() if len(yes) > 0 else 0,
            "pnl_no": no["holly_pnl"].mean() if len(no) > 0 else 0,
            "d": t["cohens_d"],
            "p": t["p_value"],
        })

    # Direction-specific
    longs = trades[trades["direction"].str.lower() == "long"]
    shorts = trades[trades["direction"].str.lower() == "short"]
    dir_results = []
    for col, label in features:
        for ddf, dname in [(longs, "Longs"), (shorts, "Shorts")]:
            valid = ddf.dropna(subset=[col])
            if len(valid) < 50:
                continue
            w = valid[valid["win"] == 1][col]
            l = valid[valid["win"] == 0][col]
            t = welch_t(w, l)
            if not np.isnan(t["cohens_d"]):
                dir_results.append({
                    "feature": f"{label} ({dname})",
                    "d": t["cohens_d"], "p": t["p_value"], "n": len(valid),
                })
    dir_results.sort(key=lambda x: abs(x["d"]), reverse=True)

    # ── Build report ──
    report = []
    report.append("# News Volume & Sentiment — Lift Analysis")
    report.append("")
    report.append(f"Generated: {pd.Timestamp.now().strftime('%Y-%m-%d %H:%M')}")
    report.append(f"Trades: {len(trades):,}")
    report.append(f"Polygon news articles: {news_count:,}")
    report.append(f"Benzinga coverage: {benz['trade_id'].nunique():,} trades")
    fdr_count = sum(1 for f in feature_summary if f.get("fdr_sig"))
    report.append(f"FDR-Significant: {fdr_count}/{len(feature_summary)}")
    report.append("")

    report.append("## 1. Feature Summary")
    report.append("")
    report.append("| Feature | n | Cohen's d | p-value | FDR Sig |")
    report.append("|---------|---|-----------|---------|---------|\n")
    for fs in feature_summary:
        sig = "Y" if fs.get("fdr_sig") else ""
        report.append(f"| {fs['feature']} | {fs['n']:,} | {fs['d']:.3f} | {fs['p']:.4f} | {sig} |")
    report.append("")

    report.append("## 2. Binary Features")
    report.append("")
    report.append("| Feature | Prev | WR (Y) | WR (N) | P&L (Y) | P&L (N) | d |")
    report.append("|---------|------|--------|--------|---------|---------|---|\n")
    for br in binary_results:
        report.append(f"| {br['feature']} | {br['prevalence']:.1f}% | {br['wr_yes']:.1f}% | {br['wr_no']:.1f}% "
                      f"| ${br['pnl_yes']:.0f} | ${br['pnl_no']:.0f} | {br['d']:.3f} |")
    report.append("")

    report.append("## 3. Quintile Breakdowns")
    report.append("")
    for col, label in features:
        rows = quintile_breakdown(trades, col)
        if rows is None:
            continue
        report.append(f"**{label}** (n={sum(r['n'] for r in rows):,})")
        report.append("")
        report.append("| Quintile | Range | n | WR | Avg P&L |")
        report.append("|----------|-------|---|----|---------|\n")
        for r in rows:
            report.append(f"| {r['quintile']} | {r['range']} | {r['n']:,} | {r['wr']:.1f}% | ${r['avg_pnl']:.0f} |")
        report.append("")

    report.append("## 4. Direction-Specific (Top 10)")
    report.append("")
    report.append("| Feature | n | Cohen's d | p-value |")
    report.append("|---------|---|-----------|---------|\n")
    for dr in dir_results[:10]:
        report.append(f"| {dr['feature']} | {dr['n']:,} | {dr['d']:.3f} | {dr['p']:.4f} |")
    report.append("")

    report.append("## 5. Conclusions")
    report.append("")
    sig_features = [f for f in feature_summary if f.get("fdr_sig")]
    if sig_features:
        report.append("**FDR-significant features:**")
        for f in sig_features:
            report.append(f"- {f['feature']}: d={f['d']:.3f}")
    else:
        report.append("*No FDR-significant features found.*")
    report.append("")

    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    path = REPORT_DIR / "news-volume-lift.md"
    path.write_text("\n".join(report), encoding="utf-8")
    elapsed = time.time() - t0
    print(f"\nReport: {path}")
    print(f"Done in {elapsed:.1f}s")


if __name__ == "__main__":
    main()
