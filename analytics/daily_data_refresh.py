"""
daily_data_refresh.py — Post-close data refresh to maximize Polygon Starter subscription.

Orchestrates incremental pulls for all Polygon data sources:
  1. Daily flat files (S3) — all US stocks daily OHLCV
  2. Minute flat files (S3) — all US stocks 1-min bars
  3. Grouped daily (REST) — market-wide breadth stats
  4. ETF benchmark bars (REST) — SPY/QQQ/IWM + 11 sector ETFs
  5. News articles (REST) — recent news for Holly-traded symbols
  6. Reference data (REST) — splits, dividends, ticker universe
  7. FRED macro (CSV) — VIX, Fed Funds, Treasury yields
  8. Silver layer rebuild — canonical DuckDB + Parquet from all Bronze

All steps are incremental (only new data fetched). Each step is independent
and can fail without blocking subsequent steps (except Silver which needs data).

Designed to run at 4:45 PM ET via scheduler (after daily_exit_refresh at 4:30).

Usage:
    python analytics/daily_data_refresh.py
    python analytics/daily_data_refresh.py --only flat,benchmarks,silver
    python analytics/daily_data_refresh.py --skip silver
    python analytics/daily_data_refresh.py --dry-run
"""

import argparse
import json
import os
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path

ANALYTICS_DIR = Path(__file__).parent
HOLLY_DIR = ANALYTICS_DIR / "holly_exit"
SCRIPTS_DIR = HOLLY_DIR / "scripts"
OUTPUT_DIR = HOLLY_DIR / "output"

OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

# Step definitions: (key, name, command_args, cwd, timeout_min)
# command_args are relative to cwd; python executable is prepended automatically.
STEPS = [
    {
        "key": "flat_daily",
        "name": "Flat Files — Daily (S3)",
        "script": SCRIPTS_DIR / "23_fetch_flat_files.py",
        "args": ["--type", "daily"],
        "cwd": HOLLY_DIR,
        "timeout_min": 10,
        "critical": False,
    },
    {
        "key": "flat_minute",
        "name": "Flat Files — Minute (S3)",
        "script": SCRIPTS_DIR / "23_fetch_flat_files.py",
        "args": ["--type", "minute", "--no-duckdb"],
        "cwd": HOLLY_DIR,
        "timeout_min": 30,
        "critical": False,
    },
    {
        "key": "benchmarks",
        "name": "ETF Benchmarks + Grouped Daily (REST)",
        "script": SCRIPTS_DIR / "15_fetch_benchmarks.py",
        "args": [],
        "cwd": HOLLY_DIR,
        "timeout_min": 20,
        "critical": False,
    },
    {
        "key": "load_benchmarks",
        "name": "Load Benchmarks to DuckDB",
        "script": SCRIPTS_DIR / "16_load_benchmarks_to_ddb.py",
        "args": [],
        "cwd": HOLLY_DIR,
        "timeout_min": 10,
        "critical": False,
    },
    {
        "key": "news",
        "name": "News Articles (REST)",
        "script": SCRIPTS_DIR / "21_fetch_news.py",
        "args": [],
        "cwd": HOLLY_DIR,
        "timeout_min": 15,
        "critical": False,
    },
    {
        "key": "reference",
        "name": "Reference Data — Splits, Dividends, Tickers (REST)",
        "script": SCRIPTS_DIR / "17_fetch_reference_data.py",
        "args": [],
        "cwd": HOLLY_DIR,
        "timeout_min": 15,
        "critical": False,
    },
    {
        "key": "fred",
        "name": "FRED Macro — VIX, Rates, Yields (CSV)",
        "script": SCRIPTS_DIR / "24_fetch_fred_macro.py",
        "args": [],
        "cwd": HOLLY_DIR,
        "timeout_min": 5,
        "critical": False,
    },
    {
        "key": "snapshots",
        "name": "Market Snapshots (REST)",
        "script": SCRIPTS_DIR / "31_fetch_snapshots.py",
        "args": [],
        "cwd": HOLLY_DIR,
        "timeout_min": 5,
        "critical": False,
    },
    {
        "key": "indicators",
        "name": "Technical Indicators — SMA/EMA/RSI/MACD (REST)",
        "script": SCRIPTS_DIR / "32_fetch_indicators.py",
        "args": ["--force"],
        "cwd": HOLLY_DIR,
        "timeout_min": 15,
        "critical": False,
    },
    {
        "key": "silver",
        "name": "Silver Layer Rebuild",
        "script": ANALYTICS_DIR / "build_silver.py",
        "args": [],
        "cwd": ANALYTICS_DIR,
        "timeout_min": 10,
        "critical": False,
    },
]


def run_step(name: str, cmd: list[str], cwd: str, timeout_min: int = 10, dry_run: bool = False) -> bool:
    """Run a pipeline step, return True on success."""
    print(f"\n{'='*60}")
    print(f"  Step: {name}")
    print(f"  Command: {' '.join(cmd)}")
    if dry_run:
        print(f"  [DRY RUN] Skipped")
        print(f"{'='*60}")
        return True
    print(f"{'='*60}")

    t0 = time.time()
    try:
        result = subprocess.run(
            cmd,
            cwd=cwd,
            timeout=timeout_min * 60,
            capture_output=False,
        )
        elapsed = time.time() - t0
        if result.returncode == 0:
            print(f"  [OK] {name} completed in {elapsed:.1f}s")
            return True
        else:
            print(f"  [FAIL] {name} failed with exit code {result.returncode} ({elapsed:.1f}s)")
            return False
    except subprocess.TimeoutExpired:
        elapsed = time.time() - t0
        print(f"  [TIMEOUT] {name} timed out after {elapsed:.1f}s")
        return False
    except Exception as e:
        print(f"  [ERROR] {name}: {e}")
        return False


def main():
    parser = argparse.ArgumentParser(description="Daily Data Refresh — Maximize Polygon Subscription")
    parser.add_argument("--only", type=str, default=None,
                        help="Comma-separated step keys to run (e.g. flat_daily,silver)")
    parser.add_argument("--skip", type=str, default=None,
                        help="Comma-separated step keys to skip (e.g. silver,news)")
    parser.add_argument("--dry-run", action="store_true",
                        help="Show what would run without executing")
    args = parser.parse_args()

    only_keys = set(args.only.split(",")) if args.only else None
    skip_keys = set(args.skip.split(",")) if args.skip else set()

    start_time = time.time()
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    python = sys.executable

    print(f"\n{'#'*60}")
    print(f"  Daily Data Refresh — Polygon Starter Subscription")
    print(f"  Started: {timestamp}")
    if args.dry_run:
        print(f"  MODE: DRY RUN")
    if only_keys:
        print(f"  Only: {', '.join(only_keys)}")
    if skip_keys:
        print(f"  Skip: {', '.join(skip_keys)}")
    print(f"{'#'*60}")

    results = {}

    for step in STEPS:
        key = step["key"]

        # Filter logic
        if only_keys and key not in only_keys:
            continue
        if key in skip_keys:
            print(f"\n  Skipping {step['name']} (--skip {key})")
            results[key] = "skipped"
            continue

        cmd = [python, str(step["script"])] + step["args"]
        ok = run_step(
            step["name"],
            cmd,
            cwd=str(step["cwd"]),
            timeout_min=step["timeout_min"],
            dry_run=args.dry_run,
        )
        results[key] = ok

        if not ok and step.get("critical"):
            print(f"\n  FATAL: Critical step '{key}' failed. Aborting.\n")
            break

    # Summary
    elapsed = time.time() - start_time
    finished = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    print(f"\n{'#'*60}")
    print(f"  Daily Data Refresh Complete")
    print(f"  Finished: {finished}")
    print(f"  Total Time: {elapsed:.1f}s ({elapsed/60:.1f}m)")
    print(f"{'#'*60}")

    ok_count = sum(1 for v in results.values() if v is True)
    fail_count = sum(1 for v in results.values() if v is False)
    skip_count = sum(1 for v in results.values() if v == "skipped")

    for step_key, status in results.items():
        marker = "OK" if status is True else ("SKIP" if status == "skipped" else "FAIL")
        print(f"  [{marker}] {step_key}")

    print(f"\n  Summary: {ok_count} ok, {fail_count} failed, {skip_count} skipped")

    # Save run log
    log_path = OUTPUT_DIR / "daily_data_refresh_log.json"
    log_entry = {
        "timestamp": finished,
        "duration_seconds": round(elapsed, 1),
        "results": {k: str(v) for k, v in results.items()},
        "success": all(v is True or v == "skipped" for v in results.values()),
    }

    log_data = []
    if log_path.exists():
        try:
            log_data = json.loads(log_path.read_text())
        except Exception:
            log_data = []
    log_data.append(log_entry)
    log_data = log_data[-30:]
    log_path.write_text(json.dumps(log_data, indent=2))
    print(f"  Log saved to {log_path}")


if __name__ == "__main__":
    main()
