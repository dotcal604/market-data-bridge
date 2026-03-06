"""Visualization and reporting for optimization results."""

import json
from pathlib import Path

import numpy as np
import pandas as pd
import plotly.graph_objects as go
from plotly.subplots import make_subplots

from config.settings import OUTPUT_DIR, REPORTS_DIR, EQUITY_DIR, DEFAULT_SHARES, COMMISSION_PER_SHARE, SLIPPAGE_PER_SHARE


def _ensure_dirs():
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    EQUITY_DIR.mkdir(parents=True, exist_ok=True)


def generate_heatmap(
    results_df: pd.DataFrame,
    exit_rule: str,
    param_x: str,
    param_y: str,
    metric: str = "sharpe",
    strategy: str = "ALL",
) -> Path:
    """Generate a 2-D heatmap for a two-parameter exit rule."""
    _ensure_dirs()

    df = results_df[results_df["exit_rule"] == exit_rule].copy()
    if df.empty:
        return None

    # Extract param values from JSON
    df["_params"] = df["param_json"].apply(json.loads)
    df[param_x] = df["_params"].apply(lambda p: p.get(param_x, 0))
    df[param_y] = df["_params"].apply(lambda p: p.get(param_y, 0))

    pivot = df.pivot_table(index=param_y, columns=param_x, values=metric, aggfunc="first")

    fig = go.Figure(
        data=go.Heatmap(
            z=pivot.values,
            x=[str(round(x, 2)) for x in pivot.columns],
            y=[str(round(y, 2)) for y in pivot.index],
            colorscale="RdYlGn",
            colorbar=dict(title=metric.capitalize()),
        )
    )
    fig.update_layout(
        title=f"{exit_rule} — {metric} ({strategy})",
        xaxis_title=param_x,
        yaxis_title=param_y,
        width=900,
        height=600,
    )

    filename = f"heatmap_{strategy}_{exit_rule}_{metric}.html"
    path = REPORTS_DIR / filename
    fig.write_html(str(path))

    # Also save PNG
    try:
        fig.write_image(str(path.with_suffix(".png")))
    except Exception:
        pass  # kaleido may not be installed

    return path


def generate_equity_curve(
    pnl_series: np.ndarray,
    label: str,
    baseline_pnl: np.ndarray | None = None,
    strategy: str = "ALL",
) -> Path:
    """Generate cumulative equity curve. Optionally overlay baseline."""
    _ensure_dirs()

    fig = go.Figure()
    cum = np.cumsum(pnl_series)
    fig.add_trace(go.Scatter(y=cum, mode="lines", name=label, line=dict(width=2)))

    if baseline_pnl is not None:
        cum_base = np.cumsum(baseline_pnl)
        fig.add_trace(
            go.Scatter(
                y=cum_base,
                mode="lines",
                name="Holly Baseline",
                line=dict(width=2, dash="dash", color="gray"),
            )
        )

    fig.update_layout(
        title=f"Equity Curve — {strategy}",
        xaxis_title="Trade #",
        yaxis_title="Cumulative P&L ($)",
        width=1000,
        height=500,
        template="plotly_white",
    )

    filename = f"equity_{strategy}_{label.replace(' ', '_')}.html"
    path = EQUITY_DIR / filename
    fig.write_html(str(path))
    return path


def generate_tearsheet(
    pnl_series: np.ndarray,
    label: str,
    strategy: str = "ALL",
) -> Path | None:
    """Generate a QuantStats tearsheet if available."""
    _ensure_dirs()

    try:
        import quantstats as qs

        # Convert to pandas Series with integer index (trade-level, not time-series)
        returns = pd.Series(pnl_series)
        path = REPORTS_DIR / f"tearsheet_{strategy}_{label.replace(' ', '_')}.html"
        # QuantStats expects returns, not P&L — normalize
        # Use cumulative equity to derive period returns
        equity = 100_000 + returns.cumsum()
        pct_returns = equity.pct_change().fillna(0)
        qs.reports.html(pct_returns, output=str(path), title=f"{label} ({strategy})")
        return path
    except Exception as e:
        print(f"  [reporter] QuantStats tearsheet failed: {e}")
        return None


def generate_summary_report(
    all_results_df: pd.DataFrame,
    strategies: list[str],
    output_dir: Path | None = None,
) -> Path:
    """
    Master summary: table of best exit rule per strategy + improvement vs baseline.
    """
    _ensure_dirs()
    out = output_dir or REPORTS_DIR

    rows = []
    for strat in strategies:
        strat_df = all_results_df[all_results_df["strategy_filter"] == strat]
        if strat_df.empty:
            continue

        baseline = strat_df[strat_df["exit_rule"] == "holly_baseline"]
        best = strat_df.nlargest(1, "sharpe").iloc[0]

        base_pnl = float(baseline["total_pnl"].iloc[0]) if not baseline.empty else 0.0

        rows.append({
            "Strategy": strat,
            "Trades": best["total_trades"],
            "Best Exit": best["exit_rule"],
            "Params": best["param_json"],
            "Win Rate": f"{best['win_rate']:.1%}",
            "Avg P&L": f"${best['avg_pnl']:.2f}",
            "Total P&L": f"${best['total_pnl']:,.0f}",
            "Sharpe": f"{best['sharpe']:.2f}",
            "PF": f"{best['profit_factor']:.2f}",
            "Baseline P&L": f"${base_pnl:,.0f}",
            "Improvement": f"{((best['total_pnl'] - base_pnl) / max(abs(base_pnl), 1)) * 100:.0f}%",
        })

    summary_df = pd.DataFrame(rows)

    # Save as HTML table
    html = f"""<!DOCTYPE html>
<html><head><title>Holly Exit Optimizer — Summary</title>
<style>
body {{ font-family: 'Segoe UI', sans-serif; margin: 2rem; background: #fafafa; }}
h1 {{ color: #1a1a2e; }}
table {{ border-collapse: collapse; width: 100%; }}
th, td {{ padding: 8px 12px; text-align: left; border-bottom: 1px solid #ddd; }}
th {{ background: #1a1a2e; color: white; }}
tr:hover {{ background: #f0f0f0; }}
.positive {{ color: #16a34a; font-weight: bold; }}
.negative {{ color: #dc2626; font-weight: bold; }}
</style></head><body>
<h1>Holly Exit Optimizer — Strategy Summary</h1>
{summary_df.to_html(index=False, escape=False)}
</body></html>"""

    path = out / "summary_report.html"
    path.write_text(html, encoding="utf-8")
    print(f"  [reporter] Summary report saved to {path}")
    return path
