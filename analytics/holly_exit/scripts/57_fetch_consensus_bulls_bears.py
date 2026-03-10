"""
57_fetch_consensus_bulls_bears.py — Fetch Benzinga consensus ratings and
bulls/bears say via Massive.com API.

Per unique Holly symbol: fetches two Benzinga endpoints and saves to two
separate parquet/DuckDB tables:

1. Consensus Ratings — GET /benzinga/v1/consensus-ratings/{ticker}
   Table: benzinga_consensus_ratings
   Dedup: ticker (latest snapshot only)

2. Bulls Bears Say — GET /benzinga/v1/bulls-bears-say?ticker={symbol}
   Table: benzinga_bulls_bears
   Dedup: ticker + benzinga_id

Both endpoints are fetched per symbol in a single async task to minimize
round trips. Use --type to control which to fetch.

Requires: Massive Advanced plan ($199/mo) with Benzinga expansion.
API key: same POLYGON_API_KEY from .env (works on api.massive.com).

Usage:
    python scripts/57_fetch_consensus_bulls_bears.py
    python scripts/57_fetch_consensus_bulls_bears.py --smoke
    python scripts/57_fetch_consensus_bulls_bears.py --type consensus
    python scripts/57_fetch_consensus_bulls_bears.py --type bulls_bears
    python scripts/57_fetch_consensus_bulls_bears.py --type all
"""

import argparse
import asyncio
import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import httpx
import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq

sys.path.insert(0, str(Path(__file__).parent.parent))

from config.settings import POLYGON_API_KEY, DATA_DIR, DUCKDB_PATH, POLYGON_CONCURRENCY

MASSIVE_BASE = "https://api.massive.com"
REF_DIR = DATA_DIR / "reference"

CONSENSUS_OUT_FILE = REF_DIR / "benzinga_consensus_ratings.parquet"
BULLS_BEARS_OUT_FILE = REF_DIR / "benzinga_bulls_bears.parquet"

SEMAPHORE = asyncio.Semaphore(POLYGON_CONCURRENCY if POLYGON_CONCURRENCY else 10)


def load_unique_symbols() -> list[str]:
    """Load all unique Holly-traded symbols from DuckDB."""
    import duckdb
    db = duckdb.connect(str(DUCKDB_PATH), read_only=True)
    rows = db.execute("""
        SELECT DISTINCT symbol FROM trades
        WHERE CAST(entry_time AS DATE) >= '2021-01-01'
        ORDER BY symbol
    """).fetchall()
    db.close()
    return [r[0] for r in rows]


async def fetch_paginated(
    client: httpx.AsyncClient,
    url: str,
    params: dict,
) -> list[dict]:
    """
    Fetch all results from a paginated Benzinga v1 endpoint.
    Follows next_url until exhausted.
    """
    all_results = []
    use_params = True
    current_url: str | None = url

    while current_url:
        for attempt in range(3):
            try:
                if use_params:
                    resp = await client.get(current_url, params=params, timeout=15)
                    use_params = False
                else:
                    resp = await client.get(current_url, timeout=15)

                if resp.status_code == 429:
                    await asyncio.sleep(2 ** (attempt + 1))
                    continue

                if resp.status_code in (403, 404):
                    return all_results

                if resp.status_code != 200:
                    return all_results

                data = resp.json()
                results = data.get("results", [])
                if isinstance(results, list):
                    all_results.extend(results)
                elif isinstance(results, dict):
                    # Single-object result (consensus ratings returns one object)
                    all_results.append(results)

                next_url = data.get("next_url")
                if next_url:
                    current_url = f"{next_url}&apiKey={POLYGON_API_KEY}"
                else:
                    current_url = None
                break

            except (httpx.TimeoutException, httpx.ConnectError):
                if attempt < 2:
                    await asyncio.sleep(2 ** (attempt + 1))
                    continue
                return all_results

    return all_results


async def fetch_symbol(
    client: httpx.AsyncClient,
    symbol: str,
    fetch_consensus: bool,
    fetch_bulls_bears: bool,
) -> tuple[list[dict], list[dict]]:
    """
    Fetch both consensus ratings and bulls/bears say for a single symbol.
    Returns (consensus_rows, bulls_bears_rows).
    """
    consensus_rows: list[dict] = []
    bulls_bears_rows: list[dict] = []
    now_iso = datetime.now(timezone.utc).isoformat()

    async with SEMAPHORE:
        # --- Consensus Ratings ---
        if fetch_consensus:
            url = f"{MASSIVE_BASE}/benzinga/v1/consensus-ratings/{symbol}"
            params = {
                "limit": "5000",
                "apiKey": POLYGON_API_KEY,
            }
            results = await fetch_paginated(client, url, params)

            for r in results:
                consensus_rows.append({
                    "ticker": symbol,
                    "consensus_rating": r.get("consensus_rating"),
                    "consensus_rating_value": r.get("consensus_rating_value"),
                    "strong_buy": r.get("strong_buy"),
                    "buy": r.get("buy"),
                    "hold": r.get("hold"),
                    "sell": r.get("sell"),
                    "strong_sell": r.get("strong_sell"),
                    "consensus_pt": r.get("consensus_pt"),
                    "pt_high": r.get("pt_high"),
                    "pt_low": r.get("pt_low"),
                    "num_ratings": r.get("num_ratings"),
                    "num_pt": r.get("num_pt"),
                    "fetched_at": now_iso,
                })

        # --- Bulls Bears Say ---
        if fetch_bulls_bears:
            url = f"{MASSIVE_BASE}/benzinga/v1/bulls-bears-say"
            params = {
                "ticker": symbol,
                "limit": "5000",
                "apiKey": POLYGON_API_KEY,
            }
            results = await fetch_paginated(client, url, params)

            for r in results:
                bulls_bears_rows.append({
                    "ticker": r.get("ticker", symbol),
                    "bull_case": r.get("bull_case"),
                    "bear_case": r.get("bear_case"),
                    "benzinga_id": r.get("benzinga_id") or r.get("id"),
                    "last_updated": r.get("last_updated"),
                    "fetched_at": now_iso,
                })

    return consensus_rows, bulls_bears_rows


def load_to_duckdb_consensus(parquet_file: Path):
    """Load consensus ratings into DuckDB."""
    import duckdb

    if not parquet_file.exists():
        print("  No consensus parquet file to load")
        return

    print(f"\nLoading consensus ratings into DuckDB ({DUCKDB_PATH.name})...")
    con = duckdb.connect(str(DUCKDB_PATH))
    con.execute("DROP TABLE IF EXISTS benzinga_consensus_ratings")
    con.execute(f"""
        CREATE TABLE benzinga_consensus_ratings AS
        SELECT * FROM read_parquet('{parquet_file}')
    """)
    cnt = con.execute("SELECT COUNT(*) FROM benzinga_consensus_ratings").fetchone()[0]
    unique_tickers = con.execute(
        "SELECT COUNT(DISTINCT ticker) FROM benzinga_consensus_ratings"
    ).fetchone()[0]
    print(f"  benzinga_consensus_ratings: {cnt:,} rows, {unique_tickers:,} tickers")
    con.close()


def load_to_duckdb_bulls_bears(parquet_file: Path):
    """Load bulls/bears say into DuckDB."""
    import duckdb

    if not parquet_file.exists():
        print("  No bulls/bears parquet file to load")
        return

    print(f"\nLoading bulls/bears say into DuckDB ({DUCKDB_PATH.name})...")
    con = duckdb.connect(str(DUCKDB_PATH))
    con.execute("DROP TABLE IF EXISTS benzinga_bulls_bears")
    con.execute(f"""
        CREATE TABLE benzinga_bulls_bears AS
        SELECT * FROM read_parquet('{parquet_file}')
    """)
    cnt = con.execute("SELECT COUNT(*) FROM benzinga_bulls_bears").fetchone()[0]
    unique_tickers = con.execute(
        "SELECT COUNT(DISTINCT ticker) FROM benzinga_bulls_bears"
    ).fetchone()[0]
    unique_ids = con.execute(
        "SELECT COUNT(DISTINCT benzinga_id) FROM benzinga_bulls_bears WHERE benzinga_id IS NOT NULL"
    ).fetchone()[0]
    print(f"  benzinga_bulls_bears: {cnt:,} rows, {unique_tickers:,} tickers, {unique_ids:,} unique IDs")
    con.close()


async def main_async(args):
    if not POLYGON_API_KEY:
        print("ERROR: POLYGON_API_KEY not set in .env")
        sys.exit(1)

    REF_DIR.mkdir(parents=True, exist_ok=True)

    fetch_consensus = args.type in ("all", "consensus")
    fetch_bulls_bears = args.type in ("all", "bulls_bears")

    print(f"Fetch mode: {args.type}")
    if fetch_consensus:
        print("  -> Consensus ratings: ENABLED")
    if fetch_bulls_bears:
        print("  -> Bulls/bears say: ENABLED")

    print("\nLoading unique Holly symbols from DuckDB...")
    symbols = load_unique_symbols()
    print(f"  Total unique symbols: {len(symbols)}")

    if not symbols:
        print("No symbols found!")
        return

    if args.smoke:
        symbols = symbols[:5]
        print(f"\n  SMOKE TEST: fetching only {len(symbols)} symbols")

    # Load existing data for merge/dedup
    existing_consensus_tickers: set[str] = set()
    all_consensus_rows: list[dict] = []
    if fetch_consensus and CONSENSUS_OUT_FILE.exists():
        existing_df = pd.read_parquet(CONSENSUS_OUT_FILE)
        existing_consensus_tickers = set(existing_df["ticker"])
        all_consensus_rows = existing_df.to_dict("records")
        print(f"  Existing consensus ratings: {len(existing_consensus_tickers):,} tickers")

    existing_bb_keys: set[str] = set()
    all_bb_rows: list[dict] = []
    if fetch_bulls_bears and BULLS_BEARS_OUT_FILE.exists():
        existing_df = pd.read_parquet(BULLS_BEARS_OUT_FILE)
        for _, row in existing_df.iterrows():
            key = f"{row['ticker']}:{row.get('benzinga_id', '')}"
            existing_bb_keys.add(key)
        all_bb_rows = existing_df.to_dict("records")
        print(f"  Existing bulls/bears records: {len(all_bb_rows):,}")

    # Determine which symbols still need fetching
    remaining_consensus = [s for s in symbols if s not in existing_consensus_tickers] if fetch_consensus else []
    remaining_bb = [s for s in symbols] if fetch_bulls_bears else []  # Always re-check for new entries

    # Union of remaining symbols for both endpoints
    remaining_set = set(remaining_consensus) | set(remaining_bb) if fetch_consensus and fetch_bulls_bears else set(remaining_consensus or remaining_bb)
    remaining = sorted(remaining_set)

    if fetch_consensus:
        print(f"  Consensus remaining: {len(remaining_consensus)}")
    if fetch_bulls_bears:
        print(f"  Bulls/bears symbols to check: {len(remaining_bb)}")
    print(f"  Total symbols to process: {len(remaining)}")

    if not remaining:
        print("All symbols already fetched!")
        if fetch_consensus and CONSENSUS_OUT_FILE.exists():
            load_to_duckdb_consensus(CONSENSUS_OUT_FILE)
        if fetch_bulls_bears and BULLS_BEARS_OUT_FILE.exists():
            load_to_duckdb_bulls_bears(BULLS_BEARS_OUT_FILE)
        return

    print(f"\n{'=' * 60}")
    print("Fetching from Massive.com Benzinga API...")
    print(f"{'=' * 60}")

    t0 = time.time()
    new_consensus = 0
    new_bb = 0
    failed = 0

    async with httpx.AsyncClient() as client:
        batch_size = 50
        for batch_start in range(0, len(remaining), batch_size):
            batch = remaining[batch_start:batch_start + batch_size]
            tasks = [
                fetch_symbol(
                    client, sym,
                    fetch_consensus=fetch_consensus and sym in set(remaining_consensus),
                    fetch_bulls_bears=fetch_bulls_bears,
                )
                for sym in batch
            ]
            results = await asyncio.gather(*tasks)

            for sym, (c_rows, bb_rows) in zip(batch, results):
                # Process consensus results
                if c_rows:
                    # Keep only latest snapshot per ticker — replace existing
                    all_consensus_rows = [
                        r for r in all_consensus_rows if r["ticker"] != sym
                    ]
                    all_consensus_rows.extend(c_rows)
                    new_consensus += len(c_rows)
                elif fetch_consensus and sym in set(remaining_consensus):
                    failed += 1

                # Process bulls/bears results
                for bb in bb_rows:
                    key = f"{bb['ticker']}:{bb.get('benzinga_id', '')}"
                    if key not in existing_bb_keys:
                        all_bb_rows.append(bb)
                        existing_bb_keys.add(key)
                        new_bb += 1

            done = batch_start + len(batch)
            elapsed = time.time() - t0
            if done % 100 == 0 or done == len(remaining) or batch_start == 0:
                parts = []
                if fetch_consensus:
                    parts.append(f"+{new_consensus} consensus")
                if fetch_bulls_bears:
                    parts.append(f"+{new_bb} bulls/bears")
                parts.append(f"{failed} failed")
                print(
                    f"  [{done}/{len(remaining)}] "
                    f"{' | '.join(parts)} | {elapsed:.0f}s"
                )

    # --- Save consensus ratings ---
    if fetch_consensus and all_consensus_rows:
        df_c = pd.DataFrame(all_consensus_rows)
        # Dedup: keep last per ticker (latest snapshot)
        df_c = df_c.drop_duplicates(subset=["ticker"], keep="last").reset_index(drop=True)

        pq.write_table(
            pa.Table.from_pandas(df_c), str(CONSENSUS_OUT_FILE), compression="zstd"
        )

        print(f"\n--- Consensus Ratings ---")
        print(f"  New this run: {new_consensus:,}")
        print(f"  Total tickers: {len(df_c):,}")
        print(f"  File size: {CONSENSUS_OUT_FILE.stat().st_size / 1e6:.1f} MB")

        if not df_c.empty:
            has_rating = df_c["consensus_rating"].notna().sum()
            has_pt = df_c["consensus_pt"].notna().sum()
            print(f"  With consensus rating: {has_rating:,}")
            print(f"  With consensus PT: {has_pt:,}")

        load_to_duckdb_consensus(CONSENSUS_OUT_FILE)

    # --- Save bulls/bears say ---
    if fetch_bulls_bears and all_bb_rows:
        df_bb = pd.DataFrame(all_bb_rows)
        # Dedup on ticker + benzinga_id
        df_bb = df_bb.drop_duplicates(
            subset=["ticker", "benzinga_id"], keep="last"
        ).reset_index(drop=True)

        pq.write_table(
            pa.Table.from_pandas(df_bb), str(BULLS_BEARS_OUT_FILE), compression="zstd"
        )

        print(f"\n--- Bulls Bears Say ---")
        print(f"  New this run: {new_bb:,}")
        print(f"  Total records: {len(df_bb):,}")
        print(f"  Unique tickers: {df_bb['ticker'].nunique():,}")
        print(f"  File size: {BULLS_BEARS_OUT_FILE.stat().st_size / 1e6:.1f} MB")

        if not df_bb.empty:
            has_bull = df_bb["bull_case"].notna().sum()
            has_bear = df_bb["bear_case"].notna().sum()
            print(f"  With bull case: {has_bull:,}")
            print(f"  With bear case: {has_bear:,}")

        load_to_duckdb_bulls_bears(BULLS_BEARS_OUT_FILE)

    elapsed = time.time() - t0
    print(f"\n{'=' * 60}")
    print(f"Fetch complete!")
    print(f"{'=' * 60}")
    print(f"  Failed symbols: {failed:,}")
    print(f"  Elapsed: {elapsed:.0f}s")


def main():
    parser = argparse.ArgumentParser(
        description="Fetch Benzinga consensus ratings and bulls/bears say via Massive.com"
    )
    parser.add_argument(
        "--smoke", action="store_true",
        help="Smoke test: fetch only first 5 symbols"
    )
    parser.add_argument(
        "--type", default="all", choices=["all", "consensus", "bulls_bears"],
        help="Which data to fetch: consensus, bulls_bears, or all (default: all)"
    )
    args = parser.parse_args()
    asyncio.run(main_async(args))


if __name__ == "__main__":
    main()
