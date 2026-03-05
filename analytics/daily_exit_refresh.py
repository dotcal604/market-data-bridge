"""
daily_exit_refresh.py — Automated daily refresh of Holly Exit Optimizer data.

Orchestrates the full pipeline:
  1. Fetch bars for today's traded symbols from Polygon
  2. Load new bars into DuckDB
  3. Run optimization sweep
  4. Run walk-forward validation
  5. Update optimal_exit_params.json + walk_forward_summary.json

Designed to be called by the scheduler at 4:30 PM ET (post-close).

Usage:
    python analytics/daily_exit_refresh.py
    python analytics/daily_exit_refresh.py --skip-fetch    # Skip bar fetching
    python analytics/daily_exit_refresh.py --skip-walkfwd  # Skip walk-forward
"""

import argparse
import json
import os
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path

# This script lives in analytics/, holly_exit is a subdirectory
HOLLY_DIR = Path(__file__).parent / "holly_exit"
SCRIPTS_DIR = HOLLY_DIR / "scripts"
OUTPUT_DIR = HOLLY_DIR / "output"

# Ensure output directory exists
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)


def run_step(name: str, cmd: list[str], cwd: str, timeout_min: int = 10) -> bool:
    """Run a pipeline step, return True on success."""
    print(f"\n{'='*60}")
    print(f"  Step: {name}")
    print(f"  Command: {' '.join(cmd)}")
    print(f"{'='*60}")

    t0 = time.time()
    try:
        result = subprocess.run(
            cmd,
            cwd=cwd,
            timeout=timeout_min * 60,
            capture_output=False,  # Let output stream to parent
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
    parser = argparse.ArgumentParser(description="Holly Exit Optimizer — Daily Refresh")
    parser.add_argument("--skip-fetch", action="store_true",
                        help="Skip Polygon bar fetching (use existing cached bars)")
    parser.add_argument("--skip-walkfwd", action="store_true",
                        help="Skip walk-forward validation")
    args = parser.parse_args()

    start_time = time.time()
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    print(f"\n{'#'*60}")
    print(f"  Holly Exit Optimizer — Daily Refresh")
    print(f"  Started: {timestamp}")
    print(f"{'#'*60}")

    results = {}
    holly_cwd = str(HOLLY_DIR)
    python = sys.executable  # Use same Python that's running this script

    # Step 1: Fetch bars from Polygon
    if not args.skip_fetch:
        ok = run_step(
            "Fetch Bars (Polygon)",
            [python, str(SCRIPTS_DIR / "03_fetch_bars.py")],
            cwd=holly_cwd,
            timeout_min=15,
        )
        results["fetch_bars"] = ok
        if not ok:
            print("\n  WARNING: Bar fetch failed. Continuing with existing data.\n")
    else:
        print("\n  Skipping bar fetch (--skip-fetch)")
        results["fetch_bars"] = "skipped"

    # Step 2: Load bars into DuckDB
    ok = run_step(
        "Load Bars to DuckDB",
        [python, str(SCRIPTS_DIR / "04_load_bars_to_ddb.py")],
        cwd=holly_cwd,
        timeout_min=5,
    )
    results["load_bars"] = ok
    if not ok:
        print("\n  FATAL: Bar loading failed. Cannot proceed.\n")
        dump_results(results, start_time)
        return

    # Step 3: Run optimization sweep
    ok = run_step(
        "Run Optimization",
        [python, str(SCRIPTS_DIR / "05_run_optimization.py")],
        cwd=holly_cwd,
        timeout_min=10,
    )
    results["optimization"] = ok
    if not ok:
        print("\n  FATAL: Optimization failed. Cannot proceed.\n")
        dump_results(results, start_time)
        return

    # Step 4: Generate optimal exit params JSON
    ok = run_step(
        "Generate Optimal Params",
        [python, str(SCRIPTS_DIR / "09_suggest_exits.py")],
        cwd=holly_cwd,
        timeout_min=5,
    )
    results["suggest_exits"] = ok

    # Step 5: Walk-forward validation
    if not args.skip_walkfwd:
        ok = run_step(
            "Walk-Forward Validation",
            [python, str(SCRIPTS_DIR / "11_walk_forward.py"), "--rolling", "--n-folds", "5"],
            cwd=holly_cwd,
            timeout_min=10,
        )
        results["walk_forward"] = ok
    else:
        print("\n  Skipping walk-forward validation (--skip-walkfwd)")
        results["walk_forward"] = "skipped"

    dump_results(results, start_time)


def dump_results(results: dict, start_time: float):
    """Write results summary."""
    elapsed = time.time() - start_time
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    print(f"\n{'#'*60}")
    print(f"  Daily Refresh Complete")
    print(f"  Finished: {timestamp}")
    print(f"  Total Time: {elapsed:.1f}s")
    print(f"{'#'*60}")
    for step, status in results.items():
        marker = "OK" if status is True else ("SKIP" if status == "skipped" else "FAIL")
        print(f"  [{marker}] {step}")

    # Save run log
    log_path = OUTPUT_DIR / "daily_refresh_log.json"
    log_entry = {
        "timestamp": timestamp,
        "duration_seconds": round(elapsed, 1),
        "results": {k: str(v) for k, v in results.items()},
        "success": all(v is True or v == "skipped" for v in results.values()),
    }

    # Append to log file (keep last 30 entries)
    log_data = []
    if log_path.exists():
        try:
            log_data = json.loads(log_path.read_text())
        except Exception:
            log_data = []
    log_data.append(log_entry)
    log_data = log_data[-30:]  # Keep last 30 runs
    log_path.write_text(json.dumps(log_data, indent=2))

    print(f"\n  Log saved to {log_path}")


if __name__ == "__main__":
    main()
