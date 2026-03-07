#!/usr/bin/env python3
"""One-command entry point: generates everything.

Usage:
    python analytics/holly_tearsheets/run_all.py
    python analytics/holly_tearsheets/run_all.py --method trade_weighted
    python analytics/holly_tearsheets/run_all.py --skip-benchmark --top 50
"""

import sys
from pathlib import Path

# Ensure package is importable when run directly
sys.path.insert(0, str(Path(__file__).parent.parent))

from holly_tearsheets.batch_runner import main

if __name__ == "__main__":
    main()
