"""
Numba-compiled exit rule kernels for vectorized backtesting.

Every batch_* function operates on the full 3-D paths array in parallel.

Exit reasons:
    0 = stop hit
    1 = target hit
    2 = time expired
    3 = ambiguous bar (both stop and target could have been hit)
"""

import numpy as np
import numba


# ────────────────────────────────────────────────────────────────
# 1. Fixed trailing stop
# ────────────────────────────────────────────────────────────────

@numba.njit
def _trailing_stop_exit(ohlc, entry, direction, trail_pct, max_bars):
    peak = 0.0
    for i in range(max_bars):
        o, h, l, c = ohlc[i, 0], ohlc[i, 1], ohlc[i, 2], ohlc[i, 3]
        if direction == 1:  # long
            excursion_hi = h - entry
            excursion_lo = l - entry
        else:  # short
            excursion_hi = entry - l
            excursion_lo = entry - h

        if excursion_hi > peak:
            peak = excursion_hi

        trail_dist = entry * trail_pct / 100.0
        drawdown = peak - excursion_lo

        if peak > 0.0 and drawdown >= trail_dist:
            exit_price = entry + peak - trail_dist if direction == 1 else entry - peak + trail_dist
            return i, exit_price, 0
    # time expired — use last close
    last_c = ohlc[max_bars - 1, 3]
    return max_bars - 1, last_c, 2


@numba.njit(parallel=True)
def batch_trailing_stop(paths, entries, directions, trail_pct, max_bars):
    n = paths.shape[0]
    exit_bars = np.empty(n, dtype=np.int64)
    exit_prices = np.empty(n, dtype=np.float64)
    exit_reasons = np.empty(n, dtype=np.int64)
    for i in numba.prange(n):
        actual_bars = min(max_bars, paths.shape[1])
        exit_bars[i], exit_prices[i], exit_reasons[i] = _trailing_stop_exit(
            paths[i], entries[i], directions[i], trail_pct, actual_bars
        )
    return exit_bars, exit_prices, exit_reasons


# ────────────────────────────────────────────────────────────────
# 2. ATR-based trailing stop
# ────────────────────────────────────────────────────────────────

@numba.njit
def _atr_trailing_stop_exit(ohlc, entry, direction, atr_mult, atr_period, max_bars):
    peak = 0.0
    for i in range(max_bars):
        o, h, l, c = ohlc[i, 0], ohlc[i, 1], ohlc[i, 2], ohlc[i, 3]

        # Compute ATR over the lookback window ending at bar i
        atr_sum = 0.0
        atr_count = 0
        for j in range(max(0, i - atr_period + 1), i + 1):
            tr = ohlc[j, 1] - ohlc[j, 2]  # high - low
            if j > 0:
                prev_c = ohlc[j - 1, 3]
                tr = max(tr, abs(ohlc[j, 1] - prev_c), abs(ohlc[j, 2] - prev_c))
            atr_sum += tr
            atr_count += 1
        atr = atr_sum / max(atr_count, 1)
        trail_dist = atr * atr_mult

        if direction == 1:
            excursion = h - entry
            drawdown_from_peak = peak - (l - entry) if peak > 0 else 0.0
        else:
            excursion = entry - l
            drawdown_from_peak = peak - (entry - h) if peak > 0 else 0.0

        if excursion > peak:
            peak = excursion

        if peak > 0.0 and drawdown_from_peak >= trail_dist:
            exit_price = entry + peak - trail_dist if direction == 1 else entry - peak + trail_dist
            return i, exit_price, 0

    last_c = ohlc[max_bars - 1, 3]
    return max_bars - 1, last_c, 2


@numba.njit(parallel=True)
def batch_atr_trailing_stop(paths, entries, directions, atr_mult, atr_period, max_bars):
    n = paths.shape[0]
    exit_bars = np.empty(n, dtype=np.int64)
    exit_prices = np.empty(n, dtype=np.float64)
    exit_reasons = np.empty(n, dtype=np.int64)
    for i in numba.prange(n):
        actual_bars = min(max_bars, paths.shape[1])
        exit_bars[i], exit_prices[i], exit_reasons[i] = _atr_trailing_stop_exit(
            paths[i], entries[i], directions[i], atr_mult, atr_period, actual_bars
        )
    return exit_bars, exit_prices, exit_reasons


# ────────────────────────────────────────────────────────────────
# 3. Time-decay trailing stop
# ────────────────────────────────────────────────────────────────

@numba.njit
def _time_decay_stop_exit(ohlc, entry, direction, initial_trail, decay_rate, max_bars):
    peak = 0.0
    floor_pct = 0.5
    for i in range(max_bars):
        o, h, l, c = ohlc[i, 0], ohlc[i, 1], ohlc[i, 2], ohlc[i, 3]
        current_trail_pct = max(initial_trail - decay_rate * i, floor_pct)
        trail_dist = entry * current_trail_pct / 100.0

        if direction == 1:
            excursion = h - entry
            low_excursion = l - entry
        else:
            excursion = entry - l
            low_excursion = entry - h

        if excursion > peak:
            peak = excursion

        if peak > 0.0:
            drawdown = peak - low_excursion
            if drawdown >= trail_dist:
                exit_price = entry + peak - trail_dist if direction == 1 else entry - peak + trail_dist
                return i, exit_price, 0

    last_c = ohlc[max_bars - 1, 3]
    return max_bars - 1, last_c, 2


@numba.njit(parallel=True)
def batch_time_decay_stop(paths, entries, directions, initial_trail, decay_rate, max_bars):
    n = paths.shape[0]
    exit_bars = np.empty(n, dtype=np.int64)
    exit_prices = np.empty(n, dtype=np.float64)
    exit_reasons = np.empty(n, dtype=np.int64)
    for i in numba.prange(n):
        actual_bars = min(max_bars, paths.shape[1])
        exit_bars[i], exit_prices[i], exit_reasons[i] = _time_decay_stop_exit(
            paths[i], entries[i], directions[i], initial_trail, decay_rate, actual_bars
        )
    return exit_bars, exit_prices, exit_reasons


# ────────────────────────────────────────────────────────────────
# 4. Fixed take-profit
# ────────────────────────────────────────────────────────────────

@numba.njit
def _take_profit_exit(ohlc, entry, direction, tp_pct, max_bars):
    tp_dist = entry * tp_pct / 100.0
    for i in range(max_bars):
        h, l = ohlc[i, 1], ohlc[i, 2]
        if direction == 1:
            if h - entry >= tp_dist:
                return i, entry + tp_dist, 1
        else:
            if entry - l >= tp_dist:
                return i, entry - tp_dist, 1
    last_c = ohlc[max_bars - 1, 3]
    return max_bars - 1, last_c, 2


@numba.njit(parallel=True)
def batch_take_profit(paths, entries, directions, tp_pct, max_bars):
    n = paths.shape[0]
    exit_bars = np.empty(n, dtype=np.int64)
    exit_prices = np.empty(n, dtype=np.float64)
    exit_reasons = np.empty(n, dtype=np.int64)
    for i in numba.prange(n):
        actual_bars = min(max_bars, paths.shape[1])
        exit_bars[i], exit_prices[i], exit_reasons[i] = _take_profit_exit(
            paths[i], entries[i], directions[i], tp_pct, actual_bars
        )
    return exit_bars, exit_prices, exit_reasons


# ────────────────────────────────────────────────────────────────
# 5. Time-based exit
# ────────────────────────────────────────────────────────────────

@numba.njit(parallel=True)
def batch_time_exit(paths, entries, directions, max_hold_mins, max_bars):
    n = paths.shape[0]
    exit_bars = np.empty(n, dtype=np.int64)
    exit_prices = np.empty(n, dtype=np.float64)
    exit_reasons = np.empty(n, dtype=np.int64)
    for i in numba.prange(n):
        bar = min(int(max_hold_mins) - 1, max_bars - 1, paths.shape[1] - 1)
        exit_bars[i] = bar
        exit_prices[i] = paths[i, bar, 3]  # close
        exit_reasons[i] = 2
    return exit_bars, exit_prices, exit_reasons


# ────────────────────────────────────────────────────────────────
# 6. Partial profit-take + trailing stop on remainder
# ────────────────────────────────────────────────────────────────

@numba.njit
def _partial_trail_exit(ohlc, entry, direction, partial_tp_pct, partial_size, trail_after_pct, max_bars):
    """
    Returns (exit_bar, blended_pnl_per_share, exit_reason).
    blended_pnl_per_share accounts for partial fill at tp and remainder at trail.
    """
    tp_dist = entry * partial_tp_pct / 100.0
    partial_filled = False
    partial_pnl = 0.0
    remainder = 1.0 - partial_size
    peak_after = 0.0

    for i in range(max_bars):
        h, l, c = ohlc[i, 1], ohlc[i, 2], ohlc[i, 3]

        if not partial_filled:
            if direction == 1:
                if h - entry >= tp_dist:
                    partial_filled = True
                    partial_pnl = tp_dist * partial_size
                    peak_after = h - entry
            else:
                if entry - l >= tp_dist:
                    partial_filled = True
                    partial_pnl = tp_dist * partial_size
                    peak_after = entry - l
        else:
            # Trail the remainder
            trail_dist = entry * trail_after_pct / 100.0
            if direction == 1:
                excursion = h - entry
                low_exc = l - entry
            else:
                excursion = entry - l
                low_exc = entry - h

            if excursion > peak_after:
                peak_after = excursion

            drawdown = peak_after - low_exc
            if drawdown >= trail_dist:
                remainder_pnl = (peak_after - trail_dist) * remainder
                blended = partial_pnl + remainder_pnl
                exit_price = entry + blended if direction == 1 else entry - blended
                return i, exit_price, 0

    # Time expired
    last_c = ohlc[max_bars - 1, 3]
    if partial_filled:
        if direction == 1:
            remainder_pnl = (last_c - entry) * remainder
        else:
            remainder_pnl = (entry - last_c) * remainder
        blended = partial_pnl + remainder_pnl
        exit_price = entry + blended if direction == 1 else entry - blended
    else:
        exit_price = last_c
    return max_bars - 1, exit_price, 2


@numba.njit(parallel=True)
def batch_partial_trail(paths, entries, directions, partial_tp_pct, partial_size, trail_after_pct, max_bars):
    n = paths.shape[0]
    exit_bars = np.empty(n, dtype=np.int64)
    exit_prices = np.empty(n, dtype=np.float64)
    exit_reasons = np.empty(n, dtype=np.int64)
    for i in numba.prange(n):
        actual_bars = min(max_bars, paths.shape[1])
        exit_bars[i], exit_prices[i], exit_reasons[i] = _partial_trail_exit(
            paths[i], entries[i], directions[i],
            partial_tp_pct, partial_size, trail_after_pct, actual_bars
        )
    return exit_bars, exit_prices, exit_reasons


# ────────────────────────────────────────────────────────────────
# 7. Breakeven stop + trailing stop
# ────────────────────────────────────────────────────────────────

@numba.njit
def _breakeven_trail_exit(ohlc, entry, direction, trigger_pct, trail_after_pct, max_bars):
    trigger_dist = entry * trigger_pct / 100.0
    trail_dist = entry * trail_after_pct / 100.0
    triggered = False
    peak = 0.0

    for i in range(max_bars):
        h, l, c = ohlc[i, 1], ohlc[i, 2], ohlc[i, 3]

        if direction == 1:
            excursion = h - entry
            low_exc = l - entry
        else:
            excursion = entry - l
            low_exc = entry - h

        if not triggered:
            if excursion >= trigger_dist:
                triggered = True
                peak = excursion
            # Before trigger: check if stopped out at original stop (no stop defined here, just let it run)
        else:
            if excursion > peak:
                peak = excursion

            # Stop at breakeven or trail, whichever is higher
            stop_level = max(0.0, peak - trail_dist)  # 0.0 = breakeven

            if low_exc <= stop_level:
                exit_price = entry + stop_level if direction == 1 else entry - stop_level
                return i, exit_price, 0

    last_c = ohlc[max_bars - 1, 3]
    return max_bars - 1, last_c, 2


@numba.njit(parallel=True)
def batch_breakeven_trail(paths, entries, directions, trigger_pct, trail_after_pct, max_bars):
    n = paths.shape[0]
    exit_bars = np.empty(n, dtype=np.int64)
    exit_prices = np.empty(n, dtype=np.float64)
    exit_reasons = np.empty(n, dtype=np.int64)
    for i in numba.prange(n):
        actual_bars = min(max_bars, paths.shape[1])
        exit_bars[i], exit_prices[i], exit_reasons[i] = _breakeven_trail_exit(
            paths[i], entries[i], directions[i], trigger_pct, trail_after_pct, actual_bars
        )
    return exit_bars, exit_prices, exit_reasons


# ────────────────────────────────────────────────────────────────
# 8. Volume climax exit
# ────────────────────────────────────────────────────────────────

@numba.njit
def _volume_climax_exit(ohlcv, entry, direction, vol_mult, lookback, max_bars):
    for i in range(max_bars):
        c = ohlcv[i, 3]
        vol = ohlcv[i, 4]

        # Only exit in profitable territory
        if direction == 1:
            profitable = c > entry
        else:
            profitable = c < entry

        if profitable and i >= lookback:
            avg_vol = 0.0
            for j in range(i - lookback, i):
                avg_vol += ohlcv[j, 4]
            avg_vol /= lookback

            if avg_vol > 0 and vol >= avg_vol * vol_mult:
                return i, c, 1

    last_c = ohlcv[max_bars - 1, 3]
    return max_bars - 1, last_c, 2


@numba.njit(parallel=True)
def batch_volume_climax(paths, entries, directions, vol_mult, lookback, max_bars):
    n = paths.shape[0]
    exit_bars = np.empty(n, dtype=np.int64)
    exit_prices = np.empty(n, dtype=np.float64)
    exit_reasons = np.empty(n, dtype=np.int64)
    for i in numba.prange(n):
        actual_bars = min(max_bars, paths.shape[1])
        exit_bars[i], exit_prices[i], exit_reasons[i] = _volume_climax_exit(
            paths[i], entries[i], directions[i], vol_mult, int(lookback), actual_bars
        )
    return exit_bars, exit_prices, exit_reasons


# ────────────────────────────────────────────────────────────────
# 9. Holly baseline (control group)
# ────────────────────────────────────────────────────────────────

@numba.njit(parallel=True)
def batch_holly_baseline(paths, entries, directions, holly_exit_bars, max_bars):
    """Use Holly's actual exit bar. holly_exit_bars comes from trade_meta."""
    n = paths.shape[0]
    exit_bars = np.empty(n, dtype=np.int64)
    exit_prices = np.empty(n, dtype=np.float64)
    exit_reasons = np.empty(n, dtype=np.int64)
    for i in numba.prange(n):
        bar = min(int(holly_exit_bars[i]), max_bars - 1, paths.shape[1] - 1)
        exit_bars[i] = bar
        exit_prices[i] = paths[i, bar, 3]
        exit_reasons[i] = 2  # "time expired" — Holly chose to exit
    return exit_bars, exit_prices, exit_reasons
