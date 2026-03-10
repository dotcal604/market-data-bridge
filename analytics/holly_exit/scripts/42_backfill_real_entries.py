"""
42_backfill_real_entries.py — Backfill real_entry_price / real_entry_time into DuckDB trades.

Pipeline:
  1. Combine all IBKR TradeConfirmations Flex exports
  2. Parse -> cluster partial fills -> pair round trips  (reuses 29's engine)
  3. Match IBKR round trips to Holly trades (symbol + direction + time window)
  4. UPDATE trades.real_entry_price / real_entry_time / real_commission in DuckDB
  5. Print summary

Usage:
    python scripts/42_backfill_real_entries.py
    python scripts/42_backfill_real_entries.py --files path1.csv path2.csv
    python scripts/42_backfill_real_entries.py --dry-run     # report only, no DB writes
"""

import sys
import argparse
from pathlib import Path
from datetime import timedelta

import pandas as pd

sys.path.insert(0, str(Path(__file__).parent.parent))

from engine.data_loader import get_db, ensure_schema

# Import script 29 functions
sys.path.insert(0, str(Path(__file__).parent))
from importlib import import_module

# We can't import 29 by name directly, so load it
import importlib.util
_s29_path = Path(__file__).parent / "29_map_ibkr_trades.py"
_spec = importlib.util.spec_from_file_location("map_ibkr", str(_s29_path))
_s29 = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_s29)

parse_fills = _s29.parse_fills
cluster_by_order = _s29.cluster_by_order
pair_round_trips = _s29.pair_round_trips
load_holly_trades = _s29.load_holly_trades
match_positions_to_holly = _s29.match_positions_to_holly

# ── Default Flex export paths ─────────────────────────────────────────────

DOWNLOADS = Path.home() / "Downloads"
DEFAULT_FILES = [
    DOWNLOADS / "AllFields_TradeConfirmations (1).csv",   # 2024-09-04 -> 2025-03-06
    DOWNLOADS / "AllFields_TradeConfirmations.csv",        # 2025-03-06 -> 2026-03-05
]

MATCH_WINDOW = timedelta(minutes=480)  # 8 hours -- Holly fires pre-market
MIN_CONFIDENCE = 0.0  # keep all 162 same-day matches


def combine_fills(paths: list[Path]) -> pd.DataFrame:
    """Parse and combine fills from multiple IBKR Flex CSVs, dedup by trade_id."""
    all_fills = []
    for p in paths:
        if not p.exists():
            print(f"  SKIP (not found): {p}")
            continue
        fills = parse_fills(p)
        if not fills.empty:
            all_fills.append(fills)
            print(f"  -> {len(fills)} fills from {p.name}")

    if not all_fills:
        print("ERROR: No fills parsed from any file.")
        sys.exit(1)

    combined = pd.concat(all_fills, ignore_index=True)

    # Dedup by trade_id (same execution can appear in overlapping exports)
    before = len(combined)
    if "trade_id" in combined.columns:
        combined = combined.drop_duplicates(subset=["trade_id"], keep="first")
    print(f"\n  Combined: {before} -> {len(combined)} fills (deduped)")
    return combined


def relaxed_match_ibkr_only(ibkr_only: pd.DataFrame, holly: pd.DataFrame) -> pd.DataFrame:
    """Second-pass matcher for ibkr_only trades: same symbol + same day, ignore direction.

    Picks the closest Holly trade by time on that day. These are trades where the user
    traded a Holly-alerted ticker but possibly in the opposite direction or well outside
    the strict time window.
    """
    results = []
    holly_used = set()

    for _, pos in ibkr_only.iterrows():
        sym = pos["symbol"]
        entry_t = pos["ibkr_entry_time"]
        if pd.isna(entry_t):
            continue

        entry_date = str(entry_t.date()) if hasattr(entry_t, 'date') else str(entry_t)[:10]

        # Find all Holly trades for this symbol on the same day (any direction)
        candidates = holly[
            (holly["symbol"] == sym)
            & (holly["entry_time"].dt.date.astype(str) == entry_date)
            & (~holly["trade_id"].isin(holly_used))
        ]

        if candidates.empty:
            continue

        # Pick closest by time
        time_deltas = (candidates["entry_time"] - entry_t).abs()
        best_idx = time_deltas.idxmin()
        best = candidates.loc[best_idx]
        holly_used.add(best["trade_id"])

        results.append({
            "holly_trade_id": best["trade_id"],
            "ibkr_entry_price": pos["ibkr_entry_price"],
            "ibkr_entry_time": pos["ibkr_entry_time"],
            "ibkr_commission": pos.get("ibkr_commission", 0),
            "match_confidence": 0.01,  # tag as relaxed match
            "category": "relaxed",
            "symbol": sym,
            "strategy": best["strategy"],
        })

    if results:
        return pd.DataFrame(results)
    return pd.DataFrame()


def _upsert_trade(db, tid, real_price, real_time, real_comm, dry_run):
    """UPDATE one trade row. Returns (did_update, did_skip)."""
    existing = db.execute(
        "SELECT real_entry_price FROM trades WHERE trade_id = ?", [tid]
    ).fetchone()

    if existing and existing[0] is not None:
        return False, True  # skip

    if dry_run:
        print(f"  [DRY RUN] trade {tid}: "
              f"real_price={real_price:.4f}, real_time={real_time}")
        return True, False

    real_time_str = str(real_time) if pd.notna(real_time) else None

    if real_comm is not None:
        db.execute("""
            UPDATE trades
            SET real_entry_price = ?,
                real_entry_time = CAST(? AS TIMESTAMP),
                real_commission = ?
            WHERE trade_id = ?
        """, [real_price, real_time_str, real_comm, tid])
    else:
        db.execute("""
            UPDATE trades
            SET real_entry_price = ?,
                real_entry_time = CAST(? AS TIMESTAMP)
            WHERE trade_id = ?
        """, [real_price, real_time_str, tid])

    return True, False


def backfill_db(matched: pd.DataFrame, relaxed: pd.DataFrame, db,
                dry_run: bool = False) -> tuple[int, int]:
    """UPDATE trades table with real entry data from all same-day matches."""
    # Accept matched + review (any confidence)
    good = matched[
        matched["category"].isin(["matched", "review"])
        & matched["holly_trade_id"].notna()
    ].copy()

    updated = 0
    skipped = 0

    # Pass 1: matched + review
    for _, row in good.iterrows():
        tid = int(row["holly_trade_id"])
        real_price = float(row["ibkr_entry_price"])
        real_time = row["ibkr_entry_time"]
        real_comm = float(row["ibkr_commission"]) if pd.notna(row.get("ibkr_commission")) else None

        did_update, did_skip = _upsert_trade(db, tid, real_price, real_time, real_comm, dry_run)
        updated += did_update
        skipped += did_skip

    pass1 = updated
    print(f"  Pass 1 (matched + review): {pass1} updated, {skipped} skipped")

    # Pass 2: relaxed (ibkr_only -> closest Holly same day)
    if not relaxed.empty:
        for _, row in relaxed.iterrows():
            tid = int(row["holly_trade_id"])
            real_price = float(row["ibkr_entry_price"])
            real_time = row["ibkr_entry_time"]
            real_comm = float(row["ibkr_commission"]) if pd.notna(row.get("ibkr_commission")) else None

            did_update, did_skip = _upsert_trade(db, tid, real_price, real_time, real_comm, dry_run)
            updated += did_update
            skipped += did_skip

        print(f"  Pass 2 (relaxed same-day): {updated - pass1} updated")

    return updated, skipped


def main():
    parser = argparse.ArgumentParser(
        description="Backfill real IBKR entry data into Holly trades DuckDB"
    )
    parser.add_argument(
        "--files", nargs="+", type=Path, default=None,
        help="IBKR Flex export CSV paths (default: AllFields_TradeConfirmations in Downloads)"
    )
    parser.add_argument(
        "--window", type=int, default=480,
        help="Match window in minutes (default: 480 = 8 hours)"
    )
    parser.add_argument(
        "--dry-run", action="store_true",
        help="Report matches but don't write to DuckDB"
    )
    args = parser.parse_args()

    files = args.files or DEFAULT_FILES
    window = timedelta(minutes=args.window)

    print("=" * 60)
    print("STEP 1: Parse & combine IBKR fills")
    print("=" * 60)
    combined = combine_fills(files)

    print("\n" + "=" * 60)
    print("STEP 2: Cluster partial fills -> round-trip positions")
    print("=" * 60)
    orders = cluster_by_order(combined)
    positions = pair_round_trips(orders)

    print("\n" + "=" * 60)
    print("STEP 3: Match to Holly trades")
    print("=" * 60)
    db = get_db()
    ensure_schema(db)

    # Get date range from IBKR positions to filter Holly trades
    min_date = positions["entry_time"].min()
    max_date = positions["entry_time"].max()
    date_range = (str(min_date.date()), str(max_date.date()))
    print(f"  IBKR date range: {date_range[0]} to {date_range[1]}")

    holly = load_holly_trades(db, date_range=date_range)
    matched = match_positions_to_holly(positions, holly, window)

    # Summary
    cats = matched["category"].value_counts()
    print(f"\n  Match results:")
    for cat, count in cats.items():
        print(f"    {cat}: {count}")

    good = matched[matched["category"].isin(["matched", "review"])]
    if not good.empty:
        confs = good["match_confidence"]
        print(f"\n  Matched+review confidence: min={confs.min():.3f} avg={confs.mean():.3f} max={confs.max():.3f}")
        print(f"  Unique strategies: {good['strategy'].nunique()}")
        print(f"  Unique symbols: {good['symbol'].nunique()}")

    # Pass 2: relaxed match for ibkr_only (same symbol+day, ignore direction)
    ibkr_only = matched[matched["category"] == "ibkr_only"]
    relaxed = pd.DataFrame()
    if not ibkr_only.empty:
        print(f"\n  Running relaxed match for {len(ibkr_only)} ibkr_only trades...")
        relaxed = relaxed_match_ibkr_only(ibkr_only, holly)
        if not relaxed.empty:
            print(f"  Relaxed matched: {len(relaxed)} (same symbol+day, closest Holly by time)")
        else:
            print(f"  Relaxed matched: 0")

    total_linkable = len(good) + len(relaxed)
    print(f"\n  Total linkable to Holly: {total_linkable}")

    print("\n" + "=" * 60)
    print("STEP 4: Backfill DuckDB trades table")
    print("=" * 60)

    updated, skipped = backfill_db(matched, relaxed, db, dry_run=args.dry_run)

    mode = "[DRY RUN] " if args.dry_run else ""
    print(f"\n  {mode}Updated: {updated} trades")
    print(f"  {mode}Skipped (already populated): {skipped}")

    # Verify
    result = db.execute("""
        SELECT
            COUNT(*) as total,
            COUNT(real_entry_price) as with_real_price,
            COUNT(real_entry_time) as with_real_time,
            COUNT(real_commission) as with_commission
        FROM trades
    """).fetchone()
    print(f"\n  DB state after backfill:")
    print(f"    Total trades:          {result[0]:,}")
    print(f"    With real_entry_price: {result[1]:,}")
    print(f"    With real_entry_time:  {result[2]:,}")
    print(f"    With real_commission:  {result[3]:,}")

    db.close()
    print("\nDone.")


if __name__ == "__main__":
    main()
