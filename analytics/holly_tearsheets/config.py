"""Configuration: paths, color schemes, thresholds."""

from pathlib import Path

# ── Paths ─────────────────────────────────────────────────────────
PACKAGE_ROOT = Path(__file__).parent
ANALYTICS_ROOT = PACKAGE_ROOT.parent / "holly_exit"
HOLLY_CSV = ANALYTICS_ROOT / "output" / "holly_analytics.csv"
OUTPUT_DIR = PACKAGE_ROOT / "output"
REGIMES_DIR = OUTPUT_DIR / "regimes"
STRATEGIES_DIR = OUTPUT_DIR / "strategies"
DIRECTIONS_DIR = OUTPUT_DIR / "directions"
YEARLY_DIR = OUTPUT_DIR / "yearly"
PLOTS_DIR = OUTPUT_DIR / "plots"
COMPARISON_DIR = OUTPUT_DIR / "comparisons"

# ── Return conversion defaults ────────────────────────────────────
DEFAULT_INITIAL_EQUITY = 100_000
DEFAULT_SHARES = 100

# ── Filtering thresholds ─────────────────────────────────────────
MIN_TRADES_FOR_TEARSHEET = 50
MIN_TRADES_FOR_STRATEGY = 30
MIN_TRADES_FOR_REGIME = 50
MIN_TRADES_FOR_TRANSITION = 20

# ── Data validation ──────────────────────────────────────────────
EXPECTED_ROW_COUNT = 28_875
EXPECTED_DATE_RANGE = ("2016-01-01", "2026-12-31")

# ── Visual ────────────────────────────────────────────────────────
COLOR_SCHEME = {
    "positive": "#16a34a",
    "negative": "#dc2626",
    "neutral": "#6b7280",
    "primary": "#1a1a2e",
    "secondary": "#16213e",
    "accent": "#0f3460",
    "background": "#fafafa",
}

STYLED_TABLE_CSS = """
<style>
body { font-family: 'Segoe UI', sans-serif; margin: 2rem; background: #fafafa; }
h1, h2 { color: #1a1a2e; }
table { border-collapse: collapse; width: 100%; margin: 1rem 0; }
th, td { padding: 8px 12px; text-align: left; border-bottom: 1px solid #ddd; }
th { background: #1a1a2e; color: white; position: sticky; top: 0; }
tr:hover { background: #f0f0f0; }
tr:nth-child(even) { background: #f8f8f8; }
.positive { color: #16a34a; font-weight: bold; }
.negative { color: #dc2626; font-weight: bold; }
.metric-card { display: inline-block; background: white; border: 1px solid #ddd;
               border-radius: 8px; padding: 1rem; margin: 0.5rem; min-width: 150px;
               text-align: center; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
.metric-card .value { font-size: 1.4rem; font-weight: bold; }
.metric-card .label { font-size: 0.85rem; color: #666; }
</style>
"""


def ensure_dirs():
    """Create all output directories."""
    for d in [OUTPUT_DIR, REGIMES_DIR, STRATEGIES_DIR, DIRECTIONS_DIR,
              YEARLY_DIR, PLOTS_DIR, COMPARISON_DIR]:
        d.mkdir(parents=True, exist_ok=True)
