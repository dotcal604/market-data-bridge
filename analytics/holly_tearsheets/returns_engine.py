"""Convert trade-level PnL to daily return series for QuantStats/pyfolio.

Three conversion methods:
  1. Dollar PnL as Returns (default) — daily PnL / assumed capital
  2. Trade-Weighted Returns — daily PnL / daily notional exposure
  3. Per-Trade Return Series — each trade as an observation (no daily agg)
"""

import warnings

import numpy as np
import pandas as pd

from .config import DEFAULT_INITIAL_EQUITY

warnings.filterwarnings("ignore", category=FutureWarning)


def dollar_pnl_returns(
    df: pd.DataFrame,
    initial_equity: float = DEFAULT_INITIAL_EQUITY,
    pnl_col: str = "holly_pnl",
    date_col: str = "trade_date",
) -> pd.Series:
    """
    Method 1: Dollar PnL as Returns (default).

    Group trades by trade_date, sum PnL, convert to return series.
    daily_return = daily_pnl / rolling_equity

    Parameters
    ----------
    df : DataFrame with trade-level data
    initial_equity : assumed starting capital
    pnl_col : column containing dollar P&L per trade
    date_col : column with trade date

    Returns
    -------
    pd.Series with DatetimeIndex (business days), named "Strategy"
    """
    if df.empty:
        return pd.Series(dtype=float, name="Strategy")

    daily_pnl = df.groupby(date_col)[pnl_col].sum().sort_index()
    daily_pnl.index = pd.to_datetime(daily_pnl.index)

    # Fill non-trading days with 0
    full_idx = pd.bdate_range(daily_pnl.index.min(), daily_pnl.index.max())
    daily_pnl = daily_pnl.reindex(full_idx, fill_value=0.0)

    # Convert to percentage returns using rolling equity
    equity = initial_equity + daily_pnl.cumsum().shift(1, fill_value=0)
    returns = daily_pnl / equity.clip(lower=1.0)  # avoid div by zero

    returns.name = "Strategy"
    returns.index.name = None
    return returns


def trade_weighted_returns(
    df: pd.DataFrame,
    date_col: str = "trade_date",
    pnl_col: str = "holly_pnl",
    notional_col: str = "notional_exposure",
) -> pd.Series:
    """
    Method 2: Trade-Weighted Returns.

    For each day: sum(pnl) / sum(notional_exposure).
    More accurate return on deployed capital, but volatile on low-trade days.

    Returns
    -------
    pd.Series with DatetimeIndex (business days), named "Strategy"
    """
    if df.empty:
        return pd.Series(dtype=float, name="Strategy")

    # Ensure notional exists
    if notional_col not in df.columns:
        df = df.copy()
        df[notional_col] = df["entry_price"] * df["shares"]

    grouped = df.groupby(date_col).agg(
        total_pnl=(pnl_col, "sum"),
        total_notional=(notional_col, "sum"),
    )
    grouped.index = pd.to_datetime(grouped.index)
    grouped = grouped.sort_index()

    # Daily return = PnL / notional deployed
    returns = grouped["total_pnl"] / grouped["total_notional"].clip(lower=1.0)

    # Fill non-trading days
    full_idx = pd.bdate_range(returns.index.min(), returns.index.max())
    returns = returns.reindex(full_idx, fill_value=0.0)

    returns.name = "Strategy"
    returns.index.name = None
    return returns


def per_trade_returns(
    df: pd.DataFrame,
    pnl_col: str = "holly_pnl",
) -> pd.Series:
    """
    Method 3: Per-Trade Return Series.

    Each trade is one observation. Does NOT aggregate to daily.
    Useful for strategy-level metrics where daily aggregation loses signal.

    Note: pyfolio won't work with this (needs daily), but QuantStats
    stats functions will.

    Returns
    -------
    pd.Series indexed by trade order (int), named "Strategy"
    """
    if df.empty:
        return pd.Series(dtype=float, name="Strategy")

    notional = (df["entry_price"] * df["shares"]).clip(lower=1.0)
    returns = df[pnl_col] / notional
    returns = returns.reset_index(drop=True)
    returns.name = "Strategy"
    return returns


def get_returns(
    df: pd.DataFrame,
    method: str = "dollar_pnl",
    initial_equity: float = DEFAULT_INITIAL_EQUITY,
) -> pd.Series:
    """
    Dispatcher: get return series using specified method.

    Parameters
    ----------
    df : DataFrame with Holly trade data
    method : one of "dollar_pnl", "trade_weighted", "per_trade"
    initial_equity : used by dollar_pnl method

    Returns
    -------
    pd.Series of returns
    """
    methods = {
        "dollar_pnl": lambda: dollar_pnl_returns(df, initial_equity=initial_equity),
        "trade_weighted": lambda: trade_weighted_returns(df),
        "per_trade": lambda: per_trade_returns(df),
    }

    if method not in methods:
        raise ValueError(f"Unknown method '{method}'. Use one of: {list(methods.keys())}")

    return methods[method]()


def get_benchmark_returns(
    ticker: str = "SPY",
    start: str = None,
    end: str = None,
    returns_series: pd.Series = None,
) -> pd.Series:
    """
    Pull benchmark returns using yfinance for the same period as the strategy.

    Parameters
    ----------
    ticker : benchmark symbol (default SPY)
    start, end : date strings (YYYY-MM-DD). If None, inferred from returns_series.
    returns_series : strategy returns to match date range

    Returns
    -------
    pd.Series with DatetimeIndex, named with ticker
    """
    try:
        import yfinance as yf
    except ImportError:
        print("  WARNING: yfinance not installed. Skipping benchmark.")
        return None

    if returns_series is not None and hasattr(returns_series.index, "min"):
        start = start or str(returns_series.index.min().date())
        end = end or str(returns_series.index.max().date())

    if not start or not end:
        raise ValueError("Provide start/end dates or a returns_series to match.")

    print(f"  Fetching {ticker} benchmark ({start} to {end})...")
    try:
        data = yf.download(ticker, start=start, end=end, progress=False, auto_adjust=True)
        if data.empty:
            print(f"  WARNING: No data returned for {ticker}")
            return None

        # Handle multi-level columns from yfinance
        close = data["Close"]
        if isinstance(close, pd.DataFrame):
            close = close.iloc[:, 0]

        benchmark = close.pct_change().dropna()
        benchmark.name = ticker
        benchmark.index = benchmark.index.tz_localize(None)
        return benchmark
    except Exception as e:
        print(f"  WARNING: Failed to fetch {ticker}: {e}")
        return None


def align_returns(
    strategy: pd.Series,
    benchmark: pd.Series,
) -> tuple[pd.Series, pd.Series]:
    """Align strategy and benchmark returns to common date range."""
    if benchmark is None:
        return strategy, None

    common = strategy.index.intersection(benchmark.index)
    if len(common) < 30:
        print(f"  WARNING: Only {len(common)} overlapping dates. Skipping benchmark.")
        return strategy, None

    return strategy.loc[common], benchmark.loc[common]
