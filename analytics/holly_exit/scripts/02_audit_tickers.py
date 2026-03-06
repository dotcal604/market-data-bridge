"""
02_audit_tickers.py — Check which Holly tickers exist in Polygon.

Usage:
    python scripts/02_audit_tickers.py
"""

import json
import sys
import time
from pathlib import Path

import requests

sys.path.insert(0, str(Path(__file__).parent.parent))

from config.settings import POLYGON_API_KEY, DATA_DIR
from engine.data_loader import get_db

AUDIT_FILE = DATA_DIR / "ticker_audit.json"
POLYGON_BASE = "https://api.polygon.io"


def main():
    if not POLYGON_API_KEY:
        print("ERROR: POLYGON_API_KEY not set in .env")
        sys.exit(1)

    db = get_db()

    # Get unique symbols
    symbols = db.execute(
        "SELECT DISTINCT symbol FROM trades ORDER BY symbol"
    ).fetchdf()["symbol"].tolist()

    print(f"Auditing {len(symbols)} unique tickers against Polygon...")

    available = []
    delisted_with_data = []
    missing = []

    for i, sym in enumerate(symbols):
        if (i + 1) % 50 == 0 or i == 0:
            print(f"  [{i + 1}/{len(symbols)}] Checking {sym}...")

        try:
            # Check ticker details
            resp = requests.get(
                f"{POLYGON_BASE}/v3/reference/tickers/{sym}",
                params={"apiKey": POLYGON_API_KEY},
                timeout=10,
            )

            if resp.status_code == 200:
                data = resp.json().get("results", {})
                active = data.get("active", False)

                if active:
                    available.append(sym)
                else:
                    # Delisted — check if historical bars exist
                    bar_resp = requests.get(
                        f"{POLYGON_BASE}/v2/aggs/ticker/{sym}/range/1/minute/2024-01-02/2024-01-02",
                        params={"apiKey": POLYGON_API_KEY, "limit": 1},
                        timeout=10,
                    )
                    if bar_resp.status_code == 200 and bar_resp.json().get("resultsCount", 0) > 0:
                        delisted_with_data.append(sym)
                    else:
                        missing.append(sym)

            elif resp.status_code == 404:
                missing.append(sym)
            else:
                print(f"  [WARN] {sym}: HTTP {resp.status_code}")
                missing.append(sym)

        except Exception as e:
            print(f"  [ERROR] {sym}: {e}")
            missing.append(sym)

        time.sleep(0.2)  # Be polite to the API

    # Save audit
    audit = {
        "available": sorted(available),
        "delisted_with_data": sorted(delisted_with_data),
        "missing": sorted(missing),
        "summary": {
            "total": len(symbols),
            "available": len(available),
            "delisted_with_data": len(delisted_with_data),
            "missing": len(missing),
        },
    }

    AUDIT_FILE.parent.mkdir(parents=True, exist_ok=True)
    AUDIT_FILE.write_text(json.dumps(audit, indent=2), encoding="utf-8")

    print(f"\n--- Ticker Audit ---")
    print(f"Total unique tickers:    {len(symbols)}")
    print(f"Active in Polygon:       {len(available)}")
    print(f"Delisted (data exists):  {len(delisted_with_data)}")
    print(f"Missing entirely:        {len(missing)}")

    coverage = (len(available) + len(delisted_with_data)) / max(len(symbols), 1) * 100
    print(f"Coverage:                {coverage:.1f}%")

    if len(missing) / max(len(symbols), 1) > 0.05:
        print("\nWARNING: >5% of tickers are missing. Review missing list:")
        for sym in missing[:20]:
            print(f"  {sym}")
        if len(missing) > 20:
            print(f"  ... and {len(missing) - 20} more")

    print(f"\nAudit saved to {AUDIT_FILE}")
    db.close()


if __name__ == "__main__":
    main()
