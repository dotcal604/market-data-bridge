# Analytics

Offline Python analytics for the Market Data Bridge eval engine.

## Setup

```bash
cd analytics
python -m venv .venv
source .venv/bin/activate    # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

## Usage

```python
from db_loader import load_eval_outcomes, load_model_outputs, load_weights, summary

# Quick health check
print(summary())

# Core analytics table: evals + outcomes
df = load_eval_outcomes(days=90)

# Per-model predictions + outcomes (for weight recalibration)
df = load_model_outcomes(days=90)
```

## Scripts

| Script | Purpose | Roadmap Item |
|--------|---------|-------------|
| `calibration.py` | Brier score per model, calibration curves | EI=5, Thesis B |
| `regime.py` | Win rate by volatility x time x liquidity | EI=5, Thesis C |
| `recalibrate_weights.py` | Auto-tune model weights from outcomes | EI=4, Thesis B |
| `agreement.py` | Model agreement vs outcome correlation | EI=4, Thesis B |
| `agreement_analysis.py` | Agreement buckets from score directions + win rates | EI=4, Thesis B |

## DB Loader Functions

| Function | Returns | Use Case |
|----------|---------|----------|
| `load_eval_outcomes()` | Evals + outcomes | Calibration, regime analysis |
| `load_model_outputs()` | Per-model predictions | Agreement analysis |
| `load_model_outcomes()` | Models + outcomes | Weight recalibration |
| `load_evaluations()` | Raw evaluations | Feature exploration |
| `load_weight_history()` | Weight snapshots | Audit trail |
| `load_weights()` | Current weights dict | Recalibration baseline |
| `summary()` | Table row counts | Sanity checks |
