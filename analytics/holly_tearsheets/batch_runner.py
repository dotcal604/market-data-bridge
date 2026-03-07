"""CLI entry point to generate all tearsheets at once.

Usage:
    python -m holly_tearsheets.batch_runner
    python -m holly_tearsheets.batch_runner --method trade_weighted --top 20
    python -m holly_tearsheets.batch_runner --skip-regimes --skip-benchmark
"""

import argparse
import sys
import time
from pathlib import Path

import pandas as pd

from .config import OUTPUT_DIR, ensure_dirs
from .data_loader import load_holly_data
from .returns_engine import get_returns, get_benchmark_returns, align_returns
from .tearsheet_factory import TearsheetFactory
from .regime_analyzer import RegimeAnalyzer
from .strategy_ranker import StrategyRanker


def run_all(
    method: str = "dollar_pnl",
    top_strategies: int = 30,
    benchmark_ticker: str = "SPY",
    skip_regimes: bool = False,
    skip_strategies: bool = False,
    skip_directions: bool = False,
    skip_yearly: bool = False,
    skip_benchmark: bool = False,
    csv_path: str = None,
) -> dict:
    """
    Master pipeline: generates all tearsheets.

    Slices:
      1. Portfolio-level (all trades)
      2. Per-direction (Long, Short)
      3. Per-year (2016-2026)
      4. Per-strategy (top N)
      5. Per-regime combination
      6. Per-individual regime dimension
      7. Regime transitions

    Returns dict with all results.
    """
    start_time = time.time()
    ensure_dirs()
    all_results = {}

    # ── Load data ─────────────────────────────────────────────────
    df = load_holly_data(path=Path(csv_path) if csv_path else None)

    # ── Initialize factory ────────────────────────────────────────
    factory = TearsheetFactory()

    # ── Fetch benchmark ───────────────────────────────────────────
    benchmark = None
    if not skip_benchmark:
        portfolio_returns = get_returns(df, method=method)
        benchmark = get_benchmark_returns(
            ticker=benchmark_ticker,
            returns_series=portfolio_returns,
        )

    # ══════════════════════════════════════════════════════════════
    # 1. PORTFOLIO-LEVEL TEARSHEET
    # ══════════════════════════════════════════════════════════════
    print(f"\n{'='*60}")
    print("1. Portfolio-Level Tearsheet")
    print(f"{'='*60}")

    portfolio_returns = get_returns(df, method=method)
    aligned_returns, aligned_bench = align_returns(portfolio_returns, benchmark)

    result = factory.generate_full_tearsheet(
        returns=aligned_returns,
        benchmark=aligned_bench,
        title="Holly AI Portfolio — All Strategies",
        output_path=str(OUTPUT_DIR / "portfolio_tearsheet.html"),
        trade_df=df,
        include_plots=True,
    )
    all_results["portfolio"] = result

    # ══════════════════════════════════════════════════════════════
    # 2. PER-DIRECTION TEARSHEETS
    # ══════════════════════════════════════════════════════════════
    if not skip_directions:
        print(f"\n{'='*60}")
        print("2. Direction Tearsheets")
        print(f"{'='*60}")

        for direction in ["Long", "Short"]:
            dir_df = df[df["direction"] == direction]
            if len(dir_df) < 50:
                print(f"  SKIP {direction}: only {len(dir_df)} trades")
                continue

            returns = get_returns(dir_df, method=method)
            r_aligned, b_aligned = align_returns(returns, benchmark)

            from .config import DIRECTIONS_DIR
            result = factory.generate_full_tearsheet(
                returns=r_aligned,
                benchmark=b_aligned,
                title=f"Holly AI — {direction} Only ({len(dir_df):,} trades)",
                output_path=str(DIRECTIONS_DIR / f"direction_{direction.lower()}.html"),
                trade_df=dir_df,
                include_plots=True,
            )
            all_results[f"direction_{direction.lower()}"] = result

    # ══════════════════════════════════════════════════════════════
    # 3. PER-YEAR TEARSHEETS
    # ══════════════════════════════════════════════════════════════
    if not skip_yearly:
        print(f"\n{'='*60}")
        print("3. Yearly Tearsheets")
        print(f"{'='*60}")

        from .config import YEARLY_DIR
        for year in sorted(df["trade_year"].dropna().unique()):
            year_df = df[df["trade_year"] == year]
            if len(year_df) < 50:
                print(f"  SKIP {year}: only {len(year_df)} trades")
                continue

            returns = get_returns(year_df, method=method)
            result = factory.generate_full_tearsheet(
                returns=returns,
                title=f"Holly AI — {int(year)} ({len(year_df):,} trades)",
                output_path=str(YEARLY_DIR / f"year_{int(year)}.html"),
                trade_df=year_df,
                include_plots=False,
            )
            all_results[f"year_{int(year)}"] = result

    # ══════════════════════════════════════════════════════════════
    # 4. PER-STRATEGY TEARSHEETS + RANKING
    # ══════════════════════════════════════════════════════════════
    if not skip_strategies:
        ranker = StrategyRanker(factory=factory)
        strat_results = ranker.generate_strategy_tearsheets(
            df,
            returns_method=method,
            top_n=top_strategies,
        )
        all_results["strategies"] = strat_results

    # ══════════════════════════════════════════════════════════════
    # 5. REGIME TEARSHEETS
    # ══════════════════════════════════════════════════════════════
    if not skip_regimes:
        analyzer = RegimeAnalyzer(factory=factory)
        regime_results = analyzer.generate_regime_tearsheets(
            df,
            returns_method=method,
        )
        all_results["regimes"] = regime_results

    # ══════════════════════════════════════════════════════════════
    # SUMMARY
    # ══════════════════════════════════════════════════════════════
    elapsed = time.time() - start_time
    _print_summary(all_results, elapsed)

    return all_results


def _print_summary(results: dict, elapsed: float):
    """Print generation summary."""
    print(f"\n{'='*60}")
    print("GENERATION COMPLETE")
    print(f"{'='*60}")

    # Count generated files
    total_html = 0
    total_plots = 0
    for key, val in results.items():
        if isinstance(val, dict):
            if "paths" in val:
                if "html_tearsheet" in val["paths"]:
                    total_html += 1
                plots = val.get("paths", {}).get("plots", {})
                total_plots += len(plots)
            # Recurse into nested dicts (strategies, regimes)
            for k2, v2 in val.items():
                if isinstance(v2, dict) and "paths" in v2:
                    if "html_tearsheet" in v2["paths"]:
                        total_html += 1

    print(f"  HTML tearsheets: {total_html}")
    print(f"  Individual plots: {total_plots}")
    print(f"  Time: {elapsed:.1f}s")
    print(f"  Output: {OUTPUT_DIR}")


def main():
    """CLI entry point."""
    parser = argparse.ArgumentParser(
        description="Generate institutional-grade Holly AI tearsheets"
    )
    parser.add_argument(
        "--method", choices=["dollar_pnl", "trade_weighted", "per_trade"],
        default="dollar_pnl",
        help="Return conversion method (default: dollar_pnl)",
    )
    parser.add_argument("--top", type=int, default=30, help="Top N strategies")
    parser.add_argument("--benchmark", type=str, default="SPY", help="Benchmark ticker")
    parser.add_argument("--csv", type=str, default=None, help="Override CSV path")
    parser.add_argument("--skip-regimes", action="store_true")
    parser.add_argument("--skip-strategies", action="store_true")
    parser.add_argument("--skip-directions", action="store_true")
    parser.add_argument("--skip-yearly", action="store_true")
    parser.add_argument("--skip-benchmark", action="store_true")

    args = parser.parse_args()

    run_all(
        method=args.method,
        top_strategies=args.top,
        benchmark_ticker=args.benchmark,
        skip_regimes=args.skip_regimes,
        skip_strategies=args.skip_strategies,
        skip_directions=args.skip_directions,
        skip_yearly=args.skip_yearly,
        skip_benchmark=args.skip_benchmark,
        csv_path=args.csv,
    )


if __name__ == "__main__":
    main()
