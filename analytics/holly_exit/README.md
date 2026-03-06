# Holly Exit Optimizer v2

Research pipeline for optimizing exit strategies on Holly AI trades using VectorBT, Polygon SIP data, and DuckDB.

## Problem

94.9% of Holly AI trades go profitable at some point, but only ~41% close profitably (avg P&L: $1.26/trade). This pipeline replays every Holly trade minute-by-minute with alternative exit rules to find optimal per-strategy exit parameters.

## Architecture

```
TraderSync CSV + Holly CSV  -->  DuckDB  -->  VectorBT sweep  -->  optimal_exit_params.json
         +
Polygon 1-min bars (Parquet)
```

## Quick Start

```powershell
cd C:\Users\dotca\source\holly-exit-optimizer
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt

# Set your Polygon API key
# Edit .env: POLYGON_API_KEY=pk_xxxxx

# Copy holly_trades.csv to data/raw/

python scripts/01_ingest_trades.py
python scripts/02_audit_tickers.py
python scripts/03_fetch_bars.py
python scripts/04_load_bars_to_ddb.py
python scripts/05_run_optimization.py
python scripts/07_export_params.py
```

## Output

`output/optimal_exit_params.json` — per-strategy optimal exit rule parameters for the Layer 2 MCP server.

## Exit Rules Tested

1. Fixed trailing stop
2. ATR-based trailing stop
3. Time-decay trailing stop
4. Fixed take-profit
5. Time-based exit
6. Partial profit + trail
7. Breakeven stop + trail
8. Volume climax exit
9. Holly baseline (control)

## Requirements

- Python 3.11 (VectorBT compatibility)
- Polygon Developer tier API key ($79/mo — subscribe, pull data, cancel)
- 80GB RAM machine (Alienware Aurora R13)
