"""Build minute-by-minute price paths per trade for vectorized exit simulation."""

import numpy as np
import pandas as pd
import duckdb

from config.settings import MAX_HOLD_MINUTES, OUTPUT_DIR

# Split-adjustment detection threshold.
# Trades with bar_close/entry_price outside [1/MAX_PRICE_RATIO, MAX_PRICE_RATIO]
# have a split mismatch (Polygon returns split-adjusted bars, Holly records unadjusted).
MAX_PRICE_RATIO = 2.0

# Maximum ratio we'll attempt to salvage via rescaling. Beyond this the bar data
# resolution is too degraded (penny stocks with extreme reverse splits).
MAX_SALVAGE_RATIO = 50.0


def build_all_paths(
    db: duckdb.DuckDBPyConnection,
    max_hold_minutes: int = MAX_HOLD_MINUTES,
) -> tuple[np.ndarray, pd.DataFrame]:
    """
    Build padded OHLCV price-path arrays for every trade.

    Returns
    -------
    paths : np.ndarray, shape (n_trades, max_hold_minutes, 5)
        Columns: open, high, low, close, volume
    trade_meta : pd.DataFrame
        One row per trade with trade_id, symbol, strategy, direction,
        entry_price (real if available), entry_time, holly_pnl,
        holly_exit_bar (bar index where Holly actually exited).
    """

    trades = db.execute("""
        SELECT
            trade_id, symbol, strategy, direction,
            entry_time, entry_price, exit_time, exit_price,
            real_entry_price, real_entry_time,
            holly_pnl, shares
        FROM trades
        ORDER BY entry_time
    """).fetchdf()

    n_trades = len(trades)
    paths = np.zeros((n_trades, max_hold_minutes, 5), dtype=np.float64)
    valid_mask = np.ones(n_trades, dtype=bool)
    holly_exit_bars = np.full(n_trades, max_hold_minutes - 1, dtype=np.int64)

    # Group trades by (symbol, date) to batch-load bars
    trades["trade_date"] = pd.to_datetime(trades["entry_time"]).dt.date
    groups = trades.groupby(["symbol", "trade_date"])

    for (symbol, trade_date), group_df in groups:
        date_str = str(trade_date)
        bars = db.execute(
            """
            SELECT bar_time, open, high, low, close, volume
            FROM bars
            WHERE symbol = ? AND CAST(bar_time AS DATE) = CAST(? AS DATE)
            ORDER BY bar_time
            """,
            [symbol, date_str],
        ).fetchdf()

        if bars.empty:
            for idx in group_df.index:
                valid_mask[idx] = False
            continue

        bars["bar_time"] = pd.to_datetime(bars["bar_time"])
        bar_times = bars["bar_time"].values
        bar_ohlcv = bars[["open", "high", "low", "close", "volume"]].values

        for row_pos, (idx, trade) in enumerate(group_df.iterrows()):
            entry_t = pd.Timestamp(trade["entry_time"])

            # Find the first bar at or after entry time
            start_idx = np.searchsorted(bar_times, np.datetime64(entry_t))
            if start_idx >= len(bar_times):
                valid_mask[idx] = False
                continue

            available = bar_ohlcv[start_idx:]
            n_bars = min(len(available), max_hold_minutes)

            if n_bars < 10:
                valid_mask[idx] = False
                continue

            paths[idx, :n_bars, :] = available[:n_bars]

            # Pad remaining bars with last close (flat line)
            if n_bars < max_hold_minutes:
                last_close = available[n_bars - 1, 3]  # close column
                paths[idx, n_bars:, 0] = last_close  # open
                paths[idx, n_bars:, 1] = last_close  # high
                paths[idx, n_bars:, 2] = last_close  # low
                paths[idx, n_bars:, 3] = last_close  # close
                paths[idx, n_bars:, 4] = 0            # volume

            # Compute Holly's exit bar index
            if pd.notna(trade["exit_time"]):
                exit_t = pd.Timestamp(trade["exit_time"])
                exit_idx = np.searchsorted(bar_times, np.datetime64(exit_t))
                holly_bar = exit_idx - start_idx
                holly_exit_bars[idx] = max(0, min(holly_bar, max_hold_minutes - 1))

    # ── Dump missing bars audit CSV ──────────────────────────────────
    invalid_indices = np.where(~valid_mask)[0]
    if len(invalid_indices) > 0:
        missing_df = trades.iloc[invalid_indices][
            ["trade_id", "symbol", "strategy", "direction", "entry_time"]
        ].copy()
        missing_df["trade_date"] = missing_df["entry_time"].apply(
            lambda t: str(pd.Timestamp(t).date())
        )
        # Classify why bars are missing
        min_bar_date = db.execute(
            "SELECT MIN(CAST(bar_time AS DATE)) FROM bars"
        ).fetchone()[0]
        missing_df["reason"] = missing_df["trade_date"].apply(
            lambda d: "OUTSIDE_5YR_WINDOW" if str(d) < str(min_bar_date)
            else "NO_BARS_FETCHED"
        )
        missing_path = OUTPUT_DIR / "missing_bars_audit.csv"
        missing_path.parent.mkdir(parents=True, exist_ok=True)
        missing_df.to_csv(missing_path, index=False)
        print(f"  [price_paths] Missing bars audit: {len(missing_df)} trades -> {missing_path}")

    # Filter to valid trades
    valid_indices = np.where(valid_mask)[0]
    paths = paths[valid_indices]

    meta = trades.iloc[valid_indices].copy()
    # Use real entry price if available, else Holly's
    meta["eff_entry_price"] = meta["real_entry_price"].fillna(meta["entry_price"])

    # ── Split-adjustment salvage ─────────────────────────────────────
    # Polygon returns split-adjusted historical prices, but Holly's CSV
    # records unadjusted prices at trade time. Stocks that underwent
    # splits/reverse-splits between trade date and data fetch will show
    # a mismatch between entry_price and bar data.
    #
    # Instead of discarding these trades, we rescale entry_price (and
    # holly_pnl) into the bar data's adjusted reference frame. The exit
    # simulation only needs entry + bars in the same price space — the
    # optimizer measures relative P&L (R-multiples, Sharpe, PF), so
    # adjusted-space results are mathematically equivalent.
    #
    # Trades beyond MAX_SALVAGE_RATIO are excluded — extreme reverse
    # splits (penny stocks → $20) create bar-resolution artifacts that
    # degrade simulation quality.

    first_bar_close = paths[:, 0, 3]
    entry_prices = meta["eff_entry_price"].values
    price_ratio = np.where(
        entry_prices > 0,
        first_bar_close / entry_prices,
        1.0,  # avoid div-by-zero
    )

    # Classify each trade
    is_clean = (price_ratio >= (1.0 / MAX_PRICE_RATIO)) & (price_ratio <= MAX_PRICE_RATIO)
    abs_ratio = np.maximum(price_ratio, 1.0 / np.where(price_ratio > 0, price_ratio, 1.0))
    is_salvageable = ~is_clean & (abs_ratio <= MAX_SALVAGE_RATIO)
    is_extreme = ~is_clean & (abs_ratio > MAX_SALVAGE_RATIO)

    salvage_count = int(np.sum(is_salvageable))
    extreme_count = int(np.sum(is_extreme))

    # Rescale entry prices for salvageable trades into bar-adjusted space
    meta["split_factor"] = price_ratio
    meta["split_salvaged"] = False
    if salvage_count > 0:
        salvage_idx = np.where(is_salvageable)[0]
        factors = price_ratio[salvage_idx]
        meta.iloc[salvage_idx, meta.columns.get_loc("eff_entry_price")] = (
            meta.iloc[salvage_idx]["eff_entry_price"].values * factors
        )
        # Scale holly_pnl to adjusted space so baseline comparison stays valid
        meta.iloc[salvage_idx, meta.columns.get_loc("holly_pnl")] = (
            meta.iloc[salvage_idx]["holly_pnl"].values * factors
        )
        meta.iloc[salvage_idx, meta.columns.get_loc("split_salvaged")] = True
        print(f"  [price_paths] Salvaged {salvage_count} split-adjusted trades "
              f"(rescaled entry to bar-adjusted space)")

    # ── Dump split mismatch audit CSV ───────────────────────────────
    def _ratio_bucket(r: float) -> str:
        if r > 10:   return ">10x"
        if r > 4:    return "4-10x"
        if r > 2:    return "2-4x"
        if r >= 0.5: return "0.5-2x"
        return "<0.5x"

    mismatch_mask = ~is_clean
    if np.any(mismatch_mask):
        mismatch_df = meta.iloc[np.where(mismatch_mask)[0]][
            ["trade_id", "symbol", "strategy", "direction", "entry_time",
             "entry_price", "eff_entry_price", "split_factor", "split_salvaged"]
        ].copy()
        mismatch_df["first_bar_close"] = first_bar_close[mismatch_mask]
        mismatch_df["abs_ratio"] = abs_ratio[mismatch_mask]
        mismatch_df["ratio_bucket"] = [_ratio_bucket(r) for r in abs_ratio[mismatch_mask]]
        mismatch_df["status"] = np.where(
            is_salvageable[mismatch_mask], "salvaged",
            np.where(is_extreme[mismatch_mask], "excluded_extreme", "other"),
        )
        audit_path = OUTPUT_DIR / "split_mismatch_audit.csv"
        audit_path.parent.mkdir(parents=True, exist_ok=True)
        mismatch_df.to_csv(audit_path, index=False)
        print(f"  [price_paths] Split mismatch audit: {len(mismatch_df)} trades -> {audit_path}")

    # Exclude only the extreme cases
    if extreme_count > 0:
        print(f"  [price_paths] Excluded {extreme_count} trades with extreme split ratio "
              f"(>{MAX_SALVAGE_RATIO}x — penny stock resolution artifacts)")
    keep_mask = ~is_extreme
    paths = paths[keep_mask]
    meta = meta.iloc[np.where(keep_mask)[0]].copy()
    holly_exit_bars_filtered = holly_exit_bars[valid_indices][keep_mask]
    # ────────────────────────────────────────────────────────────────

    # Map direction to int; filter out Unknown (direction_int=0 produces zero P&L
    # in exit simulations, inflating win rates). Trades with Unknown direction
    # should have been resolved during ingestion via stop_price inference.
    meta["direction_int"] = meta["direction"].map({"Long": 1, "Short": -1}).fillna(0).astype(int)
    unknown_count = (meta["direction_int"] == 0).sum()
    if unknown_count > 0:
        print(f"  [price_paths] WARNING: {unknown_count} trades with direction_int=0 "
              f"(Unknown direction). These produce zero P&L in exit simulations.")
    meta["holly_exit_bar"] = holly_exit_bars_filtered
    meta = meta.reset_index(drop=True)

    excluded = n_trades - len(meta)
    salvaged = int(meta["split_salvaged"].sum())
    if excluded > 0:
        print(f"  [price_paths] Excluded {excluded}/{n_trades} trades total "
              f"(no bars + extreme splits)")
    print(f"  [price_paths] Built paths for {len(meta)} trades "
          f"({salvaged} split-salvaged), shape {paths.shape}")

    return paths, meta
