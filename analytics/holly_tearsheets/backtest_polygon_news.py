"""Backtest Polygon base Stocks News API data against Holly trade outcomes.

Tests whether news volume, sentiment, and timing from the FREE base Polygon
API (included in Starter plan) predict Holly trade outcomes.

Usage:
    python -m holly_tearsheets.backtest_polygon_news
"""

import warnings
from pathlib import Path

import numpy as np
import pandas as pd
from scipy import stats

from .config import PACKAGE_ROOT, HOLLY_CSV

warnings.filterwarnings("ignore")

CATALYST_DIR = PACKAGE_ROOT / "output" / "catalysts"
NEWS_FILE = CATALYST_DIR / "polygon_news_history.parquet"


def load_data():
    """Load Holly trades and Polygon news, return merged data."""
    holly = pd.read_csv(HOLLY_CSV, parse_dates=["entry_time", "exit_time"])
    holly["trade_date"] = holly["entry_time"].dt.date.astype(str)
    holly["pnl"] = holly["holly_pnl"]
    holly["win"] = holly["is_winner"].astype(int)
    holly["is_long"] = (holly["direction"] == "long").astype(int)

    news = pd.read_parquet(NEWS_FILE)
    news["published_utc"] = pd.to_datetime(news["published_utc"], utc=True)
    news["pub_date"] = news["published_utc"].dt.date.astype(str)

    return holly, news


def symbol_news_profile(news: pd.DataFrame) -> pd.DataFrame:
    """Build per-symbol news profile: article count, sentiment mix."""
    profiles = []
    for symbol, grp in news.groupby("symbol"):
        total = len(grp)
        has_sentiment = grp["sentiment"].notna()
        pos = (grp["sentiment"] == "positive").sum()
        neg = (grp["sentiment"] == "negative").sum()
        neu = (grp["sentiment"] == "neutral").sum()
        no_sent = (~has_sentiment).sum()

        profiles.append({
            "symbol": symbol,
            "news_article_count": total,
            "news_pos_pct": pos / total * 100 if total else 0,
            "news_neg_pct": neg / total * 100 if total else 0,
            "news_neu_pct": neu / total * 100 if total else 0,
            "news_no_sent_pct": no_sent / total * 100 if total else 0,
            "news_sent_coverage": has_sentiment.sum() / total * 100 if total else 0,
            "news_pos_neg_ratio": pos / neg if neg > 0 else (10.0 if pos > 0 else 1.0),
            "news_avg_tickers": grp["num_tickers"].mean(),
            "news_avg_keywords": grp["num_keywords"].mean(),
        })

    return pd.DataFrame(profiles)


def same_day_news(holly: pd.DataFrame, news: pd.DataFrame) -> pd.DataFrame:
    """Check if there was news on the same day as the trade."""
    # Get unique (symbol, date) pairs from news
    news_dates = news[["symbol", "pub_date"]].drop_duplicates()
    news_dates["has_same_day_news"] = 1

    merged = holly.merge(
        news_dates,
        left_on=["symbol", "trade_date"],
        right_on=["symbol", "pub_date"],
        how="left",
    )
    merged["has_same_day_news"] = merged["has_same_day_news"].fillna(0).astype(int)
    return merged


def test_feature(df, feature, target="win", min_groups=2):
    """Test a single feature's predictive power."""
    valid = df[[feature, target, "pnl"]].dropna()
    if len(valid) < 100:
        return None

    # Correlation
    corr, p_corr = stats.pointbiserialr(valid[target], valid[feature])

    # Bucket analysis (tertiles)
    try:
        valid["bucket"] = pd.qcut(valid[feature], 3, labels=["Low", "Mid", "High"],
                                   duplicates="drop")
    except ValueError:
        # Not enough unique values for qcut
        valid["bucket"] = pd.cut(valid[feature], 3, labels=["Low", "Mid", "High"],
                                  duplicates="drop")

    if valid["bucket"].nunique() < min_groups:
        return None

    bucket_stats = valid.groupby("bucket", observed=True).agg(
        trades=("win", "count"),
        win_rate=("win", "mean"),
        avg_pnl=("pnl", "mean"),
    )

    wr_spread = (bucket_stats["win_rate"].max() - bucket_stats["win_rate"].min()) * 100

    return {
        "feature": feature,
        "corr": corr,
        "p_value": p_corr,
        "significant": p_corr < 0.05,
        "wr_spread": wr_spread,
        "n": len(valid),
        "bucket_stats": bucket_stats,
    }


def run_backtest():
    """Main backtest."""
    print("=" * 70)
    print("POLYGON BASE NEWS API vs HOLLY OUTCOMES")
    print("(Free with Starter plan - testing if $99 Benzinga is needed)")
    print("=" * 70)

    holly, news = load_data()
    print(f"\nHolly trades: {len(holly):,}")
    print(f"News articles: {len(news):,} across {news['symbol'].nunique()} symbols")

    sent_counts = news["sentiment"].value_counts(dropna=False)
    total = len(news)
    print(f"\nSentiment coverage:")
    for sent, count in sent_counts.items():
        pct = count / total * 100
        print(f"  {str(sent):<12} {count:>6,} ({pct:.0f}%)")

    # ── 1. Per-symbol news profiles ──────────────────────────────────
    print(f"\n{'=' * 70}")
    print("TEST 1: Per-Symbol News Profile vs Win Rate")
    print("=" * 70)

    profiles = symbol_news_profile(news)
    merged = holly.merge(profiles, on="symbol", how="inner")
    print(f"Trades with news data: {len(merged):,} ({len(merged)/len(holly)*100:.1f}%)")

    features_to_test = [
        "news_article_count",
        "news_pos_pct",
        "news_neg_pct",
        "news_sent_coverage",
        "news_pos_neg_ratio",
        "news_avg_tickers",
        "news_avg_keywords",
    ]

    results = []
    for feat in features_to_test:
        result = test_feature(merged, feat)
        if result:
            results.append(result)

    if results:
        print(f"\n{'Feature':<25} {'Corr':>8} {'p-value':>10} {'Sig?':>6} {'WR Spread':>10} {'N':>7}")
        print("-" * 70)
        for r in sorted(results, key=lambda x: abs(x["corr"]), reverse=True):
            sig = "YES" if r["significant"] else "no"
            print(f"{r['feature']:<25} {r['corr']:>+8.4f} {r['p_value']:>10.4f} {sig:>6} "
                  f"{r['wr_spread']:>9.1f}% {r['n']:>7,}")

    # ── 2. Same-day news proximity ───────────────────────────────────
    print(f"\n{'=' * 70}")
    print("TEST 2: Same-Day News on Trade Day")
    print("=" * 70)

    merged_sameday = same_day_news(holly, news)
    # Filter to symbols that have news data at all
    symbols_with_news = set(news["symbol"].unique())
    merged_sameday = merged_sameday[merged_sameday["symbol"].isin(symbols_with_news)]

    has_news = merged_sameday[merged_sameday["has_same_day_news"] == 1]
    no_news = merged_sameday[merged_sameday["has_same_day_news"] == 0]

    print(f"Trades WITH same-day news:    {len(has_news):>6,} | WR: {has_news['win'].mean()*100:.1f}% | "
          f"Avg PnL: ${has_news['pnl'].mean():,.0f}")
    print(f"Trades WITHOUT same-day news: {len(no_news):>6,} | WR: {no_news['win'].mean()*100:.1f}% | "
          f"Avg PnL: ${no_news['pnl'].mean():,.0f}")

    if len(has_news) > 30 and len(no_news) > 30:
        t_stat, p_val = stats.ttest_ind(has_news["pnl"], no_news["pnl"])
        print(f"T-test p-value: {p_val:.4f} {'** SIGNIFICANT **' if p_val < 0.05 else '(not significant)'}")

    # ── 3. Sentiment on trade day ────────────────────────────────────
    print(f"\n{'=' * 70}")
    print("TEST 3: Same-Day Sentiment vs Outcomes (where sentiment exists)")
    print("=" * 70)

    # Match news sentiment to trades on same day
    daily_sent = news.groupby(["symbol", "pub_date"]).agg(
        day_articles=("sentiment", "count"),
        day_pos=("sentiment", lambda x: (x == "positive").sum()),
        day_neg=("sentiment", lambda x: (x == "negative").sum()),
        day_neu=("sentiment", lambda x: (x == "neutral").sum()),
    ).reset_index()

    daily_sent["day_sent_score"] = (daily_sent["day_pos"] - daily_sent["day_neg"]) / daily_sent["day_articles"]

    merged_sent = holly.merge(
        daily_sent,
        left_on=["symbol", "trade_date"],
        right_on=["symbol", "pub_date"],
        how="inner",
    )
    print(f"Trades with same-day news: {len(merged_sent):,}")

    if len(merged_sent) > 100:
        # Split by sentiment score
        positive_sent = merged_sent[merged_sent["day_sent_score"] > 0]
        negative_sent = merged_sent[merged_sent["day_sent_score"] < 0]
        neutral_sent = merged_sent[merged_sent["day_sent_score"] == 0]

        print(f"\n{'Sentiment':>15} {'Trades':>8} {'WR':>8} {'Avg PnL':>12}")
        print("-" * 50)
        for label, subset in [("Positive", positive_sent), ("Negative", negative_sent),
                               ("Neutral/None", neutral_sent)]:
            if len(subset) > 0:
                print(f"{label:>15} {len(subset):>8,} {subset['win'].mean()*100:>7.1f}% "
                      f"${subset['pnl'].mean():>11,.0f}")

        result = test_feature(merged_sent, "day_sent_score")
        if result:
            print(f"\nSentiment score correlation: {result['corr']:+.4f} (p={result['p_value']:.4f})")

    # ── 4. Sentiment + direction combos ──────────────────────────────
    print(f"\n{'=' * 70}")
    print("TEST 4: Sentiment + Direction Combos")
    print("=" * 70)

    if len(merged_sent) > 100:
        merged_sent["sent_dir"] = "mixed"
        merged_sent.loc[(merged_sent["day_sent_score"] > 0) & (merged_sent["is_long"] == 1), "sent_dir"] = "pos+long"
        merged_sent.loc[(merged_sent["day_sent_score"] > 0) & (merged_sent["is_long"] == 0), "sent_dir"] = "pos+short"
        merged_sent.loc[(merged_sent["day_sent_score"] < 0) & (merged_sent["is_long"] == 1), "sent_dir"] = "neg+long"
        merged_sent.loc[(merged_sent["day_sent_score"] < 0) & (merged_sent["is_long"] == 0), "sent_dir"] = "neg+short"

        print(f"\n{'Combo':>15} {'Trades':>8} {'WR':>8} {'Avg PnL':>12}")
        print("-" * 50)
        for combo in ["pos+long", "pos+short", "neg+long", "neg+short", "mixed"]:
            subset = merged_sent[merged_sent["sent_dir"] == combo]
            if len(subset) > 10:
                print(f"{combo:>15} {len(subset):>8,} {subset['win'].mean()*100:>7.1f}% "
                      f"${subset['pnl'].mean():>11,.0f}")

    # ── 5. News volume buckets ───────────────────────────────────────
    print(f"\n{'=' * 70}")
    print("TEST 5: News Volume Buckets (High-News vs Low-News Symbols)")
    print("=" * 70)

    if len(merged) > 200:
        try:
            merged["news_vol_bucket"] = pd.qcut(
                merged["news_article_count"], 3, duplicates="drop"
            )
            bucket_labels = merged["news_vol_bucket"].cat.categories
            label_map = {}
            for i, cat in enumerate(bucket_labels):
                if i == 0:
                    label_map[cat] = "Low News"
                elif i == len(bucket_labels) - 1:
                    label_map[cat] = "High News"
                else:
                    label_map[cat] = "Mid News"
            merged["news_vol_label"] = merged["news_vol_bucket"].map(label_map)

            print(f"\n{'Bucket':>15} {'Trades':>8} {'WR':>8} {'Avg PnL':>12} {'Symbols':>10}")
            print("-" * 60)
            for bucket in ["Low News", "Mid News", "High News"]:
                subset = merged[merged["news_vol_label"] == bucket]
                if len(subset) > 0:
                    n_sym = subset["symbol"].nunique()
                    print(f"{bucket:>15} {len(subset):>8,} {subset['win'].mean()*100:>7.1f}% "
                          f"${subset['pnl'].mean():>11,.0f} {n_sym:>10}")
        except Exception as e:
            print(f"  (Could not bucket: {e})")

    # ── 6. Practical filter comparison ───────────────────────────────
    print(f"\n{'=' * 70}")
    print("COMPARISON: Free Base News API vs Paid Benzinga Expansion")
    print("=" * 70)

    print("""
    BASE POLYGON NEWS API (FREE with Starter):
    - Article count per symbol: yes
    - AI sentiment labels: yes, but only 18% coverage
    - Published timestamps: yes
    - Source/publisher name: yes
    - Keywords count: yes

    BENZINGA NEWS EXPANSION ($99/mo):
    - Full article text + categories (FDA, earnings, M&A, etc.)
    - Real-time streaming news
    - Better sentiment coverage (Benzinga provides on all articles)
    - News channels/categories for event classification
    - Historical depth (years of categorized news)

    QUESTION: Does the base API's sparse sentiment + volume data
    predict Holly outcomes enough to justify NOT paying $99/mo?
    """)

    # Summary verdict
    print("=" * 70)
    print("SUMMARY: Base Polygon News Predictive Power")
    print("=" * 70)

    all_significant = [r for r in results if r["significant"]]
    all_not_sig = [r for r in results if not r["significant"]]

    print(f"\n  Significant features: {len(all_significant)}")
    for r in all_significant:
        print(f"    - {r['feature']}: corr={r['corr']:+.4f}, WR spread={r['wr_spread']:.1f}%")

    print(f"\n  NOT significant: {len(all_not_sig)}")
    for r in all_not_sig:
        print(f"    - {r['feature']}: corr={r['corr']:+.4f}, p={r['p_value']:.3f}")


def main():
    run_backtest()


if __name__ == "__main__":
    main()
