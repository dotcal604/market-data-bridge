"""
25_fetch_ticker_events.py — Fetch ticker lifecycle events from Polygon.

Downloads ticker change events (symbol renames, delistings, etc.) for all
Holly-traded symbols + ETFs. This is the survivorship bias shield — if a
ticker was renamed (FB→META) or delisted, we capture the lineage.

Endpoint: /vX/reference/tickers/{ticker}/events (per-symbol)
Event types: ticker_change (symbol renames/rebranding)

Usage:
    python scripts/25_fetch_ticker_events.py
    python scripts/25_fetch_ticker_events.py --refresh     # re-fetch even if cached
"""

import argparse
import asyncio
import sys
import time
from pathlib import Path

import httpx
import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq

sys.path.insert(0, str(Path(__file__).parent.parent))

from config.settings import (
    POLYGON_API_KEY,
    DATA_DIR,
    DUCKDB_PATH,
    POLYGON_CONCURRENCY,
)

POLYGON_BASE = "https://api.polygon.io"
REF_DIR = DATA_DIR / "reference"


async def fetch_one_ticker_events(
    client: httpx.AsyncClient,
    sem: asyncio.Semaphore,
    symbol: str,
) -> tuple[str, bool, list[dict]]:
    """Fetch ticker events for one symbol."""
    url = f"{POLYGON_BASE}/vX/reference/tickers/{symbol}/events"
    params = {"apiKey": POLYGON_API_KEY}

    for attempt in range(3):
        async with sem:
            try:
                resp = await client.get(url, params=params, timeout=15)

                if resp.status_code == 429:
                    await asyncio.sleep(2 ** (attempt + 1))
                    continue
                if resp.status_code in (404, 403):
                    return symbol, False, []
                if resp.status_code != 200:
                    return symbol, False, []

                data = resp.json()
                results = data.get("results", {})
                events = results.get("events", [])
                asset_name = results.get("name", "")

                rows = []
                for ev in events:
                    row = {
                        "symbol": symbol,
                        "asset_name": asset_name,
                        "event_type": ev.get("type", ""),
                        "event_date": ev.get("date", ""),
                    }

                    # ticker_change events have nested ticker_change dict
                    tc = ev.get("ticker_change", {})
                    if tc:
                        row["old_ticker"] = tc.get("ticker", "")
                    else:
                        row["old_ticker"] = ""

                    rows.append(row)

                return symbol, True, rows

            except (httpx.TimeoutException, httpx.ConnectError):
                if attempt < 2:
                    await asyncio.sleep(2 ** (attempt + 1))
                    continue
                return symbol, False, []
            except Exception:
                return symbol, False, []

    return symbol, False, []


async def fetch_ticker_events(
    client: httpx.AsyncClient,
    refresh: bool = False,
) -> pd.DataFrame:
    """Fetch ticker events for all traded symbols."""
    out_file = REF_DIR / "ticker_events.parquet"

    if out_file.exists() and not refresh:
        df = pd.read_parquet(out_file)
        print(f"  Cached: {len(df):,} events -> {out_file.name}")
        return df

    print("=" * 60)
    print("Fetching ticker events (per-symbol)...")
    print("=" * 60)

    # Get unique symbols from trades + ETFs
    import duckdb

    con = duckdb.connect(str(DUCKDB_PATH), read_only=True)

    # Get all symbols we have data for
    symbols_query = """
        SELECT DISTINCT symbol FROM trades
        UNION
        SELECT DISTINCT symbol FROM etf_bars
        ORDER BY 1
    """
    try:
        symbols = con.execute(symbols_query).fetchdf()["symbol"].tolist()
    except Exception:
        # Fallback if etf_bars doesn't exist
        symbols = con.execute(
            "SELECT DISTINCT symbol FROM trades ORDER BY 1"
        ).fetchdf()["symbol"].tolist()
    con.close()

    print(f"  Symbols to fetch: {len(symbols):,}")

    sem = asyncio.Semaphore(POLYGON_CONCURRENCY)
    tasks = [fetch_one_ticker_events(client, sem, sym) for sym in symbols]

    success = fail = 0
    all_rows: list[dict] = []
    events_found = 0
    t0 = time.time()
    total = len(tasks)

    for coro in asyncio.as_completed(tasks):
        sym, ok, rows = await coro
        if ok:
            success += 1
            if rows:
                all_rows.extend(rows)
                events_found += len(rows)
        else:
            fail += 1

        done = success + fail
        if done % 500 == 0 or done == total or done <= 3:
            elapsed = time.time() - t0
            rate = done / max(elapsed, 0.1)
            eta = (total - done) / max(rate, 0.01)
            print(
                f"  [{done}/{total}] {sym}: {'ok' if ok else 'fail'}  "
                f"| ok={success} fail={fail} events={events_found}  "
                f"| {rate:.1f}/s, ETA {eta / 60:.1f}m",
                flush=True,
            )

    if not all_rows:
        print("  No ticker events found!")
        # Still save empty parquet for cache
        df = pd.DataFrame(
            columns=["symbol", "asset_name", "event_type", "event_date", "old_ticker"]
        )
        REF_DIR.mkdir(parents=True, exist_ok=True)
        pq.write_table(pa.Table.from_pandas(df), str(out_file))
        return df

    df = pd.DataFrame(all_rows)

    # Drop exact dupes
    before = len(df)
    df = df.drop_duplicates().reset_index(drop=True)
    dupes = before - len(df)
    if dupes:
        print(f"  Dropped {dupes:,} duplicates")

    REF_DIR.mkdir(parents=True, exist_ok=True)
    pq.write_table(pa.Table.from_pandas(df), str(out_file))

    elapsed = time.time() - t0
    print(f"\n  Saved: {len(df):,} events in {elapsed / 60:.1f}m -> {out_file.name}")
    print(f"  Size: {out_file.stat().st_size / 1e3:.1f} KB")
    print(f"  Symbols with events: {df['symbol'].nunique():,}")
    print(f"  Ticker changes: {(df['event_type'] == 'ticker_change').sum():,}")
    return df


def load_to_duckdb():
    """Load ticker events into DuckDB."""
    import duckdb

    print("\n" + "=" * 60)
    print("Loading ticker events into DuckDB...")
    print("=" * 60)

    con = duckdb.connect(str(DUCKDB_PATH))

    pf = REF_DIR / "ticker_events.parquet"
    if not pf.exists():
        print("  ticker_events: no parquet file, skipping")
        con.close()
        return

    con.execute("DROP TABLE IF EXISTS ticker_events")
    con.execute(f"""
        CREATE TABLE ticker_events AS
        SELECT * FROM read_parquet('{pf}')
    """)
    cnt = con.execute("SELECT COUNT(*) FROM ticker_events").fetchone()[0]
    print(f"  ticker_events: {cnt:,} rows")

    # Show summary
    if cnt > 0:
        changes = con.execute("""
            SELECT COUNT(*) FROM ticker_events
            WHERE event_type = 'ticker_change'
        """).fetchone()[0]
        symbols = con.execute("""
            SELECT COUNT(DISTINCT symbol) FROM ticker_events
        """).fetchone()[0]
        print(f"  Ticker changes: {changes:,}")
        print(f"  Symbols with events: {symbols:,}")

        # Show some examples
        examples = con.execute("""
            SELECT symbol, old_ticker, event_date, asset_name
            FROM ticker_events
            WHERE event_type = 'ticker_change' AND old_ticker != ''
            ORDER BY event_date DESC
            LIMIT 10
        """).fetchdf()
        if len(examples) > 0:
            print("\n  Recent ticker changes:")
            for _, row in examples.iterrows():
                print(
                    f"    {row['old_ticker']} -> {row['symbol']}  "
                    f"({row['event_date']})  {row['asset_name']}"
                )

    con.close()


async def main_async(refresh: bool = False):
    if not POLYGON_API_KEY:
        print("ERROR: POLYGON_API_KEY not set in .env")
        sys.exit(1)

    REF_DIR.mkdir(parents=True, exist_ok=True)

    async with httpx.AsyncClient() as client:
        await fetch_ticker_events(client, refresh=refresh)

    load_to_duckdb()

    print("\n" + "=" * 60)
    print("Ticker events fetch complete!")
    print("=" * 60)


def main():
    parser = argparse.ArgumentParser(
        description="Fetch Polygon ticker lifecycle events (survivorship bias)"
    )
    parser.add_argument(
        "--refresh",
        action="store_true",
        help="Re-fetch even if cached parquet exists",
    )
    args = parser.parse_args()
    asyncio.run(main_async(refresh=args.refresh))


if __name__ == "__main__":
    main()
