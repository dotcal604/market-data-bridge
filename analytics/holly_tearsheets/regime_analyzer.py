"""Regime-specific tearsheet generation.

Generates tearsheets sliced by:
  - Combined regime (trend|vol|momentum)
  - Individual trend regimes (uptrend, downtrend, sideways)
  - Individual vol regimes (high, normal, low)
  - Regime transitions (performance after regime changes)
"""

import pandas as pd
import numpy as np

from .config import (
    MIN_TRADES_FOR_REGIME, REGIMES_DIR, COMPARISON_DIR,
    STYLED_TABLE_CSS, ensure_dirs,
)
from .returns_engine import get_returns, get_benchmark_returns, align_returns
from .tearsheet_factory import TearsheetFactory, _fmt_pct, _fmt_num, _fmt_dollar


class RegimeAnalyzer:
    """Generate regime-sliced tearsheets and comparison tables."""

    def __init__(self, factory: TearsheetFactory = None):
        self.factory = factory or TearsheetFactory()
        ensure_dirs()

    def generate_regime_tearsheets(
        self,
        df: pd.DataFrame,
        returns_method: str = "dollar_pnl",
        benchmark_ticker: str = "SPY",
        min_trades: int = MIN_TRADES_FOR_REGIME,
    ) -> dict:
        """
        Generate tearsheets for each regime combination with >= min_trades.

        Also generates:
          - Individual trend/vol/momentum tearsheets
          - Regime comparison summary table
          - Transition analysis

        Returns dict of all generated results keyed by regime name.
        """
        results = {}
        comparison_rows = []

        # ── Combined regime tearsheets ────────────────────────────
        print(f"\n{'='*60}")
        print("Regime Combination Tearsheets")
        print(f"{'='*60}")

        regime_counts = df["regime_combo"].value_counts()
        eligible = regime_counts[
            (regime_counts >= min_trades) & (regime_counts.index != "no_regime")
        ]
        print(f"  {len(eligible)} regime combos with >= {min_trades} trades")

        for regime, count in eligible.items():
            regime_df = df[df["regime_combo"] == regime]
            returns = get_returns(regime_df, method=returns_method)

            if len(returns) < 30:
                continue

            safe_name = str(regime).replace("|", "_").replace(" ", "_")[:60]
            output_path = REGIMES_DIR / f"regime_{safe_name}.html"

            result = self.factory.generate_full_tearsheet(
                returns=returns,
                title=f"Holly — {regime} ({count} trades)",
                output_path=str(output_path),
                trade_df=regime_df,
                include_plots=False,  # too many regimes for individual plots
            )
            results[regime] = result

            # Collect for comparison table
            ext = result.get("metrics", {}).get("extended", {})
            trade = result.get("metrics", {}).get("trade_level", {})
            comparison_rows.append({
                "name": regime,
                "trades": count,
                "win_rate": trade.get("win_rate"),
                "total_pnl": trade.get("total_pnl"),
                "sharpe": ext.get("sharpe"),
                "sortino": ext.get("sortino"),
                "max_drawdown": ext.get("max_drawdown"),
                "calmar": ext.get("calmar"),
                "omega": ext.get("omega"),
                "cagr": ext.get("cagr"),
                "profit_factor": trade.get("profit_factor"),
                "metrics": result.get("metrics", {}),
            })

        # ── Individual dimension tearsheets ───────────────────────
        print(f"\n{'='*60}")
        print("Individual Regime Dimension Tearsheets")
        print(f"{'='*60}")

        for dimension, col in [
            ("trend", "trend_regime"),
            ("vol", "vol_regime"),
            ("momentum", "momentum_regime"),
        ]:
            for regime_val in df[col].dropna().unique():
                if str(regime_val) in ("nan", "None", "<NA>"):
                    continue
                regime_df = df[df[col] == regime_val]
                if len(regime_df) < min_trades:
                    continue

                returns = get_returns(regime_df, method=returns_method)
                if len(returns) < 30:
                    continue

                safe = str(regime_val).replace(" ", "_")
                output_path = REGIMES_DIR / f"{dimension}_{safe}.html"
                result = self.factory.generate_full_tearsheet(
                    returns=returns,
                    title=f"Holly — {regime_val} ({len(regime_df)} trades)",
                    output_path=str(output_path),
                    trade_df=regime_df,
                    include_plots=False,
                )
                results[f"{dimension}_{regime_val}"] = result

                ext = result.get("metrics", {}).get("extended", {})
                trade = result.get("metrics", {}).get("trade_level", {})
                comparison_rows.append({
                    "name": f"[{dimension}] {regime_val}",
                    "trades": len(regime_df),
                    "win_rate": trade.get("win_rate"),
                    "total_pnl": trade.get("total_pnl"),
                    "sharpe": ext.get("sharpe"),
                    "sortino": ext.get("sortino"),
                    "max_drawdown": ext.get("max_drawdown"),
                    "calmar": ext.get("calmar"),
                    "omega": ext.get("omega"),
                    "cagr": ext.get("cagr"),
                    "profit_factor": trade.get("profit_factor"),
                    "metrics": result.get("metrics", {}),
                })

        # ── Comparison table ──────────────────────────────────────
        if comparison_rows:
            comp_path = self._generate_comparison_table(
                comparison_rows, "Regime Comparison"
            )
            results["_comparison_path"] = str(comp_path)

        # ── Transition analysis ───────────────────────────────────
        print(f"\n{'='*60}")
        print("Regime Transition Analysis")
        print(f"{'='*60}")
        transition = self.analyze_transitions(df)
        results["_transitions"] = transition

        return results

    def analyze_transitions(
        self,
        df: pd.DataFrame,
        window: int = 20,
    ) -> pd.DataFrame:
        """
        Analyze returns in the N trades AFTER a regime change.

        For each regime transition (e.g., uptrend→downtrend), compute
        performance of the first `window` trades in the new regime.

        Returns DataFrame with transition stats.
        """
        # Only use rows with regime data, sorted by time
        regime_df = df[df["regime_combo"] != "no_regime"].sort_values("entry_time").copy()

        if len(regime_df) < window * 2:
            print("  Not enough regime data for transition analysis.")
            return pd.DataFrame()

        # Detect regime changes
        regime_df["prev_regime"] = regime_df["regime_combo"].shift(1)
        regime_df["regime_changed"] = regime_df["regime_combo"] != regime_df["prev_regime"]

        # Find transition points
        change_indices = regime_df[regime_df["regime_changed"]].index.tolist()

        rows = []
        for idx in change_indices:
            loc = regime_df.index.get_loc(idx)
            if loc + window > len(regime_df):
                continue

            transition_trades = regime_df.iloc[loc:loc + window]
            from_regime = regime_df.iloc[loc]["prev_regime"]
            to_regime = regime_df.iloc[loc]["regime_combo"]
            transition_key = f"{from_regime} -> {to_regime}"

            rows.append({
                "transition": transition_key,
                "from_regime": from_regime,
                "to_regime": to_regime,
                "trades": len(transition_trades),
                "avg_pnl": transition_trades["holly_pnl"].mean(),
                "total_pnl": transition_trades["holly_pnl"].sum(),
                "win_rate": transition_trades["is_winner"].mean(),
            })

        if not rows:
            return pd.DataFrame()

        result = pd.DataFrame(rows)
        # Aggregate by transition type
        summary = result.groupby("transition").agg(
            occurrences=("trades", "count"),
            avg_pnl=("avg_pnl", "mean"),
            avg_win_rate=("win_rate", "mean"),
            total_pnl=("total_pnl", "sum"),
        ).sort_values("avg_pnl", ascending=False)

        # Save transition report
        html = f"""<!DOCTYPE html>
<html><head><title>Regime Transition Analysis</title>
{STYLED_TABLE_CSS}
</head><body>
<h1>Regime Transition Analysis</h1>
<p>Performance of first {window} trades after a regime change.</p>
<h2>Summary by Transition Type</h2>
{summary.to_html(escape=False, float_format=lambda x: f"{x:.2f}")}
<h2>All Transitions (raw)</h2>
{result.to_html(index=False, escape=False, float_format=lambda x: f"{x:.2f}")}
</body></html>"""

        path = REGIMES_DIR / "regime_transitions.html"
        path.write_text(html, encoding="utf-8")
        print(f"  -> {path.name} ({len(summary)} transition types)")

        return summary

    def _generate_comparison_table(
        self,
        rows: list[dict],
        title: str,
    ) -> "Path":
        """Generate styled HTML comparison table sorted by Sharpe."""
        comp_df = pd.DataFrame(rows)

        # Format for display
        display = pd.DataFrame()
        display["Regime"] = comp_df["name"]
        display["Trades"] = comp_df["trades"]
        display["Win Rate"] = comp_df["win_rate"].apply(
            lambda x: _fmt_pct(x) if x is not None else ""
        )
        display["Total PnL"] = comp_df["total_pnl"].apply(
            lambda x: _fmt_dollar(x) if x is not None else ""
        )
        display["Sharpe"] = comp_df["sharpe"].apply(
            lambda x: _fmt_num(x) if x is not None else ""
        )
        display["Sortino"] = comp_df["sortino"].apply(
            lambda x: _fmt_num(x) if x is not None else ""
        )
        display["Max DD"] = comp_df["max_drawdown"].apply(
            lambda x: _fmt_pct(x) if x is not None else ""
        )
        display["CAGR"] = comp_df["cagr"].apply(
            lambda x: _fmt_pct(x) if x is not None else ""
        )
        display["Calmar"] = comp_df["calmar"].apply(
            lambda x: _fmt_num(x) if x is not None else ""
        )
        display["Omega"] = comp_df["omega"].apply(
            lambda x: _fmt_num(x) if x is not None else ""
        )
        display["PF"] = comp_df["profit_factor"].apply(
            lambda x: _fmt_num(x) if x is not None else ""
        )

        # Sort by Sharpe descending
        display = display.sort_values("Sharpe", ascending=False, key=lambda x: pd.to_numeric(x, errors="coerce"))

        safe = title.replace(" ", "_")[:50]
        path = COMPARISON_DIR / f"{safe}.html"

        html = f"""<!DOCTYPE html>
<html><head><title>{title}</title>
{STYLED_TABLE_CSS}
</head><body>
<h1>{title}</h1>
<p>{len(display)} slices, sorted by Sharpe (descending)</p>
{display.to_html(index=False, escape=False, na_rep="")}
</body></html>"""

        path.write_text(html, encoding="utf-8")
        print(f"  -> Comparison table: {path.name}")
        return path
