"""
10_holly_batch_assembler.py -- Assemble multiple Holly History CSV exports
into a single deduplicated dataset.

Trade Ideas limits Holly History exports to N days at a time. This script:
  1. Reads all CSVs from data/raw/holly_batches/
  2. Parses the funky Holly datetime + number formats
  3. Deduplicates by (Entry Time, Symbol, Strategy)
  4. Merges with existing holly_trades.csv (if present)
  5. Writes the combined dataset back
  6. Loads into DuckDB

Workflow:
  1. Export Holly History batches from Trade Ideas desktop:
     - Right-click AI Strategy Trades > All History > pick date range
     - Save Contents as CSV
  2. Drop all CSVs into: analytics/holly_exit/data/raw/holly_batches/
  3. Run: python scripts/10_holly_batch_assembler.py
  4. Repeat whenever you export new batches

Usage:
    python scripts/10_holly_batch_assembler.py                # merge + load
    python scripts/10_holly_batch_assembler.py --dry-run      # preview only
    python scripts/10_holly_batch_assembler.py --fresh         # ignore existing, rebuild from batches only
"""

import argparse
import sys
from pathlib import Path
from datetime import datetime

import pandas as pd

sys.path.insert(0, str(Path(__file__).parent.parent))

from config.settings import DATA_DIR, DUCKDB_PATH

BATCH_DIR = DATA_DIR / "raw" / "holly_batches"
MASTER_CSV = DATA_DIR / "raw" / "holly_trades.csv"

# Old 31-column layout (with header)
HOLLY_31_COLUMNS = [
    "Entry Time", "Exit Time", "Symbol", "Shares", "Entry Price",
    "Last Price", "Change from Entry $", "Change from the Close $",
    "Change from the Close %", "Strategy", "Exit Price", "Closed Profit",
    "Profit Change Last 15", "Profit Change Last 5", "Max Profit",
    "Profit Basis Points", "Open Profit", "Stop Price", "Time Stop",
    "Max Profit Time of Day", "Distance from Max Profit", "Min Profit",
    "Min Profit Time of Day", "Distance from Stop Price", "Smart Stop",
    "% to Stop Price", "Time Until", "Segment", "Change from Entry %",
    "Long Term Profit $", "Long Term Profit %",
]

# New 41-column layout (no header, 10 ghost columns at [2,10,12,13,21,24,28,34,35,36])
HOLLY_41_COLUMNS = [
    "Entry Time", "Exit Time", "_ghost_1", "Symbol", "Shares", "Entry Price",
    "Last Price", "Change from Entry $", "Change from the Close $",
    "Change from the Close %", "_ghost_2", "Strategy", "_ghost_3", "_ghost_4",
    "Exit Price", "Closed Profit", "Profit Change Last 15", "Profit Change Last 5",
    "Max Profit", "Profit Basis Points", "Open Profit", "_ghost_5",
    "Stop Price", "Time Stop", "_ghost_6", "Max Profit Time of Day",
    "Distance from Max Profit", "Min Profit", "_ghost_7", "Min Profit Time of Day",
    "Distance from Stop Price", "Smart Stop", "% to Stop Price", "Time Until",
    "_ghost_8", "_ghost_9", "_ghost_10", "Segment", "Change from Entry %",
    "Long Term Profit $", "Long Term Profit %",
]

# Columns to keep in the output (drop ghosts)
HOLLY_DATA_COLUMNS = [c for c in HOLLY_41_COLUMNS if not c.startswith("_ghost")]

# Dedup key: these columns together uniquely identify a trade
DEDUP_KEYS = ["Entry Time", "Symbol", "Strategy"]


def fix_holly_number(val):
    """Fix Holly's space-separated thousands: '5 212.35' -> 5212.35, '1 040.00' -> 1040.0"""
    if pd.isna(val):
        return val
    s = str(val).strip()
    if s == "" or s.lower() == "nan":
        return None

    # Check for space-separated thousands (e.g., "5 212.35", "-1 367.52")
    # Pattern: optional minus, digits, space, digits (with optional decimal)
    parts = s.split()
    if len(parts) >= 2:
        try:
            # Try joining without spaces and parsing as float
            joined = "".join(parts)
            return float(joined)
        except ValueError:
            pass

    try:
        return float(s.replace(",", ""))
    except ValueError:
        return None


def parse_holly_datetime(val):
    """Parse Holly's datetime format (old or new).

    Old: '2020 Mar 31 10:54:02'
    New: '31-Mar-2020 10:54:02'
    """
    if pd.isna(val):
        return None
    s = str(val).strip()
    if s == "" or s.lower() == "nan":
        return None

    for fmt in [
        "%d-%b-%Y %H:%M:%S",   # new format
        "%Y %b %d %H:%M:%S",   # old format
        "%d-%b-%Y %H:%M",
        "%Y %b %d %H:%M",
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%d %H:%M",
    ]:
        try:
            return datetime.strptime(s, fmt)
        except ValueError:
            continue
    return None


def read_holly_csv(path: Path) -> pd.DataFrame:
    """Read a single Holly History CSV export with format handling.

    Auto-detects old 31-col (with header) vs new 41-col (headerless) format.
    Always returns a DataFrame with the standard 31 data column names.
    """
    print(f"  Reading: {path.name} ...", end=" ", flush=True)

    df = pd.read_csv(path, dtype=str, keep_default_na=False)
    n_cols = len(df.columns)

    # Detect format: check if first column header is "Entry Time" (old format)
    first_col = df.columns[0].strip()
    has_header = first_col == "Entry Time"

    if n_cols == 41 and not has_header:
        # New 41-column headerless format
        df.columns = HOLLY_41_COLUMNS
        # Drop ghost columns
        df = df[[c for c in df.columns if not c.startswith("_ghost")]]
    elif has_header:
        # Old format with header
        df.columns = [c.strip() for c in df.columns]
    elif n_cols == 31:
        # Old format, no header
        df.columns = HOLLY_31_COLUMNS
    else:
        # Best-effort: try 41-col mapping if >= 41, else 31-col
        if n_cols >= 41:
            df = df.iloc[:, :41]
            df.columns = HOLLY_41_COLUMNS
            df = df[[c for c in df.columns if not c.startswith("_ghost")]]
        else:
            cols = HOLLY_31_COLUMNS[:min(n_cols, len(HOLLY_31_COLUMNS))]
            df.columns = list(cols) + [f"Extra_{i}" for i in range(n_cols - len(cols))]

    # Parse datetime columns
    for col in ["Entry Time", "Exit Time", "Time Stop",
                "Max Profit Time of Day", "Min Profit Time of Day"]:
        if col in df.columns:
            df[col] = df[col].apply(parse_holly_datetime)

    # Parse numeric columns (fix space/comma-separated thousands)
    numeric_cols = [
        "Shares", "Entry Price", "Last Price", "Change from Entry $",
        "Change from the Close $", "Exit Price", "Closed Profit",
        "Profit Change Last 15", "Profit Change Last 5", "Max Profit",
        "Profit Basis Points", "Open Profit", "Stop Price",
        "Distance from Max Profit", "Min Profit", "Distance from Stop Price",
        "Smart Stop", "% to Stop Price", "Long Term Profit $",
    ]
    for col in numeric_cols:
        if col in df.columns:
            df[col] = df[col].apply(fix_holly_number)

    # Drop rows with no Entry Time (header repeats, empty rows)
    df = df.dropna(subset=["Entry Time"])

    print(f"{len(df):,} trades ({df['Entry Time'].min()} to {df['Entry Time'].max()})")
    return df


def main():
    parser = argparse.ArgumentParser(description="Holly Batch Assembler")
    parser.add_argument("--dry-run", action="store_true", help="Preview without writing")
    parser.add_argument("--fresh", action="store_true", help="Ignore existing master, rebuild from batches only")
    args = parser.parse_args()

    print("=" * 70)
    print("  Holly Batch Assembler")
    print("=" * 70)

    # Ensure batch directory exists
    BATCH_DIR.mkdir(parents=True, exist_ok=True)

    # Find all CSV files in batch directory
    batch_files = sorted(BATCH_DIR.glob("*.csv"))

    if not batch_files and not MASTER_CSV.exists():
        print(f"\nNo CSV files found in: {BATCH_DIR}")
        print(f"Drop your Holly History CSV exports there and re-run.")
        return

    # Read all batch files
    dfs = []

    if not args.fresh and MASTER_CSV.exists():
        print(f"\n[Existing master file]")
        master_df = read_holly_csv(MASTER_CSV)
        dfs.append(master_df)
        print(f"  Master: {len(master_df):,} trades")

    if batch_files:
        print(f"\n[New batch files: {len(batch_files)}]")
        for f in batch_files:
            try:
                batch_df = read_holly_csv(f)
                if len(batch_df) > 0:
                    dfs.append(batch_df)
            except Exception as e:
                print(f"  ERROR reading {f.name}: {e}")
    else:
        print(f"\nNo new batch files in: {BATCH_DIR}")

    if not dfs:
        print("No data to process.")
        return

    # Combine all dataframes
    print(f"\n[Combining]")
    combined = pd.concat(dfs, ignore_index=True)
    print(f"  Total before dedup: {len(combined):,}")

    # Deduplicate by (Entry Time, Symbol, Strategy)
    # Keep the LAST occurrence (newest export has most up-to-date data)
    before = len(combined)
    combined = combined.drop_duplicates(subset=DEDUP_KEYS, keep="last")
    dupes = before - len(combined)
    print(f"  Duplicates removed:  {dupes:,}")
    print(f"  Total after dedup:   {len(combined):,}")

    # Sort by Entry Time
    combined = combined.sort_values("Entry Time").reset_index(drop=True)

    # Add derived columns
    if "Entry Time" in combined.columns:
        combined["Year"] = combined["Entry Time"].apply(
            lambda x: x.year if pd.notna(x) else None
        )
        combined["Quarter"] = combined["Entry Time"].apply(
            lambda x: f"Q{(x.month - 1) // 3 + 1}" if pd.notna(x) else None
        )

    # Report
    print(f"\n[Summary]")
    print(f"  Date range: {combined['Entry Time'].min()} to {combined['Entry Time'].max()}")
    print(f"  Symbols:    {combined['Symbol'].nunique():,}")
    print(f"  Strategies: {combined['Strategy'].nunique()}")
    print(f"  Total:      {len(combined):,} trades")

    # Year breakdown
    if "Year" in combined.columns:
        print(f"\n  By year:")
        for year, count in combined.groupby("Year").size().items():
            print(f"    {year}: {count:,} trades")

    # New trades (not in master)
    if not args.fresh and MASTER_CSV.exists():
        new_count = len(combined) - len(master_df) + dupes
        print(f"\n  NEW trades added: {new_count:,}")

    if args.dry_run:
        print(f"\n  [DRY RUN] No files written.")
        return

    # Write master CSV
    print(f"\n[Writing]")

    # Backup existing master
    if MASTER_CSV.exists():
        backup = MASTER_CSV.with_suffix(".csv.bak")
        MASTER_CSV.rename(backup)
        print(f"  Backed up existing to: {backup.name}")

    combined.to_csv(MASTER_CSV, index=False)
    size_mb = MASTER_CSV.stat().st_size / (1024 * 1024)
    print(f"  Written: {MASTER_CSV.name} ({size_mb:.1f} MB, {len(combined):,} trades)")

    # Move processed batch files to archive
    archive_dir = BATCH_DIR / "processed"
    archive_dir.mkdir(exist_ok=True)
    for f in batch_files:
        dest = archive_dir / f"{datetime.now().strftime('%Y%m%d')}_{f.name}"
        f.rename(dest)
    if batch_files:
        print(f"  Archived {len(batch_files)} batch files to: holly_batches/processed/")

    # Reload into DuckDB
    print(f"\n[Loading into DuckDB]")
    try:
        from engine.data_loader import get_db
        db = get_db()

        # Reload trades table
        db.execute("DELETE FROM trades")
        # Re-run ingestion script logic
        print(f"  Run 'python scripts/01_ingest_trades.py' to reload DuckDB.")
        print(f"  (Assembler handles CSV merging; ingestion handles DuckDB loading)")
    except Exception as e:
        print(f"  DuckDB reload skipped: {e}")
        print(f"  Run 'python scripts/01_ingest_trades.py' manually after.")

    print(f"\n{'=' * 70}")
    print(f"  DONE. {len(combined):,} trades in {MASTER_CSV.name}")
    print(f"{'=' * 70}")


if __name__ == "__main__":
    main()
