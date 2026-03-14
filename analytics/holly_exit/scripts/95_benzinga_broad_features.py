"""
95_benzinga_broad_features.py — Rebuild Benzinga features using BROAD data (1.2M articles)
========================================================================================
The original script 45 used benzinga_news (narrow, 6K articles, ticker-specific).
This script uses benzinga_news_broad (1.2M articles, all market news) to get ~2x
trade coverage and 5x richer news counts.

Features computed (all pre-entry, no look-ahead):
  1. news_count_24h      — articles mentioning symbol in 24h before entry
  2. news_count_7d       — articles mentioning symbol in 7 days before entry
  3. news_count_30d      — articles mentioning symbol in 30 days before entry (NEW)
  4. has_earnings_news   — any earnings-channel article pre-entry (24h)
  5. has_analyst_rating  — any analyst-ratings-channel article pre-entry (24h)
  6. has_movers_news     — any movers-channel article pre-entry (24h) (NEW)
  7. news_recency_hours  — hours since most recent article before entry
  8. unique_sources_24h  — distinct authors in 24h window
  9. ticker_news_breadth — avg co-mentioned tickers in recent articles
  10. channel_diversity  — distinct channels in 24h articles
  11. news_acceleration  — news_count_24h / (news_count_7d/7) ratio (NEW)
  12. news_trend_7d_vs_30d — 7d news rate vs 30d rate (NEW)

Also computes:
  - broad_market_news_24h: total market articles in 24h (not ticker-specific) (NEW)

Output: DuckDB table `benzinga_features_broad` + parquet backup.

Then runs lift analysis comparing narrow vs broad features.
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

OUT_FILE = DATA_DIR / "reference" / "benzinga_features_broad.parquet"


def compute_broad_features(con: duckdb.DuckDBPyConnection) -> pd.DataFrame:
    """Compute all features using benzinga_news_broad."""
    t0 = time.time()

    # Step 1: Explode tickers from broad table
    print("Step 1: Exploding benzinga_news_broad tickers...")
    con.execute("""
        CREATE OR REPLACE TEMP TABLE bz_broad_tickers AS
        SELECT
            bn.benzinga_id,
            bn.published,
            bn.author,
            bn.channels,
            bn.tickers AS all_tickers,
            TRIM(t.ticker) AS ticker
        FROM benzinga_news_broad bn,
             LATERAL (SELECT UNNEST(string_split(bn.tickers, ',')) AS ticker) t
        WHERE bn.tickers IS NOT NULL
          AND LENGTH(TRIM(t.ticker)) > 0
    """)
    bz_count = con.execute("SELECT COUNT(*) FROM bz_broad_tickers").fetchone()[0]
    unique_tickers = con.execute("SELECT COUNT(DISTINCT ticker) FROM bz_broad_tickers").fetchone()[0]
    print(f"  {bz_count:,} ticker-article rows, {unique_tickers:,} unique tickers ({time.time()-t0:.1f}s)")

    # Step 2: Compute per-trade features via LEFT JOIN
    print("Step 2: Computing features per trade (30d window)...")
    t1 = time.time()

    features_df = con.execute("""
        WITH trade_news AS (
            SELECT
                t.trade_id,
                t.symbol,
                t.entry_time,
                t.strategy,
                t.direction,
                t.holly_pnl,
                t.mfe,
                t.mae,
                bz.benzinga_id,
                bz.published,
                bz.author,
                bz.channels,
                bz.all_tickers,
                EXTRACT(EPOCH FROM (t.entry_time - CAST(bz.published AS TIMESTAMP))) / 3600.0
                    AS hours_before_entry
            FROM trades t
            LEFT JOIN bz_broad_tickers bz
              ON bz.ticker = t.symbol
             AND CAST(bz.published AS TIMESTAMP) < t.entry_time
             AND CAST(bz.published AS TIMESTAMP) >= t.entry_time - INTERVAL '30 days'
        )
        SELECT
            trade_id,
            symbol,
            entry_time,
            strategy,
            direction,
            holly_pnl,
            mfe,
            mae,

            -- Feature 1: news_count_24h
            COUNT(DISTINCT CASE WHEN hours_before_entry <= 24
                  THEN benzinga_id END)
                AS news_count_24h,

            -- Feature 2: news_count_7d
            COUNT(DISTINCT CASE WHEN hours_before_entry <= 168
                  THEN benzinga_id END)
                AS news_count_7d,

            -- Feature 3: news_count_30d (NEW)
            COUNT(DISTINCT benzinga_id) AS news_count_30d,

            -- Feature 4: has_earnings_news (24h, earnings channel)
            MAX(CASE WHEN hours_before_entry <= 24
                      AND channels LIKE '%earnings%'
                 THEN 1 ELSE 0 END)
                AS has_earnings_news,

            -- Feature 5: has_analyst_rating (24h, analyst ratings channel)
            MAX(CASE WHEN hours_before_entry <= 24
                      AND channels LIKE '%analyst ratings%'
                 THEN 1 ELSE 0 END)
                AS has_analyst_rating,

            -- Feature 6: has_movers_news (24h, movers channel) (NEW)
            MAX(CASE WHEN hours_before_entry <= 24
                      AND channels LIKE '%movers%'
                 THEN 1 ELSE 0 END)
                AS has_movers_news,

            -- Feature 7: news_recency_hours
            MIN(CASE WHEN hours_before_entry > 0
                 THEN hours_before_entry END)
                AS news_recency_hours,

            -- Feature 8: unique_sources_24h
            COUNT(DISTINCT CASE WHEN hours_before_entry <= 24
                  THEN author END)
                AS unique_sources_24h,

            -- Feature 9: ticker_news_breadth
            AVG(CASE WHEN hours_before_entry <= 24
                      AND all_tickers IS NOT NULL
                 THEN LENGTH(all_tickers) - LENGTH(REPLACE(all_tickers, ',', '')) + 1
                 END)
                AS ticker_news_breadth,

            -- Feature 10: channel_diversity
            COUNT(DISTINCT CASE WHEN hours_before_entry <= 24
                  THEN channels END)
                AS channel_diversity

        FROM trade_news
        GROUP BY trade_id, symbol, entry_time, strategy, direction,
                 holly_pnl, mfe, mae
        ORDER BY trade_id
    """).fetchdf()

    print(f"  {len(features_df):,} trades ({time.time()-t1:.1f}s)")

    # Derived features
    # News acceleration: is 24h news count elevated vs 7d average?
    avg_daily_7d = features_df["news_count_7d"] / 7.0
    features_df["news_acceleration"] = np.where(
        avg_daily_7d > 0,
        features_df["news_count_24h"] / avg_daily_7d,
        0.0
    )

    # News trend: 7d rate vs 30d rate
    avg_daily_30d = features_df["news_count_30d"] / 30.0
    features_df["news_trend_7d_vs_30d"] = np.where(
        avg_daily_30d > 0,
        avg_daily_7d / avg_daily_30d,
        0.0
    )

    # Step 3: Market-wide news context (not ticker-specific)
    print("Step 3: Computing market-wide news context...")
    t2 = time.time()

    market_context = con.execute("""
        SELECT
            t.trade_id,
            COUNT(DISTINCT bn.benzinga_id) AS broad_market_news_24h
        FROM trades t
        LEFT JOIN benzinga_news_broad bn
          ON CAST(bn.published AS TIMESTAMP) < t.entry_time
         AND CAST(bn.published AS TIMESTAMP) >= t.entry_time - INTERVAL '1 day'
        GROUP BY t.trade_id
    """).fetchdf()

    features_df = features_df.merge(market_context, on="trade_id", how="left")
    print(f"  Market context computed ({time.time()-t2:.1f}s)")

    return features_df


def run_lift_analysis(df: pd.DataFrame):
    """Compare narrow vs broad features and run lift analysis."""
    print(f"\n{'='*70}")
    print("LIFT ANALYSIS — Benzinga Broad Features")
    print("="*70)

    # Win/loss split
    df["win"] = (df["holly_pnl"] > 0).astype(int)
    wins = df[df["win"] == 1]
    losses = df[df["win"] == 0]

    print(f"\nTotal: {len(df):,} trades | Wins: {len(wins):,} | Losses: {len(losses):,}")

    # Continuous features
    continuous = [
        "news_count_24h", "news_count_7d", "news_count_30d",
        "news_recency_hours", "unique_sources_24h", "ticker_news_breadth",
        "channel_diversity", "news_acceleration", "news_trend_7d_vs_30d",
        "broad_market_news_24h",
    ]

    print(f"\n--- Continuous Features (Cohen's d: win vs loss) ---")
    print(f"{'Feature':<30} {'Win Mean':>10} {'Loss Mean':>10} {'Cohen d':>10} {'p-value':>12}")
    print("-" * 75)

    results = []
    for feat in continuous:
        if feat not in df.columns:
            continue
        w = wins[feat].dropna()
        l = losses[feat].dropna()
        if len(w) < 30 or len(l) < 30:
            continue

        pooled_std = np.sqrt(((len(w)-1)*w.std()**2 + (len(l)-1)*l.std()**2) / (len(w)+len(l)-2))
        d = (w.mean() - l.mean()) / pooled_std if pooled_std > 0 else 0

        t_stat, p_val = stats.ttest_ind(w, l, equal_var=False)

        flag = " ***" if p_val < 0.001 else " **" if p_val < 0.01 else " *" if p_val < 0.05 else ""
        print(f"{feat:<30} {w.mean():>10.3f} {l.mean():>10.3f} {d:>10.4f} {p_val:>12.2e}{flag}")
        results.append({"feature": feat, "d": d, "p": p_val, "type": "continuous"})

    # Binary features
    binary = ["has_earnings_news", "has_analyst_rating", "has_movers_news"]
    print(f"\n--- Binary Features ---")
    print(f"{'Feature':<30} {'N=1':>6} {'Has=1 PnL':>12} {'Has=0 PnL':>12} {'Spread':>10} {'p-value':>12}")
    print("-" * 85)

    for feat in binary:
        if feat not in df.columns:
            continue
        has = df[df[feat] == 1]["holly_pnl"].astype(float)
        no = df[df[feat] == 0]["holly_pnl"].astype(float)
        if len(has) < 10:
            print(f"{feat:<30} {'N/A (< 10 trades)':>50}")
            continue

        t_stat, p_val = stats.ttest_ind(has, no, equal_var=False)
        spread = has.mean() - no.mean()
        flag = " ***" if p_val < 0.001 else " **" if p_val < 0.01 else " *" if p_val < 0.05 else ""
        print(f"{feat:<30} {len(has):>6,} ${has.mean():>10,.0f} ${no.mean():>10,.0f} ${spread:>8,.0f} {p_val:>12.2e}{flag}")
        results.append({"feature": feat, "d": spread, "p": p_val, "type": "binary"})

    # News presence vs absence
    print(f"\n--- News Presence Effect ---")
    for window, col in [("24h", "news_count_24h"), ("7d", "news_count_7d"), ("30d", "news_count_30d")]:
        has_news = df[df[col] > 0]["holly_pnl"].astype(float)
        no_news = df[df[col] == 0]["holly_pnl"].astype(float)
        if len(has_news) < 30:
            continue
        t_stat, p_val = stats.ttest_ind(has_news, no_news, equal_var=False)
        print(f"  {window}: news=${has_news.mean():,.0f} (n={len(has_news):,}) vs no_news=${no_news.mean():,.0f} (n={len(no_news):,}) | p={p_val:.2e}")

    # OOS validation for best features
    print(f"\n--- OOS Validation (60/40 chronological split) ---")
    df_sorted = df.sort_values("entry_time")
    split = int(len(df_sorted) * 0.6)
    train = df_sorted.iloc[:split]
    test = df_sorted.iloc[split:]

    print(f"  Train: {len(train):,} | Test: {len(test):,}")
    print(f"  {'Feature':<30} {'d_train':>10} {'d_test':>10} {'Stable?':>10}")
    print(f"  {'-'*65}")

    for feat in continuous + binary:
        if feat not in df.columns:
            continue

        def _cohen_d(subset, feature):
            w = subset[subset["win"] == 1][feature].astype(float).dropna()
            l = subset[subset["win"] == 0][feature].astype(float).dropna()
            if len(w) < 20 or len(l) < 20:
                return None
            pooled = np.sqrt(((len(w)-1)*w.std()**2 + (len(l)-1)*l.std()**2) / (len(w)+len(l)-2))
            return (w.mean() - l.mean()) / pooled if pooled > 0 else 0.0

        d_train = _cohen_d(train, feat)
        d_test = _cohen_d(test, feat)

        if d_train is not None and d_test is not None:
            stable = "YES" if (d_train > 0 and d_test > 0) or (d_train < 0 and d_test < 0) else "FLIP"
            print(f"  {feat:<30} {d_train:>10.4f} {d_test:>10.4f} {stable:>10}")

    return results


def main():
    t0 = time.time()
    con = duckdb.connect(str(DUCKDB_PATH))
    print(f"Connected to {DUCKDB_PATH.name}")

    # Check prerequisites
    tables = [r[0] for r in con.execute(
        "SELECT table_name FROM information_schema.tables"
    ).fetchall()]

    if "benzinga_news_broad" not in tables:
        print("ERROR: benzinga_news_broad table not found. Run script 77 first.")
        sys.exit(1)

    broad_count = con.execute("SELECT COUNT(*) FROM benzinga_news_broad").fetchone()[0]
    trade_count = con.execute("SELECT COUNT(*) FROM trades").fetchone()[0]
    print(f"  benzinga_news_broad: {broad_count:,} articles")
    print(f"  trades: {trade_count:,} trades")

    # Compute features
    features_df = compute_broad_features(con)

    # Summary
    has_24h = (features_df["news_count_24h"] > 0).sum()
    has_7d = (features_df["news_count_7d"] > 0).sum()
    has_30d = (features_df["news_count_30d"] > 0).sum()
    print(f"\n{'='*60}")
    print(f"Feature Summary (BROAD)")
    print(f"{'='*60}")
    print(f"  Total trades:          {len(features_df):,}")
    print(f"  Trades with 24h news:  {has_24h:,} ({100*has_24h/len(features_df):.1f}%)")
    print(f"  Trades with 7d news:   {has_7d:,} ({100*has_7d/len(features_df):.1f}%)")
    print(f"  Trades with 30d news:  {has_30d:,} ({100*has_30d/len(features_df):.1f}%)")
    print(f"  Avg news_count_24h:    {features_df['news_count_24h'].mean():.2f}")
    print(f"  Avg news_count_7d:     {features_df['news_count_7d'].mean():.2f}")
    print(f"  Avg news_count_30d:    {features_df['news_count_30d'].mean():.2f}")
    print(f"  Has earnings news:     {features_df['has_earnings_news'].sum():,}")
    print(f"  Has analyst rating:    {features_df['has_analyst_rating'].sum():,}")
    print(f"  Has movers news:       {features_df['has_movers_news'].sum():,}")
    print(f"  Avg market news 24h:   {features_df['broad_market_news_24h'].mean():.0f}")

    # Compare with narrow
    if "benzinga_features" in tables:
        narrow = con.execute("SELECT * FROM benzinga_features").fetchdf()
        print(f"\n  --- Narrow vs Broad comparison ---")
        print(f"  Narrow trades with 24h news: {(narrow['news_count_24h'] > 0).sum():,}/{len(narrow):,}")
        print(f"  Broad trades with 24h news:  {has_24h:,}/{len(features_df):,}")

    # Write to DuckDB
    print(f"\nWriting benzinga_features_broad table...")
    con.execute("DROP TABLE IF EXISTS benzinga_features_broad")
    con.execute("CREATE TABLE benzinga_features_broad AS SELECT * FROM features_df")
    cnt = con.execute("SELECT COUNT(*) FROM benzinga_features_broad").fetchone()[0]
    print(f"  benzinga_features_broad: {cnt:,} rows")

    # Write parquet
    OUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    features_df.to_parquet(str(OUT_FILE), index=False)
    print(f"  Parquet: {OUT_FILE.name} ({OUT_FILE.stat().st_size / 1e6:.1f} MB)")

    # Run lift analysis
    lift_results = run_lift_analysis(features_df)

    elapsed = time.time() - t0
    print(f"\nDone in {elapsed:.1f}s")
    con.close()


if __name__ == "__main__":
    main()
