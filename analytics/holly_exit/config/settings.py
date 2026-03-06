import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

# ── Paths ──────────────────────────────────────────────────────
PROJECT_ROOT = Path(__file__).parent.parent
DATA_DIR = PROJECT_ROOT / "data"
RAW_DIR = DATA_DIR / "raw"
PARQUET_DIR = DATA_DIR / "parquet" / "bars"
DUCKDB_PATH = DATA_DIR / "duckdb" / "holly.ddb"
OUTPUT_DIR = PROJECT_ROOT / "output"
REPORTS_DIR = OUTPUT_DIR / "reports"
EQUITY_DIR = OUTPUT_DIR / "equity_curves"

# ── API ────────────────────────────────────────────────────────
POLYGON_API_KEY = os.getenv("POLYGON_API_KEY")

# ── Trade filters ──────────────────────────────────────────────
EXCLUDE_STRATEGIES = ["Breakout Long"]
MIN_STOP_BUFFER_PCT = 0.35
MIN_ENTRY_PRICE = 5.0
MAX_ENTRY_PRICE = 500.0

# ── Optimization ───────────────────────────────────────────────
MAX_HOLD_MINUTES = 240  # 4 hours max
MIN_TRADES_FOR_SIGNIFICANCE = 30
COMMISSION_PER_SHARE = 0.005  # IBKR tiered
SLIPPAGE_PER_SHARE = 0.01  # Conservative estimate
DEFAULT_SHARES = 100  # Normalize all trades to 100 shares for comparison

# ── Polygon fetch ──────────────────────────────────────────────
POLYGON_CONCURRENCY = 10
POLYGON_RETRY_MAX = 3
POLYGON_RETRY_BACKOFF = 2.0  # Exponential backoff base seconds
