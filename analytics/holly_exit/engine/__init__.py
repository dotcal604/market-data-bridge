"""Holly Exit Optimizer engine — lazy imports to avoid cascading dependencies.

Use direct imports when you only need specific modules:
    from engine.data_loader import get_db, ensure_schema
    from engine.price_paths import build_all_paths
    from engine.optimizer import ExitOptimizer
    from engine.reporter import generate_heatmap, ...

The star-import below is kept for backward compatibility when the full
engine is needed (e.g. script 05), but individual scripts that only
need data_loader won't trigger numba/plotly/scipy compilation.
"""

# Only export data_loader eagerly (lightweight: just duckdb + pandas)
from .data_loader import get_db, ensure_schema, load_trades, load_bars_for_symbol_date, get_trade_summary


def __getattr__(name):
    """Lazy-load heavy modules on first access."""
    if name == "build_all_paths":
        from .price_paths import build_all_paths
        return build_all_paths
    if name == "ExitOptimizer":
        from .optimizer import ExitOptimizer
        return ExitOptimizer
    if name in ("generate_heatmap", "generate_equity_curve", "generate_tearsheet", "generate_summary_report"):
        from . import reporter
        return getattr(reporter, name)

    # Exit rule batch functions
    _exit_rule_names = {
        "batch_trailing_stop", "batch_atr_trailing_stop", "batch_time_decay_stop",
        "batch_take_profit", "batch_time_exit", "batch_partial_trail",
        "batch_breakeven_trail", "batch_volume_climax", "batch_holly_baseline",
    }
    if name in _exit_rule_names:
        from . import exit_rules
        return getattr(exit_rules, name)

    raise AttributeError(f"module 'engine' has no attribute {name!r}")
