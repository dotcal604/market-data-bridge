"""
Script 76 -- Benzinga News Structured Feature Lift
===================================================
Mines the benzinga_news.parquet for structured predictive features
using the rich Massive.com Benzinga News API fields: channels, tags,
body text, title, teaser, and publication timing.

Data source: Massive.com /benzinga/v2/news endpoint (Benzinga News expansion).
Unlike the Polygon standard news API (783K rows, basic metadata), this is
a curated dataset of 4,846 articles with full structured data:
  - channels: earnings, movers, price target, analyst ratings, etc.
  - tags: why it's moving, 52-week lows, earnings scheduled, etc.
  - body: full article HTML text
  - tickers: explicit ticker mentions

Features extracted (all look-ahead-free, using articles published BEFORE entry):
  - bz_article_count: Number of Benzinga articles in 48h window before entry
  - bz_has_earnings: Any article with "earnings" channel
  - bz_has_price_target: Any article with "price target" channel
  - bz_has_analyst_rating: Any article with "analyst ratings" channel
  - bz_has_movers: Any article with "movers" channel
  - bz_has_why_moving: Any article with "why it's moving" tag
  - bz_has_52w_low: Any article with "52-week" tag
  - bz_channel_count: Count of unique channels across matched articles
  - bz_tag_count: Count of unique tags across matched articles
  - bz_avg_body_len: Average body length (chars) of matched articles
  - bz_recency_hours: Hours between most recent article and trade entry
  - bz_title_sentiment: Simple keyword-based sentiment from titles
    (+1 for positive words, -1 for negative words, averaged)

Strategy: Load benzinga_news.parquet, explode tickers, join to trades
via ticker + 48h time window (article published before entry_time).

Usage:
    python scripts/76_benzinga_structured_lift.py
"""

import sys, time, warnings
from pathlib import Path
import numpy as np
import pandas as pd
import duckdb

sys.path.insert(0, str(Path(__file__).parent.parent))
from config.settings import DUCKDB_PATH, DATA_DIR

REPORT_DIR = Path(__file__).parent.parent / "output" / "reports"
PARQUET_PATH = DATA_DIR / "reference" / "benzinga_news.parquet"
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
    """Load trades and compute Benzinga structured features."""
    t0 = time.time()

    # Load trades
    trades = con.execute("""
        SELECT trade_id, symbol, strategy, direction,
            entry_time, entry_price, holly_pnl,
            CASE WHEN holly_pnl > 0 THEN 1 ELSE 0 END AS win
        FROM trades
    """).fetchdf()
    trades["entry_time"] = pd.to_datetime(trades["entry_time"])
    print(f"  Trades: {len(trades):,}")

    # Load Benzinga articles from parquet
    if not PARQUET_PATH.exists():
        print(f"  ERROR: {PARQUET_PATH} not found")
        print("  Run script 43_fetch_benzinga_news.py first")
        return trades, []

    bz = pd.read_parquet(PARQUET_PATH)
    print(f"  Benzinga articles: {len(bz):,}")
    bz["published"] = pd.to_datetime(bz["published"], utc=True)
    # Strip timezone for comparison with trades (which are tz-naive Eastern)
    bz["published"] = bz["published"].dt.tz_localize(None)

    # Explode tickers: each article can mention multiple tickers
    bz_tickers = bz.dropna(subset=["tickers"]).copy()
    bz_tickers["ticker_list"] = bz_tickers["tickers"].str.split(",")
    bz_exploded = bz_tickers.explode("ticker_list")
    bz_exploded["ticker"] = bz_exploded["ticker_list"].str.strip()
    bz_exploded = bz_exploded.drop(columns=["ticker_list"])
    print(f"  Exploded article-ticker pairs: {len(bz_exploded):,}")
    print(f"  Unique tickers in articles: {bz_exploded['ticker'].nunique():,}")

    # Compute per-article features (before grouping)
    bz_exploded["body_len"] = bz_exploded["body"].fillna("").str.len()
    bz_exploded["title_sent"] = bz_exploded["title"].apply(title_sentiment)

    # Channel/tag boolean flags per article
    channels_lower = bz_exploded["channels"].fillna("").str.lower()
    bz_exploded["is_earnings"] = channels_lower.str.contains("earnings").astype(int)
    bz_exploded["is_price_target"] = channels_lower.str.contains("price target").astype(int)
    bz_exploded["is_analyst_rating"] = channels_lower.str.contains("analyst rat").astype(int)
    bz_exploded["is_movers"] = channels_lower.str.contains("movers").astype(int)

    tags_lower = bz_exploded["tags"].fillna("").str.lower()
    bz_exploded["is_why_moving"] = tags_lower.str.contains("why it").astype(int)
    bz_exploded["is_52w"] = tags_lower.str.contains("52-week").astype(int)

    # Channel and tag counts per article
    bz_exploded["n_channels"] = bz_exploded["channels"].fillna("").apply(
        lambda x: len([c for c in x.split(",") if c.strip()]) if x else 0
    )
    bz_exploded["n_tags"] = bz_exploded["tags"].fillna("").apply(
        lambda x: len([t for t in x.split(",") if t.strip()]) if x else 0
    )

    # For each trade, find all articles within 48h before entry
    print("  Matching articles to trades (48h window)...")
    t1 = time.time()

    # Sort for merge_asof approach (more efficient than cartesian join)
    # But with only 4,846 articles, a simple loop is fine
    trade_syms = set(trades["symbol"].unique())
    article_syms = set(bz_exploded["ticker"].unique())
    overlap = trade_syms & article_syms
    print(f"  Symbol overlap: {len(overlap):,} ({len(overlap)/len(trade_syms)*100:.1f}% of trade symbols)")

    # Build features per trade using vectorized group operations
    features_list = []
    matched_count = 0

    for symbol in overlap:
        sym_trades = trades[trades["symbol"] == symbol].copy()
        sym_articles = bz_exploded[bz_exploded["ticker"] == symbol].copy()

        if sym_articles.empty:
            continue

        sym_articles = sym_articles.sort_values("published")

        for _, trade in sym_trades.iterrows():
            entry = trade["entry_time"]
            window_start = entry - pd.Timedelta(hours=48)

            # Articles in window
            mask = (sym_articles["published"] >= window_start) & (sym_articles["published"] < entry)
            matched = sym_articles[mask]

            if matched.empty:
                continue

            matched_count += 1
            most_recent = matched["published"].max()
            recency_hours = (entry - most_recent).total_seconds() / 3600

            features_list.append({
                "trade_id": trade["trade_id"],
                "bz_article_count": len(matched),
                "bz_has_earnings": int(matched["is_earnings"].any()),
                "bz_has_price_target": int(matched["is_price_target"].any()),
                "bz_has_analyst_rating": int(matched["is_analyst_rating"].any()),
                "bz_has_movers": int(matched["is_movers"].any()),
                "bz_has_why_moving": int(matched["is_why_moving"].any()),
                "bz_has_52w_low": int(matched["is_52w"].any()),
                "bz_channel_count": matched["n_channels"].sum(),
                "bz_tag_count": matched["n_tags"].sum(),
                "bz_avg_body_len": matched["body_len"].mean(),
                "bz_recency_hours": recency_hours,
                "bz_title_sentiment": matched["title_sent"].mean(),
            })

    print(f"  Matched trades: {matched_count:,}/{len(trades):,} ({matched_count/len(trades)*100:.1f}%)")
    print(f"  Matching time: {time.time()-t1:.1f}s")

    if not features_list:
        print("  No matches found!")
        return trades, []

    features_df = pd.DataFrame(features_list)
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
    report.append(f"Source: benzinga_news.parquet (Massive.com Benzinga News API)")
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
