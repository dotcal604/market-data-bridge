"""Bulk fetch earnings dates + analyst upgrades/downgrades from yfinance.

Fetches for all Holly symbols, saves to parquet, supports resume.
Rate-limited to avoid yfinance throttling.

Usage:
    python -m holly_tearsheets.fetch_catalysts
    python -m holly_tearsheets.fetch_catalysts --top 500
    python -m holly_tearsheets.fetch_catalysts --resume
"""

import argparse
import json
import time
import warnings
from pathlib import Path

import pandas as pd
import yfinance as yf

from .config import PACKAGE_ROOT, HOLLY_CSV

warnings.filterwarnings("ignore")

CATALYST_DIR = PACKAGE_ROOT / "output" / "catalysts"
EARNINGS_FILE = CATALYST_DIR / "earnings_dates.parquet"
ANALYST_FILE = CATALYST_DIR / "analyst_actions.parquet"
PROGRESS_FILE = CATALYST_DIR / "fetch_progress.json"

# yfinance rate limiting — stay under the radar
BATCH_SIZE = 5
SLEEP_BETWEEN_BATCHES = 2.0  # seconds
SLEEP_BETWEEN_SYMBOLS = 0.3


def get_holly_symbols(top_n: int = None) -> list[str]:
    """Get Holly symbols sorted by trade count (most traded first)."""
    df = pd.read_csv(HOLLY_CSV, usecols=["symbol"])
    counts = df["symbol"].value_counts()
    symbols = counts.index.tolist()
    if top_n:
        symbols = symbols[:top_n]
    return symbols


def load_progress() -> dict:
    """Load fetch progress for resume support."""
    if PROGRESS_FILE.exists():
        return json.loads(PROGRESS_FILE.read_text())
    return {"completed": [], "failed": [], "no_data": []}


def save_progress(progress: dict):
    """Save fetch progress."""
    PROGRESS_FILE.write_text(json.dumps(progress, indent=2))


def fetch_earnings(symbol: str) -> pd.DataFrame | None:
    """Fetch earnings dates for a symbol."""
    try:
        ticker = yf.Ticker(symbol)
        ed = ticker.earnings_dates
        if ed is None or ed.empty:
            return None
        ed = ed.reset_index()
        ed.columns = ["earnings_date", "eps_estimate", "reported_eps", "surprise_pct"]
        ed["symbol"] = symbol
        ed["earnings_date"] = pd.to_datetime(ed["earnings_date"], utc=True).dt.tz_localize(None)
        return ed
    except Exception:
        return None


def fetch_analyst_actions(symbol: str) -> pd.DataFrame | None:
    """Fetch analyst upgrades/downgrades for a symbol."""
    try:
        ticker = yf.Ticker(symbol)
        ud = ticker.upgrades_downgrades
        if ud is None or ud.empty:
            return None
        ud = ud.reset_index()
        ud.columns = ["action_date", "firm", "to_grade", "from_grade",
                       "action", "price_target_action", "current_pt", "prior_pt"]
        ud["symbol"] = symbol
        ud["action_date"] = pd.to_datetime(ud["action_date"], utc=True).dt.tz_localize(None)
        return ud
    except Exception:
        return None


def run_fetch(top_n: int = None, resume: bool = True):
    """Main fetch loop with progress tracking."""
    CATALYST_DIR.mkdir(parents=True, exist_ok=True)

    symbols = get_holly_symbols(top_n=top_n)
    print(f"Fetching catalyst data for {len(symbols)} symbols...")

    # Resume support
    progress = load_progress() if resume else {"completed": [], "failed": [], "no_data": []}
    done = set(progress["completed"] + progress["failed"] + progress["no_data"])
    remaining = [s for s in symbols if s not in done]
    print(f"  Already processed: {len(done)}, remaining: {len(remaining)}")

    # Load existing data for appending
    all_earnings = []
    all_analyst = []
    if resume and EARNINGS_FILE.exists():
        all_earnings.append(pd.read_parquet(EARNINGS_FILE))
    if resume and ANALYST_FILE.exists():
        all_analyst.append(pd.read_parquet(ANALYST_FILE))

    # Fetch in batches
    batch_count = 0
    for i, symbol in enumerate(remaining):
        earnings = fetch_earnings(symbol)
        analyst = fetch_analyst_actions(symbol)

        got_data = False
        if earnings is not None and not earnings.empty:
            all_earnings.append(earnings)
            got_data = True
        if analyst is not None and not analyst.empty:
            all_analyst.append(analyst)
            got_data = True

        if got_data:
            progress["completed"].append(symbol)
        else:
            progress["no_data"].append(symbol)

        # Progress reporting
        total_done = len(progress["completed"]) + len(progress["failed"]) + len(progress["no_data"])
        if (i + 1) % 25 == 0:
            e_count = sum(len(e) for e in all_earnings)
            a_count = sum(len(a) for a in all_analyst)
            print(f"  [{total_done}/{len(symbols)}] {symbol} — "
                  f"{e_count:,} earnings rows, {a_count:,} analyst rows")

        # Rate limiting
        time.sleep(SLEEP_BETWEEN_SYMBOLS)
        batch_count += 1
        if batch_count >= BATCH_SIZE:
            batch_count = 0
            time.sleep(SLEEP_BETWEEN_BATCHES)

            # Save checkpoint every batch
            save_progress(progress)
            if all_earnings:
                pd.concat(all_earnings, ignore_index=True).to_parquet(EARNINGS_FILE)
            if all_analyst:
                pd.concat(all_analyst, ignore_index=True).to_parquet(ANALYST_FILE)

    # Final save
    save_progress(progress)

    if all_earnings:
        earnings_df = pd.concat(all_earnings, ignore_index=True).drop_duplicates(
            subset=["symbol", "earnings_date"]
        )
        earnings_df.to_parquet(EARNINGS_FILE)
        print(f"\nEarnings: {len(earnings_df):,} rows, "
              f"{earnings_df['symbol'].nunique()} symbols -> {EARNINGS_FILE}")
    else:
        print("\nNo earnings data fetched.")

    if all_analyst:
        analyst_df = pd.concat(all_analyst, ignore_index=True).drop_duplicates(
            subset=["symbol", "action_date", "firm"]
        )
        analyst_df.to_parquet(ANALYST_FILE)
        print(f"Analyst: {len(analyst_df):,} rows, "
              f"{analyst_df['symbol'].nunique()} symbols -> {ANALYST_FILE}")
    else:
        print("No analyst data fetched.")

    print(f"\nDone. {len(progress['completed'])} with data, "
          f"{len(progress['no_data'])} no data, {len(progress['failed'])} failed.")


def main():
    parser = argparse.ArgumentParser(description="Fetch catalyst data from yfinance")
    parser.add_argument("--top", type=int, default=None,
                        help="Only fetch top N symbols by trade count")
    parser.add_argument("--no-resume", action="store_true",
                        help="Start fresh (ignore previous progress)")
    args = parser.parse_args()
    run_fetch(top_n=args.top, resume=not args.no_resume)


if __name__ == "__main__":
    main()
