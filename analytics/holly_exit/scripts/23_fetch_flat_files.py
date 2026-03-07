"""
23_fetch_flat_files.py — Download Polygon flat files (minute + daily bars) via S3.

Flat files are delivered via S3-compatible API at files.polygon.io.
Each file contains ALL US stock tickers for one trading day, gzipped CSV.

Stocks Starter plan: 5 years of minute + daily aggs.

Data types downloaded:
  - minute_aggs_v1: ~15-50 MB/day compressed, ~25 GB total for 5 years
  - day_aggs_v1:    ~200 KB/day compressed, ~50 MB total for 5 years

Usage:
    python scripts/23_fetch_flat_files.py                      # Download all available
    python scripts/23_fetch_flat_files.py --type minute         # Minute bars only
    python scripts/23_fetch_flat_files.py --type daily          # Daily bars only
    python scripts/23_fetch_flat_files.py --year 2024           # Single year
    python scripts/23_fetch_flat_files.py --year 2024 --month 3 # Single month
    python scripts/23_fetch_flat_files.py --list                # List available files
    python scripts/23_fetch_flat_files.py --dry-run             # Show what would download
"""

import argparse
import gzip
import os
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from config.settings import DATA_DIR

# S3 config
S3_ENDPOINT = "https://files.massive.com"
S3_BUCKET = "flatfiles"

FLAT_DIR = DATA_DIR / "flat_files"

DATA_TYPES = {
    "minute": "us_stocks_sip/minute_aggs_v1",
    "daily": "us_stocks_sip/day_aggs_v1",
}


def get_s3_client():
    """Create S3 client with Polygon credentials."""
    try:
        import boto3
        from botocore.config import Config
    except ImportError:
        print("ERROR: boto3 not installed. Run: pip install boto3")
        sys.exit(1)

    access_key = os.getenv("POLYGON_S3_ACCESS_KEY", "")
    secret_key = os.getenv("POLYGON_S3_SECRET_KEY", "")

    if not access_key or not secret_key:
        # Try loading from .env
        for env_path in [
            Path(__file__).parent.parent.parent.parent / ".env",
            Path(__file__).parent.parent / ".env",
        ]:
            if env_path.exists():
                for line in env_path.read_text().splitlines():
                    line = line.strip()
                    if line.startswith("POLYGON_S3_ACCESS_KEY="):
                        access_key = line.split("=", 1)[1].strip().strip('"').strip("'")
                    elif line.startswith("POLYGON_S3_SECRET_KEY="):
                        secret_key = line.split("=", 1)[1].strip().strip('"').strip("'")

    if not access_key or not secret_key:
        print("ERROR: S3 credentials not found.")
        print("Add to your .env file:")
        print("  POLYGON_S3_ACCESS_KEY=your_access_key")
        print("  POLYGON_S3_SECRET_KEY=your_secret_key")
        print("\nGet these from: polygon.io → Dashboard → Flat Files")
        sys.exit(1)

    session = boto3.Session(
        aws_access_key_id=access_key,
        aws_secret_access_key=secret_key,
    )
    return session.client(
        "s3",
        endpoint_url=S3_ENDPOINT,
        config=Config(signature_version="s3v4"),
    )


def list_files(s3, prefix: str, year: int | None = None, month: int | None = None):
    """List available flat files for a given prefix."""
    if year and month:
        search_prefix = f"{prefix}/{year}/{month:02d}/"
    elif year:
        search_prefix = f"{prefix}/{year}/"
    else:
        search_prefix = f"{prefix}/"

    files = []
    paginator = s3.get_paginator("list_objects_v2")

    try:
        for page in paginator.paginate(Bucket=S3_BUCKET, Prefix=search_prefix):
            for obj in page.get("Contents", []):
                files.append({
                    "key": obj["Key"],
                    "size": obj["Size"],
                    "modified": obj["LastModified"],
                })
    except Exception as e:
        print(f"ERROR listing {search_prefix}: {e}")
        return []

    return sorted(files, key=lambda x: x["key"])


def download_file(s3, key: str, local_path: Path, expected_size: int) -> bool:
    """Download a single file from S3. Returns True if downloaded."""
    if local_path.exists():
        existing_size = local_path.stat().st_size
        if existing_size == expected_size:
            return False  # Already downloaded
        else:
            # Partial download, re-download
            local_path.unlink()

    local_path.parent.mkdir(parents=True, exist_ok=True)

    try:
        s3.download_file(S3_BUCKET, key, str(local_path))
        return True
    except Exception as e:
        print(f"  ERROR downloading {key}: {e}")
        if local_path.exists():
            local_path.unlink()
        return False


def download_data_type(
    s3,
    data_type: str,
    prefix: str,
    year: int | None,
    month: int | None,
    dry_run: bool,
):
    """Download all files for a data type."""
    print(f"\n{'=' * 60}")
    print(f"Downloading: {data_type} ({prefix})")
    if year:
        print(f"  Year filter: {year}" + (f", Month: {month}" if month else ""))
    print("=" * 60)

    # List available files
    files = list_files(s3, prefix, year, month)
    if not files:
        print("  No files found!")
        return

    total_size = sum(f["size"] for f in files)
    print(f"  Available: {len(files):,} files, {total_size / 1e9:.2f} GB compressed")

    if dry_run:
        # Show first/last files and size by year
        print(f"  First: {files[0]['key']}")
        print(f"  Last:  {files[-1]['key']}")
        years = {}
        for f in files:
            y = f["key"].split("/")[2]
            years.setdefault(y, {"count": 0, "size": 0})
            years[y]["count"] += 1
            years[y]["size"] += f["size"]
        print("  By year:")
        for y in sorted(years):
            print(f"    {y}: {years[y]['count']:>4} files, {years[y]['size'] / 1e6:>8.1f} MB")
        return

    # Group files by year, download newest first (hits plan boundary faster)
    by_year: dict[str, list] = {}
    for f in files:
        y = f["key"].split("/")[2]
        by_year.setdefault(y, []).append(f)

    out_dir = FLAT_DIR / data_type
    out_dir.mkdir(parents=True, exist_ok=True)

    downloaded = 0
    skipped = 0
    errors = 0
    bytes_downloaded = 0
    t0 = time.time()
    file_idx = 0
    total_files = len(files)

    for yr in sorted(by_year.keys(), reverse=True):
        yr_files = by_year[yr]
        yr_errors = 0
        yr_downloaded = 0
        print(f"\n  --- {yr}: {len(yr_files)} files, "
              f"{sum(f['size'] for f in yr_files) / 1e6:.1f} MB ---")

        for f in yr_files:
            parts = f["key"].split("/")
            year_dir = parts[2]
            month_dir = parts[3]
            filename = parts[4]
            local_path = out_dir / year_dir / month_dir / filename
            file_idx += 1

            success = download_file(s3, f["key"], local_path, f["size"])
            if success:
                downloaded += 1
                yr_downloaded += 1
                bytes_downloaded += f["size"]
            elif local_path.exists():
                skipped += 1
            else:
                errors += 1
                yr_errors += 1

            # Progress every 50 files or at boundaries
            if file_idx % 50 == 0 or file_idx == 1 or file_idx == total_files:
                elapsed = time.time() - t0
                rate_mb = bytes_downloaded / 1e6 / max(elapsed, 0.1)
                print(
                    f"  [{file_idx}/{total_files}] "
                    f"DL: {downloaded} Skip: {skipped} Err: {errors} "
                    f"({bytes_downloaded/1e6:.0f} MB, {rate_mb:.1f} MB/s)",
                    flush=True,
                )

            # Early abort: if first 10 files of a year ALL fail, skip year
            if yr_errors >= 10 and yr_downloaded == 0:
                remaining_in_yr = len(yr_files) - (yr_errors + skipped)
                if remaining_in_yr > 0:
                    errors += remaining_in_yr  # count as errors
                    file_idx += remaining_in_yr
                print(f"  {yr}: 403 Forbidden — outside plan window, skipping year")
                break

    elapsed = time.time() - t0
    print(f"\n  Complete: {downloaded:,} downloaded, {skipped:,} skipped, {errors} errors")
    print(f"  Downloaded: {bytes_downloaded / 1e9:.2f} GB in {elapsed / 60:.1f}m")

    # Verify
    local_files = list(out_dir.rglob("*.csv.gz"))
    local_size = sum(f.stat().st_size for f in local_files)
    print(f"  Local: {len(local_files):,} files, {local_size / 1e9:.2f} GB")


def load_to_duckdb(data_type: str):
    """Load flat files into DuckDB. Only for daily aggs (minute too large)."""
    if data_type != "daily":
        print(f"\n  Skipping DuckDB load for {data_type} (too large, query directly)")
        return

    import duckdb
    from config.settings import DUCKDB_PATH

    out_dir = FLAT_DIR / data_type
    gz_files = sorted(out_dir.rglob("*.csv.gz"))
    if not gz_files:
        print("  No files to load")
        return

    print(f"\n  Loading {len(gz_files):,} daily agg files into DuckDB...")
    con = duckdb.connect(str(DUCKDB_PATH))

    con.execute("DROP TABLE IF EXISTS daily_bars_flat")
    con.execute(f"""
        CREATE TABLE daily_bars_flat AS
        SELECT
            ticker,
            volume,
            open,
            close,
            high,
            low,
            -- Convert nanosecond unix timestamp to timestamp
            make_timestamp(CAST(window_start / 1000 AS BIGINT)) AS bar_time,
            transactions
        FROM read_csv(
            '{str(out_dir)}/**/*.csv.gz',
            columns={{
                'ticker': 'VARCHAR',
                'volume': 'BIGINT',
                'open': 'DOUBLE',
                'close': 'DOUBLE',
                'high': 'DOUBLE',
                'low': 'DOUBLE',
                'window_start': 'BIGINT',
                'transactions': 'BIGINT'
            }},
            compression='gzip'
        )
    """)
    cnt = con.execute("SELECT COUNT(*) FROM daily_bars_flat").fetchone()[0]
    tickers = con.execute("SELECT COUNT(DISTINCT ticker) FROM daily_bars_flat").fetchone()[0]
    date_range = con.execute(
        "SELECT MIN(CAST(bar_time AS DATE)), MAX(CAST(bar_time AS DATE)) FROM daily_bars_flat"
    ).fetchone()
    print(f"  Loaded: {cnt:,} rows, {tickers:,} tickers")
    print(f"  Range: {date_range[0]} to {date_range[1]}")
    con.close()


def main():
    parser = argparse.ArgumentParser(description="Download Polygon flat files via S3")
    parser.add_argument(
        "--type",
        choices=["minute", "daily", "both"],
        default="both",
        help="Data type to download (default: both)",
    )
    parser.add_argument("--year", type=int, help="Download only this year")
    parser.add_argument("--month", type=int, help="Download only this month (requires --year)")
    parser.add_argument("--list", action="store_true", help="List available files only")
    parser.add_argument("--dry-run", action="store_true", help="Show what would download")
    parser.add_argument(
        "--no-duckdb", action="store_true", help="Skip DuckDB loading step"
    )
    args = parser.parse_args()

    if args.month and not args.year:
        parser.error("--month requires --year")

    s3 = get_s3_client()

    if args.list:
        # Just list top-level structure
        print("Available flat file prefixes:")
        for dtype, prefix in DATA_TYPES.items():
            files = list_files(s3, prefix, args.year, args.month)
            total_size = sum(f["size"] for f in files)
            if files:
                first_date = files[0]["key"].split("/")[-1].replace(".csv.gz", "")
                last_date = files[-1]["key"].split("/")[-1].replace(".csv.gz", "")
                print(
                    f"  {dtype}: {len(files):,} files, "
                    f"{total_size / 1e9:.2f} GB, "
                    f"{first_date} to {last_date}"
                )
            else:
                print(f"  {dtype}: no files")
        return

    types_to_download = (
        list(DATA_TYPES.keys()) if args.type == "both" else [args.type]
    )

    # Download daily first (tiny), then minute
    for dtype in sorted(types_to_download, key=lambda x: 0 if x == "daily" else 1):
        prefix = DATA_TYPES[dtype]
        download_data_type(
            s3, dtype, prefix, args.year, args.month, args.dry_run
        )
        if not args.dry_run and not args.no_duckdb:
            load_to_duckdb(dtype)

    if not args.dry_run:
        # Final summary
        print(f"\n{'=' * 60}")
        print("Flat files download complete!")
        total_files = 0
        total_bytes = 0
        for dtype in types_to_download:
            d = FLAT_DIR / dtype
            if d.exists():
                files = list(d.rglob("*.csv.gz"))
                size = sum(f.stat().st_size for f in files)
                total_files += len(files)
                total_bytes += size
                print(f"  {dtype}: {len(files):,} files, {size / 1e9:.2f} GB")
        print(f"  Total: {total_files:,} files, {total_bytes / 1e9:.2f} GB")
        print("=" * 60)


if __name__ == "__main__":
    main()
