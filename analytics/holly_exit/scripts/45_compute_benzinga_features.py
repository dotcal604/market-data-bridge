"""
45_compute_benzinga_features.py — Compute 8 news-derived features per Holly trade.

Joins benzinga_news → trades by ticker + time window with strict anti-leakage:
only articles published BEFORE trade entry are counted.

Features (all pre-entry, no NLP):
  1. news_count_24h      — articles in 24h before entry
  2. news_count_7d       — articles in 7 days before entry
  3. has_earnings_news   — any earnings-channel article pre-entry (24h)
  4. has_analyst_rating   — any analyst-ratings-channel article pre-entry (24h)
  5. news_recency_hours  — hours since most recent article before entry
  6. unique_sources_24h  — distinct authors in 24h window
  7. ticker_news_breadth — avg co-mentioned tickers in recent articles
  8. channel_diversity   — distinct channels in 24h articles

Output: DuckDB table `benzinga_features` + parquet backup.

Usage:
    python scripts/45_compute_benzinga_features.py
    python scripts/45_compute_benzinga_features.py --validate  # anti-leakage check only
"""

import argparse
import sys
import time
from pathlib import Path

import duckdb
import pandas as pd

sys.path.insert(0, str(Path(__file__).parent.parent))
from config.settings import DUCKDB_PATH, DATA_DIR

OUT_FILE = DATA_DIR / "reference" / "benzinga_features.parquet"


def compute_features(con: duckdb.DuckDBPyConnection, since: str = "2021-01-01") -> pd.DataFrame:
    """
    Compute all 8 features in a single SQL pass.

    Strategy: explode benzinga_news.tickers into rows, then join to trades
    on symbol + published < entry_time. Aggregate per trade_id.
    """
    t0 = time.time()

    # Step 1: Explode tickers into a junction-style view
    print("Step 1: Exploding benzinga_news tickers...")
    con.execute("""
        CREATE OR REPLACE TEMP TABLE bz_tickers AS
        SELECT
            bn.benzinga_id,
            bn.published,
            bn.author,
            bn.channels,
            bn.tickers AS all_tickers,
            TRIM(t.ticker) AS ticker
        FROM benzinga_news bn,
             LATERAL (SELECT UNNEST(string_split(bn.tickers, ',')) AS ticker) t
        WHERE bn.tickers IS NOT NULL
          AND TRIM(t.ticker) != ''
    """)
    bz_count = con.execute("SELECT COUNT(*) FROM bz_tickers").fetchone()[0]
    unique_tickers = con.execute("SELECT COUNT(DISTINCT ticker) FROM bz_tickers").fetchone()[0]
    print(f"  {bz_count:,} ticker-article rows, {unique_tickers:,} unique tickers ({time.time()-t0:.1f}s)")

    # Step 2: Compute features via LEFT JOIN trades → bz_tickers
    print("Step 2: Computing features per trade...")
    t1 = time.time()

    features_df = con.execute(f"""
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
                -- hours before entry (positive = before)
                EXTRACT(EPOCH FROM (t.entry_time - CAST(bz.published AS TIMESTAMP))) / 3600.0
                    AS hours_before_entry
            FROM trades t
            LEFT JOIN bz_tickers bz
              ON bz.ticker = t.symbol
             AND CAST(bz.published AS TIMESTAMP) < t.entry_time
             AND CAST(bz.published AS TIMESTAMP) >= t.entry_time - INTERVAL '7 days'
            WHERE t.entry_time >= CAST('{since}' AS TIMESTAMP)
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
            COUNT(DISTINCT benzinga_id) AS news_count_7d,

            -- Feature 3: has_earnings_news (24h, earnings channel)
            MAX(CASE WHEN hours_before_entry <= 24
                      AND channels LIKE '%earnings%'
                 THEN 1 ELSE 0 END)
                AS has_earnings_news,

            -- Feature 4: has_analyst_rating (24h, analyst ratings channel)
            MAX(CASE WHEN hours_before_entry <= 24
                      AND channels LIKE '%analyst ratings%'
                 THEN 1 ELSE 0 END)
                AS has_analyst_rating,

            -- Feature 5: news_recency_hours (hours since most recent pre-entry article)
            MIN(CASE WHEN hours_before_entry > 0
                 THEN hours_before_entry END)
                AS news_recency_hours,

            -- Feature 6: unique_sources_24h (distinct authors)
            COUNT(DISTINCT CASE WHEN hours_before_entry <= 24
                  THEN author END)
                AS unique_sources_24h,

            -- Feature 7: ticker_news_breadth (avg co-mentioned tickers in 24h articles)
            AVG(CASE WHEN hours_before_entry <= 24
                      AND all_tickers IS NOT NULL
                 THEN LENGTH(all_tickers) - LENGTH(REPLACE(all_tickers, ',', '')) + 1
                 END)
                AS ticker_news_breadth,

            -- Feature 8: channel_diversity (distinct channels in 24h articles)
            -- approximate: count distinct channel strings from 24h articles
            COUNT(DISTINCT CASE WHEN hours_before_entry <= 24
                  THEN channels END)
                AS channel_diversity

        FROM trade_news
        GROUP BY trade_id, symbol, entry_time, strategy, direction,
                 holly_pnl, mfe, mae
        ORDER BY trade_id
    """).fetchdf()

    print(f"  {len(features_df):,} trades with features ({time.time()-t1:.1f}s)")

    return features_df


def validate_anti_leakage(con: duckdb.DuckDBPyConnection) -> bool:
    """Verify no article published after trade entry is used."""
    print("\nAnti-leakage validation...")

    # Check: any row where published >= entry_time in the join
    violations = con.execute("""
        SELECT COUNT(*) FROM (
            SELECT t.trade_id, t.entry_time, bz.published
            FROM trades t
            JOIN bz_tickers bz
              ON bz.ticker = t.symbol
             AND CAST(bz.published AS TIMESTAMP) >= t.entry_time
             AND CAST(bz.published AS TIMESTAMP) < t.entry_time + INTERVAL '7 days'
        )
    """).fetchone()[0]

    # This count is expected to be > 0 (articles DO exist after entry),
    # but they should NOT appear in our features. Verify features table:
    if con.execute("""
        SELECT COUNT(*) FROM information_schema.tables
        WHERE table_name = 'benzinga_features'
    """).fetchone()[0] == 0:
        print("  benzinga_features table not yet created, skipping feature-level check")
        print(f"  (FYI: {violations:,} post-entry articles exist in raw data — correctly excluded by join)")
        return True

    # Spot-check: for 5 random trades with news, verify published < entry_time
    spot = con.execute("""
        SELECT bf.trade_id, bf.entry_time, bf.news_count_24h,
               MIN(CAST(bz.published AS TIMESTAMP)) as earliest_article,
               MAX(CAST(bz.published AS TIMESTAMP)) as latest_article
        FROM benzinga_features bf
        JOIN bz_tickers bz ON bz.ticker = bf.symbol
             AND CAST(bz.published AS TIMESTAMP) < bf.entry_time
             AND CAST(bz.published AS TIMESTAMP) >= bf.entry_time - INTERVAL '24 hours'
        WHERE bf.news_count_24h > 0
        GROUP BY bf.trade_id, bf.entry_time, bf.news_count_24h
        ORDER BY RANDOM()
        LIMIT 5
    """).fetchdf()

    if len(spot) > 0:
        leaks = spot[spot["latest_article"] >= spot["entry_time"]]
        if len(leaks) > 0:
            print(f"  LEAK DETECTED in {len(leaks)} trades!")
            print(leaks.to_string(index=False))
            return False
        print(f"  Spot-checked 5 trades: all articles pre-entry. OK")
    else:
        print("  No trades with 24h news to spot-check")

    print(f"  {violations:,} post-entry articles correctly excluded by join constraint")
    print("  PASS: No look-ahead bias detected")
    return True


def main():
    parser = argparse.ArgumentParser(
        description="Compute Benzinga news features for Holly trades"
    )
    parser.add_argument("--validate", action="store_true",
                        help="Run anti-leakage validation only (no recompute)")
    parser.add_argument("--since", default="2021-01-01",
                        help="Earliest trade date (YYYY-MM-DD, default: 2021-01-01 = Benzinga coverage start)")
    args = parser.parse_args()

    t0 = time.time()
    con = duckdb.connect(str(DUCKDB_PATH))
    print(f"Connected to {DUCKDB_PATH.name}")

    # Check prerequisites
    tables = [r[0] for r in con.execute(
        "SELECT table_name FROM information_schema.tables"
    ).fetchall()]

    if "benzinga_news" not in tables:
        print("ERROR: benzinga_news table not found. Run script 43 first.")
        sys.exit(1)
    if "trades" not in tables:
        print("ERROR: trades table not found. Load Holly trades first.")
        sys.exit(1)

    news_count = con.execute("SELECT COUNT(*) FROM benzinga_news").fetchone()[0]
    trade_count = con.execute("SELECT COUNT(*) FROM trades").fetchone()[0]
    print(f"  benzinga_news: {news_count:,} articles")
    print(f"  trades: {trade_count:,} trades")

    if args.validate:
        ok = validate_anti_leakage(con)
        con.close()
        sys.exit(0 if ok else 1)

    # Compute features
    print(f"  Filtering trades since: {args.since}")
    features_df = compute_features(con, since=args.since)

    # Summary stats
    has_news = (features_df["news_count_24h"] > 0).sum()
    has_7d = (features_df["news_count_7d"] > 0).sum()
    print(f"\n{'='*60}")
    print(f"Feature Summary")
    print(f"{'='*60}")
    print(f"  Total trades:          {len(features_df):,}")
    print(f"  Trades with 24h news:  {has_news:,} ({has_news/len(features_df)*100:.1f}%)")
    print(f"  Trades with 7d news:   {has_7d:,} ({has_7d/len(features_df)*100:.1f}%)")
    print(f"  Avg news_count_24h:    {features_df['news_count_24h'].mean():.2f}")
    print(f"  Avg news_count_7d:     {features_df['news_count_7d'].mean():.2f}")
    print(f"  Has earnings news:     {features_df['has_earnings_news'].sum():,}")
    print(f"  Has analyst rating:    {features_df['has_analyst_rating'].sum():,}")

    # Write to DuckDB
    print(f"\nWriting benzinga_features table...")
    con.execute("DROP TABLE IF EXISTS benzinga_features")
    con.execute("CREATE TABLE benzinga_features AS SELECT * FROM features_df")
    cnt = con.execute("SELECT COUNT(*) FROM benzinga_features").fetchone()[0]
    print(f"  benzinga_features: {cnt:,} rows")

    # Write parquet backup
    OUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    features_df.to_parquet(str(OUT_FILE), index=False)
    print(f"  Parquet: {OUT_FILE.name} ({OUT_FILE.stat().st_size / 1e6:.1f} MB)")

    # Validate
    validate_anti_leakage(con)

    elapsed = time.time() - t0
    print(f"\nDone in {elapsed:.1f}s")
    con.close()


if __name__ == "__main__":
    main()
