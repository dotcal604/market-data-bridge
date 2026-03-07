"""Cross-strategy comparison with statistical tests.

Ranks all strategies by risk-adjusted metrics and runs significance tests
(bootstrap confidence intervals, Mann-Whitney U) to distinguish real edge
from noise.
"""

import warnings

import numpy as np
import pandas as pd
from scipy import stats as scipy_stats

from .config import (
    MIN_TRADES_FOR_STRATEGY, STRATEGIES_DIR, COMPARISON_DIR,
    STYLED_TABLE_CSS, ensure_dirs,
)
from .returns_engine import get_returns
from .tearsheet_factory import TearsheetFactory, _fmt_pct, _fmt_num, _fmt_dollar
from .custom_metrics import trade_level_metrics, compute_kelly_criterion, compute_cpc_index

warnings.filterwarnings("ignore", category=FutureWarning)


class StrategyRanker:
    """Rank strategies and generate cross-strategy comparison tearsheets."""

    def __init__(self, factory: TearsheetFactory = None):
        self.factory = factory or TearsheetFactory()
        ensure_dirs()

    def generate_strategy_tearsheets(
        self,
        df: pd.DataFrame,
        returns_method: str = "dollar_pnl",
        top_n: int = 30,
        min_trades: int = MIN_TRADES_FOR_STRATEGY,
        generate_individual: bool = True,
    ) -> dict:
        """
        Generate per-strategy tearsheets and a master comparison.

        Parameters
        ----------
        df : Holly trades DataFrame
        returns_method : return conversion method
        top_n : number of top strategies by trade count to process
        min_trades : minimum trades for inclusion
        generate_individual : whether to generate individual HTML tearsheets

        Returns
        -------
        dict with strategy results and comparison data
        """
        results = {}
        comparison_rows = []

        # Get strategies sorted by trade count
        strat_counts = df.groupby("strategy").size().sort_values(ascending=False)
        eligible = strat_counts[strat_counts >= min_trades].head(top_n)

        print(f"\n{'='*60}")
        print(f"Strategy Tearsheets ({len(eligible)} strategies, min {min_trades} trades)")
        print(f"{'='*60}")

        for strategy, count in eligible.items():
            strat_df = df[df["strategy"] == strategy]
            returns = get_returns(strat_df, method=returns_method)

            if len(returns) < 20:
                continue

            safe_name = str(strategy).replace(" ", "_").replace("/", "_").replace("\\", "_")[:50]

            # Individual tearsheet
            if generate_individual:
                output_path = STRATEGIES_DIR / f"strategy_{safe_name}.html"
                result = self.factory.generate_full_tearsheet(
                    returns=returns,
                    title=f"Holly — {strategy} ({count} trades)",
                    output_path=str(output_path),
                    trade_df=strat_df,
                    include_plots=False,
                )
            else:
                # Just compute metrics, no HTML
                result = self.factory.generate_full_tearsheet(
                    returns=returns,
                    title=strategy,
                    trade_df=strat_df,
                    include_quantstats=False,
                    include_plots=False,
                )

            results[strategy] = result

            # Build comparison row
            ext = result.get("metrics", {}).get("extended", {})
            trade = result.get("metrics", {}).get("trade_level", {})

            row = {
                "strategy": strategy,
                "trades": count,
                "win_rate": trade.get("win_rate"),
                "total_pnl": trade.get("total_pnl"),
                "avg_pnl": trade.get("avg_pnl"),
                "sharpe": ext.get("sharpe"),
                "sortino": ext.get("sortino"),
                "calmar": ext.get("calmar"),
                "max_drawdown": ext.get("max_drawdown"),
                "omega": ext.get("omega"),
                "cagr": ext.get("cagr"),
                "profit_factor": trade.get("profit_factor"),
                "payoff_ratio": trade.get("payoff_ratio"),
                "kelly": compute_kelly_criterion(strat_df),
                "cpc_index": compute_cpc_index(strat_df),
                "expectancy": trade.get("expectancy"),
                "stability": ext.get("stability_of_timeseries"),
                "avg_hold_min": trade.get("avg_hold_minutes"),
                "max_win_streak": trade.get("max_win_streak"),
                "max_loss_streak": trade.get("max_loss_streak"),
            }
            comparison_rows.append(row)

        # ── Master comparison table ───────────────────────────────
        if comparison_rows:
            comp_df = pd.DataFrame(comparison_rows)
            comp_path = self._generate_master_comparison(comp_df)
            results["_comparison_path"] = str(comp_path)
            results["_comparison_df"] = comp_df

        # ── Statistical significance tests ────────────────────────
        if len(comparison_rows) >= 2:
            sig_path = self._run_significance_tests(df, eligible.index.tolist())
            results["_significance_path"] = str(sig_path)

        return results

    def _generate_master_comparison(self, comp_df: pd.DataFrame) -> "Path":
        """Generate the master strategy comparison HTML."""
        display = pd.DataFrame()
        display["Strategy"] = comp_df["strategy"]
        display["Trades"] = comp_df["trades"]
        display["Win Rate"] = comp_df["win_rate"].apply(lambda x: _fmt_pct(x) if x else "")
        display["Total PnL"] = comp_df["total_pnl"].apply(lambda x: _fmt_dollar(x) if x else "")
        display["Avg PnL"] = comp_df["avg_pnl"].apply(lambda x: f"${x:.0f}" if x else "")
        display["Sharpe"] = comp_df["sharpe"].apply(lambda x: _fmt_num(x) if x else "")
        display["Sortino"] = comp_df["sortino"].apply(lambda x: _fmt_num(x) if x else "")
        display["Max DD"] = comp_df["max_drawdown"].apply(lambda x: _fmt_pct(x) if x else "")
        display["PF"] = comp_df["profit_factor"].apply(lambda x: _fmt_num(x) if x else "")
        display["Kelly"] = comp_df["kelly"].apply(lambda x: _fmt_pct(x) if x else "")
        display["CPC"] = comp_df["cpc_index"].apply(lambda x: _fmt_num(x) if x else "")
        display["Stability"] = comp_df["stability"].apply(lambda x: _fmt_num(x) if x else "")
        display["Avg Hold"] = comp_df["avg_hold_min"].apply(
            lambda x: f"{x:.0f}m" if pd.notna(x) else ""
        )

        # Sort by Sharpe
        display = display.sort_values(
            "Sharpe", ascending=False,
            key=lambda x: pd.to_numeric(x, errors="coerce"),
        )

        path = COMPARISON_DIR / "strategy_master_comparison.html"

        html = f"""<!DOCTYPE html>
<html><head><title>Strategy Master Comparison</title>
{STYLED_TABLE_CSS}
</head><body>
<h1>Holly AI — Strategy Master Comparison</h1>
<p>{len(display)} strategies, sorted by Sharpe ratio</p>
{display.to_html(index=False, escape=False, na_rep="")}
</body></html>"""

        path.write_text(html, encoding="utf-8")
        print(f"  -> Master comparison: {path.name}")
        return path

    def _run_significance_tests(
        self,
        df: pd.DataFrame,
        strategies: list[str],
    ) -> "Path":
        """
        Run statistical significance tests between strategy pairs.

        Uses:
          - Mann-Whitney U test (non-parametric, no normality assumption)
          - Bootstrap confidence intervals for mean PnL difference
        """
        print(f"\n  Running significance tests across {len(strategies)} strategies...")
        rows = []

        # Test each strategy against the overall mean
        overall_mean_pnl = df["holly_pnl"].mean()

        for strategy in strategies:
            strat_pnl = df[df["strategy"] == strategy]["holly_pnl"].dropna()
            rest_pnl = df[df["strategy"] != strategy]["holly_pnl"].dropna()

            if len(strat_pnl) < 20:
                continue

            # Mann-Whitney U test vs rest
            try:
                u_stat, u_pval = scipy_stats.mannwhitneyu(
                    strat_pnl, rest_pnl, alternative="two-sided"
                )
            except Exception:
                u_stat, u_pval = np.nan, np.nan

            # One-sample t-test: is strategy mean significantly different from overall?
            try:
                t_stat, t_pval = scipy_stats.ttest_1samp(strat_pnl, overall_mean_pnl)
            except Exception:
                t_stat, t_pval = np.nan, np.nan

            # Bootstrap CI for mean PnL
            ci_lo, ci_hi = _bootstrap_ci(strat_pnl.values, n_bootstrap=1000)

            # Cohen's d effect size
            pooled_std = np.sqrt(
                (strat_pnl.std()**2 + rest_pnl.std()**2) / 2
            )
            cohens_d = (strat_pnl.mean() - rest_pnl.mean()) / max(pooled_std, 1)

            rows.append({
                "Strategy": strategy,
                "N": len(strat_pnl),
                "Mean PnL": f"${strat_pnl.mean():.0f}",
                "Median PnL": f"${strat_pnl.median():.0f}",
                "Boot CI Lo": f"${ci_lo:.0f}",
                "Boot CI Hi": f"${ci_hi:.0f}",
                "t-stat": f"{t_stat:.2f}" if not np.isnan(t_stat) else "",
                "t p-val": f"{t_pval:.4f}" if not np.isnan(t_pval) else "",
                "M-W p-val": f"{u_pval:.4f}" if not np.isnan(u_pval) else "",
                "Cohen's d": f"{cohens_d:.3f}",
                "Significant": "Yes" if (t_pval < 0.05 if not np.isnan(t_pval) else False) else "",
            })

        sig_df = pd.DataFrame(rows)

        path = COMPARISON_DIR / "strategy_significance_tests.html"
        html = f"""<!DOCTYPE html>
<html><head><title>Strategy Significance Tests</title>
{STYLED_TABLE_CSS}
</head><body>
<h1>Statistical Significance Tests</h1>
<p>Each strategy tested against the rest of the portfolio.<br>
Bootstrap: 1000 iterations, 95% CI. Mann-Whitney U: non-parametric rank test.<br>
Overall mean PnL: ${overall_mean_pnl:,.0f}</p>
{sig_df.to_html(index=False, escape=False)}
</body></html>"""

        path.write_text(html, encoding="utf-8")
        print(f"  -> Significance tests: {path.name}")
        return path


def _bootstrap_ci(
    data: np.ndarray,
    n_bootstrap: int = 1000,
    ci: float = 0.95,
) -> tuple[float, float]:
    """Bootstrap confidence interval for the mean."""
    rng = np.random.default_rng(42)
    boot_means = np.array([
        rng.choice(data, size=len(data), replace=True).mean()
        for _ in range(n_bootstrap)
    ])
    alpha = (1 - ci) / 2
    return float(np.percentile(boot_means, alpha * 100)), float(np.percentile(boot_means, (1 - alpha) * 100))
