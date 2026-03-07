"""Core tearsheet generation engine.

Combines QuantStats HTML reports, extended metrics via qs.stats + empyrical,
and custom visualizations into unified output.
"""

import warnings
from pathlib import Path

import numpy as np
import pandas as pd

from .config import OUTPUT_DIR, PLOTS_DIR, ensure_dirs
from .custom_metrics import trade_level_metrics

warnings.filterwarnings("ignore", category=FutureWarning)
warnings.filterwarnings("ignore", category=UserWarning)


class TearsheetFactory:
    """Generate institutional-grade tearsheets from return series."""

    def __init__(self):
        ensure_dirs()
        self._qs = None
        self._empyrical = None
        self._load_libs()

    def _load_libs(self):
        """Lazy-load QuantStats and empyrical."""
        try:
            import quantstats as qs
            self._qs = qs
        except ImportError:
            raise ImportError("quantstats is required: pip install quantstats")

        try:
            import empyrical
            self._empyrical = empyrical
        except ImportError:
            print("  WARNING: empyrical not installed. Some metrics will be unavailable.")

    def generate_full_tearsheet(
        self,
        returns: pd.Series,
        benchmark: pd.Series = None,
        title: str = "Holly AI Portfolio",
        output_path: str = None,
        trade_df: pd.DataFrame = None,
        include_quantstats: bool = True,
        include_extended: bool = True,
        include_plots: bool = True,
        include_trade_metrics: bool = True,
    ) -> dict:
        """
        Generate a comprehensive tearsheet combining all analysis engines.

        Parameters
        ----------
        returns : pd.Series
            Daily return series (DatetimeIndex).
        benchmark : pd.Series, optional
            Benchmark return series (e.g., SPY).
        title : str
            Report title.
        output_path : str or Path, optional
            Where to save the QuantStats HTML. Defaults to output/{title}.html.
        trade_df : pd.DataFrame, optional
            Raw trade-level data for custom metrics.
        include_quantstats : bool
            Generate QuantStats HTML tearsheet.
        include_extended : bool
            Compute extended risk metrics.
        include_plots : bool
            Generate individual plot PNGs.
        include_trade_metrics : bool
            Compute trade-level custom metrics.

        Returns
        -------
        dict with all computed metrics for programmatic access.
        """
        qs = self._qs
        result = {"title": title, "metrics": {}, "paths": {}}

        if output_path is None:
            safe_title = title.replace(" ", "_").replace("/", "_")[:60]
            output_path = OUTPUT_DIR / f"{safe_title}.html"
        output_path = Path(output_path)
        output_path.parent.mkdir(parents=True, exist_ok=True)

        # ── 1. QuantStats HTML Tearsheet ──────────────────────────
        if include_quantstats:
            try:
                qs.reports.html(
                    returns,
                    benchmark=benchmark,
                    output=str(output_path),
                    title=title,
                    download_filename=output_path.stem,
                )
                size_kb = output_path.stat().st_size / 1024
                print(f"  -> {output_path.name} ({size_kb:.0f} KB)")
                result["paths"]["html_tearsheet"] = str(output_path)
            except Exception as e:
                print(f"  FAILED QuantStats HTML for '{title}': {e}")

        # ── 2. Extended Metrics ───────────────────────────────────
        if include_extended:
            result["metrics"]["extended"] = self._compute_extended_metrics(
                returns, benchmark
            )

        # ── 3. Custom Plots ───────────────────────────────────────
        if include_plots:
            result["paths"]["plots"] = self._generate_plots(
                returns, benchmark, title
            )

        # ── 4. Trade-Level Metrics ────────────────────────────────
        if include_trade_metrics and trade_df is not None and len(trade_df) > 0:
            result["metrics"]["trade_level"] = trade_level_metrics(trade_df)

        return result

    def _compute_extended_metrics(
        self,
        returns: pd.Series,
        benchmark: pd.Series = None,
    ) -> dict:
        """Compute extended risk/return metrics using qs.stats + empyrical."""
        qs = self._qs
        emp = self._empyrical
        m = {}

        # ── QuantStats metrics ────────────────────────────────────
        safe_metrics = {
            "sharpe": lambda: qs.stats.sharpe(returns),
            "sortino": lambda: qs.stats.sortino(returns),
            "calmar": lambda: qs.stats.calmar(returns),
            "omega": lambda: qs.stats.omega(returns),
            "max_drawdown": lambda: qs.stats.max_drawdown(returns),
            "avg_drawdown": lambda: _safe_call(qs.stats, "avg_drawdown", returns),
            "gain_pain_ratio": lambda: qs.stats.gain_to_pain_ratio(returns),
            "tail_ratio": lambda: qs.stats.tail_ratio(returns),
            "common_sense_ratio": lambda: qs.stats.common_sense_ratio(returns),
            "kelly_criterion": lambda: qs.stats.kelly_criterion(returns),
            "kurtosis": lambda: qs.stats.kurtosis(returns),
            "skew": lambda: qs.stats.skew(returns),
            "value_at_risk_95": lambda: qs.stats.value_at_risk(returns),
            "cvar_95": lambda: qs.stats.cvar(returns),
            "expected_shortfall": lambda: _safe_call(qs.stats, "expected_shortfall", returns),
            "cagr": lambda: qs.stats.cagr(returns),
            "volatility": lambda: qs.stats.volatility(returns),
            "avg_return": lambda: qs.stats.avg_return(returns),
            "avg_win": lambda: qs.stats.avg_win(returns),
            "avg_loss": lambda: qs.stats.avg_loss(returns),
            "win_rate": lambda: qs.stats.win_rate(returns),
            "profit_factor": lambda: qs.stats.profit_factor(returns),
            "payoff_ratio": lambda: qs.stats.payoff_ratio(returns),
            "best_day": lambda: qs.stats.best(returns),
            "worst_day": lambda: qs.stats.worst(returns),
        }

        for name, fn in safe_metrics.items():
            try:
                val = fn()
                m[name] = _to_float(val)
            except Exception:
                m[name] = None

        # Drawdown details
        try:
            dd_details = qs.stats.drawdown_details(returns)
            if dd_details is not None and not dd_details.empty:
                m["max_drawdown_duration_days"] = int(dd_details["days"].max())
                m["avg_drawdown_duration_days"] = round(dd_details["days"].mean(), 1)
                m["num_drawdown_periods"] = len(dd_details)
        except Exception:
            pass

        # ── Empyrical metrics ─────────────────────────────────────
        if emp is not None:
            emp_metrics = {
                "stability_of_timeseries": lambda: emp.stability_of_timeseries(returns),
                "annual_return": lambda: emp.annual_return(returns),
                "annual_volatility": lambda: emp.annual_volatility(returns),
            }

            if benchmark is not None:
                emp_metrics.update({
                    "alpha": lambda: emp.alpha(returns, benchmark),
                    "beta": lambda: emp.beta(returns, benchmark),
                    "information_ratio": lambda: _safe_call(
                        qs.stats, "information_ratio", returns, benchmark
                    ),
                    "capture_ratio": lambda: _safe_call(
                        qs.stats, "capture", returns, benchmark
                    ),
                })

            for name, fn in emp_metrics.items():
                try:
                    val = fn()
                    m[name] = _to_float(val)
                except Exception:
                    m[name] = None

        return m

    def _generate_plots(
        self,
        returns: pd.Series,
        benchmark: pd.Series = None,
        title: str = "Holly",
    ) -> dict:
        """Generate individual plot PNGs using QuantStats plotting functions."""
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt

        qs = self._qs
        safe_title = title.replace(" ", "_").replace("/", "_")[:40]
        plot_dir = PLOTS_DIR / safe_title
        plot_dir.mkdir(parents=True, exist_ok=True)
        paths = {}

        plot_fns = {
            "snapshot": lambda: qs.plots.snapshot(returns, title=title, show=False),
            "drawdown": lambda: qs.plots.drawdown(returns, show=False),
            "drawdown_periods": lambda: qs.plots.drawdowns_periods(returns, show=False),
            "monthly_heatmap": lambda: qs.plots.monthly_heatmap(returns, show=False),
            "rolling_sharpe": lambda: qs.plots.rolling_sharpe(returns, show=False),
            "rolling_sortino": lambda: qs.plots.rolling_sortino(returns, show=False),
            "rolling_volatility": lambda: qs.plots.rolling_volatility(returns, show=False),
            "yearly_returns": lambda: qs.plots.yearly_returns(returns, show=False),
            "distribution": lambda: qs.plots.distribution(returns, show=False),
            "histogram": lambda: qs.plots.histogram(returns, show=False),
        }

        # Benchmark-dependent plots
        if benchmark is not None:
            plot_fns["rolling_beta"] = lambda: qs.plots.rolling_beta(
                returns, benchmark, show=False
            )

        for name, fn in plot_fns.items():
            try:
                fig = fn()
                if fig is not None:
                    out = plot_dir / f"{name}.png"
                    # QuantStats returns either a figure or axes
                    if hasattr(fig, "savefig"):
                        fig.savefig(str(out), dpi=150, bbox_inches="tight")
                    else:
                        plt.savefig(str(out), dpi=150, bbox_inches="tight")
                    paths[name] = str(out)
                plt.close("all")
            except Exception as e:
                plt.close("all")
                # Silently skip failed plots
                pass

        return paths

    def generate_comparison_html(
        self,
        metrics_list: list[dict],
        output_path: str = None,
        title: str = "Strategy Comparison",
    ) -> Path:
        """
        Generate a styled HTML comparison table from multiple metric dicts.

        Parameters
        ----------
        metrics_list : list of dicts, each with 'name' key and metric values
        output_path : where to save HTML
        title : page title

        Returns
        -------
        Path to generated HTML
        """
        from .config import STYLED_TABLE_CSS, COMPARISON_DIR

        if output_path is None:
            safe = title.replace(" ", "_")[:50]
            output_path = COMPARISON_DIR / f"{safe}.html"
        output_path = Path(output_path)
        output_path.parent.mkdir(parents=True, exist_ok=True)

        # Build DataFrame from metrics
        rows = []
        for entry in metrics_list:
            row = {"Name": entry.get("name", "?")}
            ext = entry.get("metrics", {}).get("extended", {})
            trade = entry.get("metrics", {}).get("trade_level", {})

            row["Trades"] = trade.get("total_trades", "")
            row["Win Rate"] = _fmt_pct(trade.get("win_rate"))
            row["Total PnL"] = _fmt_dollar(trade.get("total_pnl"))
            row["Sharpe"] = _fmt_num(ext.get("sharpe"))
            row["Sortino"] = _fmt_num(ext.get("sortino"))
            row["Calmar"] = _fmt_num(ext.get("calmar"))
            row["Max DD"] = _fmt_pct(ext.get("max_drawdown"))
            row["CAGR"] = _fmt_pct(ext.get("cagr"))
            row["Omega"] = _fmt_num(ext.get("omega"))
            row["Profit Factor"] = _fmt_num(trade.get("profit_factor") or ext.get("profit_factor"))
            row["Kelly"] = _fmt_pct(ext.get("kelly_criterion"))
            row["VaR 95%"] = _fmt_pct(ext.get("value_at_risk_95"))
            row["Stability"] = _fmt_num(ext.get("stability_of_timeseries"))
            rows.append(row)

        df = pd.DataFrame(rows)

        html = f"""<!DOCTYPE html>
<html><head><title>{title}</title>
{STYLED_TABLE_CSS}
</head><body>
<h1>{title}</h1>
<p>Generated from {len(metrics_list)} slices</p>
{df.to_html(index=False, escape=False, na_rep="")}
</body></html>"""

        output_path.write_text(html, encoding="utf-8")
        print(f"  -> Comparison: {output_path.name}")
        return output_path


def _to_float(val) -> float | None:
    """Safely convert QuantStats output to float."""
    if val is None:
        return None
    try:
        f = float(val)
        if np.isnan(f) or np.isinf(f):
            return None
        return round(f, 6)
    except (TypeError, ValueError):
        return None


def _safe_call(module, method_name, *args, **kwargs):
    """Safely call a method that might not exist."""
    fn = getattr(module, method_name, None)
    if fn is None:
        return None
    return fn(*args, **kwargs)


def _fmt_pct(val) -> str:
    if val is None:
        return ""
    return f"{val:.2%}"


def _fmt_num(val) -> str:
    if val is None:
        return ""
    return f"{val:.3f}"


def _fmt_dollar(val) -> str:
    if val is None:
        return ""
    return f"${val:,.0f}"
