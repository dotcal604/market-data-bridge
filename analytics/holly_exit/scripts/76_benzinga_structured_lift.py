"""
Script 76 -- Benzinga News Structured Feature Lift (v2 - Broad Dataset)
=======================================================================
Mines the benzinga_news_broad table (1.19M articles) for structured
predictive features using channels, tags, body text, title, and timing.

Data source: benzinga_news_broad DuckDB table (from script 77 broad fetch).
1.19M articles, 19K unique tickers, 86% with body text.

Features extracted (all look-ahead-free, using articles published BEFORE entry):
  - bz_article_count: Number of Benzinga articles in 48h window before entry
  - bz_has_earnings: Any article with "earnings" channel
  - bz_has_price_target: Any article with "price target" channel
  - bz_has_analyst_rating: Any article with "analyst ratings" channel
  - bz_has_movers: Any article with "movers" channel
  - bz_has_why_moving: Any article with "why it's moving" tag
  - bz_has_52w_low: Any article with "52-week" tag
  - bz_channel_count: Total channels across matched articles
  - bz_tag_count: Total tags across matched articles
  - bz_avg_body_len: Average body length (chars) of matched articles
  - bz_recency_hours: Hours between most recent article and trade entry
  - bz_title_sentiment: Simple keyword-based sentiment from titles

Strategy: DuckDB-native join (trades x articles within 48h window),
aggregate features per trade in SQL, pull only final features to Python.
Handles 1.19M articles efficiently without loading into pandas.

Usage:
    python scripts/76_benzinga_structured_lift.py
"""

import sys, time, warnings
from pathlib import Path
import numpy as np
import pandas as pd
import duckdb

sys.path.insert(0, str(Path(__file__).parent.parent))
from config.settings import DUCKDB_PATH

REPORT_DIR = Path(__file__).parent.parent / "output" / "reports"
warnings.filterwarnings("ignore", category=FutureWarning)

# Sentiment word lists (simple but effective for financial news)
POSITIVE_WORDS = {
    "rise", "rises", "rising", "gain", "gains", "beat", "beats",
    "upgrade", "upgrades", "upgraded", "raise", "raises", "raised",
    "surge", "surges", "surging", "jump", "jumps", "rally", "rallies",
    "bullish", "outperform", "buy", "overweight", "strong", "higher",
    "record", "breakout", "accelerate", "boost", "top",
}
NEGATIVE_WORDS = {
    "drop", "drops", "dropping", "fall", "falls", "falling", "miss",
    "misses", "missed", "cut", "cuts", "downgrade", "downgrades",
    "downgraded", "decline", "declines", "plunge", "plunges", "sink",
    "sinks", "bearish", "underperform", "sell", "underweight", "weak",
    "lower", "warning", "crash", "slump", "loss",
}


def title_sentiment(title):
    """Simple keyword sentiment: +1 per positive, -1 per negative, averaged."""
    if not isinstance(title, str):
        return 0.0
    words = set(title.lower().split())
    pos = len(words & POSITIVE_WORDS)
    neg = len(words & NEGATIVE_WORDS)
    total = pos + neg
    if total == 0:
        return 0.0
    return (pos - neg) / total


def load_features(con):
    """Load trades and compute Benzinga structured features via DuckDB joins."""
    t0 = time.time()

    # Check benzinga_news_broad table exists
    tables = [r[0] for r in con.execute("SHOW TABLES").fetchall()]
    if "benzinga_news_broad" not in tables:
        print("  ERROR: benzinga_news_broad table not found")
        print("  Run script 77_fetch_benzinga_broad.py first")
        trades = con.execute("""
            SELECT trade_id, symbol, strategy, direction,
                entry_time, entry_price, holly_pnl,
                CASE WHEN holly_pnl > 0 THEN 1 ELSE 0 END AS win
            FROM trades
        """).fetchdf()
        return trades, []

    # Stats
    bz_count = con.execute("SELECT COUNT(*) FROM benzinga_news_broad").fetchone()[0]
    print(f"  Benzinga broad articles: {bz_count:,}")

    # Step 1: DuckDB-native join + aggregation (no pandas for 1.19M articles)
    print("  Running DuckDB join (trades x articles within 48h window)...")
    t1 = time.time()

    features_df = con.execute("""
        WITH bz_tickers AS (
            SELECT
                benzinga_id,
                CAST(published AS TIMESTAMP) AS published_ts,
                title, body, channels, tags,
                TRIM(ticker) AS ticker
            FROM benzinga_news_broad,
                 UNNEST(string_split(tickers, ',')) AS t(ticker)
            WHERE tickers IS NOT NULL
              AND TRIM(ticker) != ''
        ),
        matched AS (
            SELECT
                t.trade_id,
                b.benzinga_id,
                b.title,
                b.body,
                b.channels,
                b.tags,
                EPOCH(t.entry_time - b.published_ts) / 3600.0 AS hours_before
            FROM trades t
            JOIN bz_tickers b ON b.ticker = t.symbol
            WHERE b.published_ts >= t.entry_time - INTERVAL '48 hours'
              AND b.published_ts < t.entry_time
        )
        SELECT
            trade_id,
            COUNT(*) AS bz_article_count,
            MAX(CASE WHEN LOWER(channels) LIKE '%earnings%' THEN 1 ELSE 0 END) AS bz_has_earnings,
            MAX(CASE WHEN LOWER(channels) LIKE '%price target%' THEN 1 ELSE 0 END) AS bz_has_price_target,
            MAX(CASE WHEN LOWER(channels) LIKE '%analyst rat%' THEN 1 ELSE 0 END) AS bz_has_analyst_rating,
            MAX(CASE WHEN LOWER(channels) LIKE '%movers%' THEN 1 ELSE 0 END) AS bz_has_movers,
            MAX(CASE WHEN LOWER(tags) LIKE '%why it%' THEN 1 ELSE 0 END) AS bz_has_why_moving,
            MAX(CASE WHEN LOWER(tags) LIKE '%52-week%' THEN 1 ELSE 0 END) AS bz_has_52w_low,
            -- Channel/tag counts: count commas + 1 for non-empty strings, summed
            SUM(
                CASE WHEN LENGTH(COALESCE(channels, '')) > 0
                THEN LENGTH(channels) - LENGTH(REPLACE(channels, ',', '')) + 1
                ELSE 0 END
            ) AS bz_channel_count,
            SUM(
                CASE WHEN LENGTH(COALESCE(tags, '')) > 0
                THEN LENGTH(tags) - LENGTH(REPLACE(tags, ',', '')) + 1
                ELSE 0 END
            ) AS bz_tag_count,
            AVG(LENGTH(COALESCE(body, ''))) AS bz_avg_body_len,
            MIN(hours_before) AS bz_recency_hours
        FROM matched
        GROUP BY trade_id
    """).fetchdf()
    print(f"  DuckDB join complete: {len(features_df):,} trades matched ({time.time()-t1:.1f}s)")

    # Step 2: Title sentiment (requires Python string processing)
    # Pull matched titles for sentiment computation
    print("  Computing title sentiment...")
    t2 = time.time()

    title_sentiment_df = con.execute("""
        WITH bz_tickers AS (
            SELECT
                benzinga_id,
                CAST(published AS TIMESTAMP) AS published_ts,
                title,
                TRIM(ticker) AS ticker
            FROM benzinga_news_broad,
                 UNNEST(string_split(tickers, ',')) AS t(ticker)
            WHERE tickers IS NOT NULL
              AND TRIM(ticker) != ''
        )
        SELECT
            t.trade_id,
            b.title
        FROM trades t
        JOIN bz_tickers b ON b.ticker = t.symbol
        WHERE b.published_ts >= t.entry_time - INTERVAL '48 hours'
          AND b.published_ts < t.entry_time
    """).fetchdf()

    if not title_sentiment_df.empty:
        title_sentiment_df["sent"] = title_sentiment_df["title"].apply(title_sentiment)
        sent_agg = title_sentiment_df.groupby("trade_id")["sent"].mean().reset_index()
        sent_agg.columns = ["trade_id", "bz_title_sentiment"]
        features_df = features_df.merge(sent_agg, on="trade_id", how="left")
    else:
        features_df["bz_title_sentiment"] = np.nan

    print(f"  Title sentiment done ({time.time()-t2:.1f}s)")

    # Step 3: Load trades and merge features
    trades = con.execute("""
        SELECT trade_id, symbol, strategy, direction,
            entry_time, entry_price, holly_pnl,
            CASE WHEN holly_pnl > 0 THEN 1 ELSE 0 END AS win
        FROM trades
    """).fetchdf()
    print(f"  Trades: {len(trades):,}")

    trades = trades.merge(features_df, on="trade_id", how="left")

    feature_cols = [
        "bz_article_count", "bz_has_earnings", "bz_has_price_target",
        "bz_has_analyst_rating", "bz_has_movers", "bz_has_why_moving",
        "bz_has_52w_low", "bz_channel_count", "bz_tag_count",
        "bz_avg_body_len", "bz_recency_hours", "bz_title_sentiment",
    ]

    coverage = trades[feature_cols[0]].notna().sum()
    print(f"  Final coverage: {coverage:,}/{len(trades):,} ({coverage/len(trades)*100:.1f}%)")
    print(f"  Total load time: {time.time()-t0:.1f}s")

    return trades, feature_cols


def analyze_features(trades, feature_cols):
    """Run Cohen's d and FDR analysis."""
    from scipy import stats

    results = []
    for col in feature_cols:
        mask = trades[col].notna()
        if mask.sum() < 50:
            continue
        wins = trades.loc[mask & (trades["win"] == 1), col]
        losses = trades.loc[mask & (trades["win"] == 0), col]
        if len(wins) < 20 or len(losses) < 20:
            continue
        pooled = np.sqrt((wins.std()**2 + losses.std()**2) / 2)
        d = (wins.mean() - losses.mean()) / pooled if pooled > 0 else 0
        _, p = stats.ttest_ind(wins, losses, equal_var=False)
        results.append({
            "feature": col, "d": d, "p": p,
            "win_mean": wins.mean(), "loss_mean": losses.mean(),
            "n": int(mask.sum()), "abs_d": abs(d),
        })

    if not results:
        return pd.DataFrame()

    df = pd.DataFrame(results).sort_values("abs_d", ascending=False)

    # FDR correction
    m = len(df)
    df = df.sort_values("p")
    df["rank"] = range(1, m + 1)
    df["fdr_threshold"] = df["rank"] / m * 0.05
    df["fdr_significant"] = df["p"] < df["fdr_threshold"]
    df = df.sort_values("abs_d", ascending=False)

    return df


def analyze_by_channel(trades, feature_cols):
    """Analyze win rate differences for each channel/tag boolean."""
    results = []
    bool_features = [
        "bz_has_earnings", "bz_has_price_target", "bz_has_analyst_rating",
        "bz_has_movers", "bz_has_why_moving", "bz_has_52w_low",
    ]
    for col in bool_features:
        if col not in trades.columns:
            continue
        mask = trades[col].notna()
        if mask.sum() < 50:
            continue
        has = trades.loc[mask & (trades[col] == 1)]
        no_has = trades.loc[mask & (trades[col] == 0)]
        if len(has) < 10:
            continue
        wr_has = has["win"].mean() * 100
        wr_no = no_has["win"].mean() * 100 if len(no_has) > 0 else 0
        results.append({
            "feature": col,
            "with_n": len(has),
            "without_n": len(no_has),
            "wr_with": wr_has,
            "wr_without": wr_no,
            "wr_diff": wr_has - wr_no,
        })
    return pd.DataFrame(results).sort_values("wr_diff", ascending=False, key=abs) if results else pd.DataFrame()


def main():
    t0 = time.time()
    con = duckdb.connect(str(DUCKDB_PATH), read_only=True)
    print(f"Connected to {DUCKDB_PATH.name}")

    trades, feature_cols = load_features(con)
    con.close()

    if not feature_cols:
        print("No features extracted. Exiting.")
        return

    print("\n=== Cohen's d Analysis (Global) ===")
    results = analyze_features(trades, feature_cols)
    if results.empty:
        print("  Not enough data for statistical analysis")
    else:
        sig_count = results["fdr_significant"].sum()
        print(f"FDR-significant: {sig_count}/{len(results)}")
        for _, r in results.iterrows():
            flag = "***" if r["fdr_significant"] else "   "
            print(f"  {flag} {r['feature']:28s} d={r['d']:+.3f}  p={r['p']:.4f}  n={r['n']:,}")

    print("\n=== Channel/Tag Win Rate Analysis ===")
    channel_results = analyze_by_channel(trades, feature_cols)
    if not channel_results.empty:
        for _, r in channel_results.iterrows():
            print(f"  {r['feature']:28s}  with={r['wr_with']:.1f}%({r['with_n']:,})  "
                  f"without={r['wr_without']:.1f}%({r['without_n']:,})  "
                  f"diff={r['wr_diff']:+.1f}pp")

    # Build report
    report = []
    report.append("# Script 76 -- Benzinga News Structured Feature Lift")
    report.append("")
    report.append(f"Generated: {pd.Timestamp.now().strftime('%Y-%m-%d %H:%M')}")
    report.append(f"Source: benzinga_news_broad (1.19M articles, Massive.com API)")
    report.append(f"Trades: {len(trades):,}")
    coverage = trades[feature_cols[0]].notna().sum() if feature_cols else 0
    report.append(f"Coverage: {coverage:,} ({coverage/len(trades)*100:.1f}%)")
    report.append("")

    if not results.empty:
        sig_count = results["fdr_significant"].sum()
        report.append(f"FDR-significant features: {sig_count}/{len(results)}")
        report.append("")
        report.append("## Global Results")
        report.append("")
        report.append("| Feature | Cohen's d | p-value | Win Mean | Loss Mean | n | FDR Sig |")
        report.append("|---------|-----------|---------|----------|-----------|---|---------|")
        for _, r in results.iterrows():
            sig = "Yes" if r["fdr_significant"] else "No"
            report.append(
                f"| {r['feature']} | {r['d']:+.4f} | {r['p']:.2e} | "
                f"{r['win_mean']:.3f} | {r['loss_mean']:.3f} | {r['n']:,} | {sig} |"
            )
        report.append("")

    if not channel_results.empty:
        report.append("## Channel/Tag Win Rate Breakdown")
        report.append("")
        report.append("| Feature | With WR% | Without WR% | Diff (pp) | With N | Without N |")
        report.append("|---------|----------|-------------|-----------|--------|-----------|")
        for _, r in channel_results.iterrows():
            report.append(
                f"| {r['feature']} | {r['wr_with']:.1f}% | {r['wr_without']:.1f}% | "
                f"{r['wr_diff']:+.1f} | {r['with_n']:,} | {r['without_n']:,} |"
            )
        report.append("")

    report.append("## Feature Descriptions")
    report.append("")
    report.append("- **bz_article_count**: Number of Benzinga articles in 48h window before entry")
    report.append("- **bz_has_earnings**: Any article with 'earnings' channel")
    report.append("- **bz_has_price_target**: Any article with 'price target' channel")
    report.append("- **bz_has_analyst_rating**: Any article with 'analyst ratings' channel")
    report.append("- **bz_has_movers**: Any article with 'movers' channel")
    report.append("- **bz_has_why_moving**: Any article with 'why it's moving' tag")
    report.append("- **bz_has_52w_low**: Any article with '52-week' tag")
    report.append("- **bz_channel_count**: Total unique channels across matched articles")
    report.append("- **bz_tag_count**: Total unique tags across matched articles")
    report.append("- **bz_avg_body_len**: Average article body length (characters)")
    report.append("- **bz_recency_hours**: Hours between most recent article and trade entry")
    report.append("- **bz_title_sentiment**: Keyword-based title sentiment (-1 to +1)")
    report.append("")

    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    path = REPORT_DIR / "benzinga-structured-lift.md"
    path.write_text("\n".join(report), encoding="utf-8")
    elapsed = time.time() - t0
    print(f"\nReport: {path}")
    print(f"Done in {elapsed:.1f}s")


if __name__ == "__main__":
    main()
