import numpy as np

EXIT_RULES = {
    "fixed_trail": {
        "function": "batch_trailing_stop",
        "params": {
            "trail_pct": np.arange(0.5, 5.25, 0.25),
        },
    },
    "atr_trail": {
        "function": "batch_atr_trailing_stop",
        "params": {
            "atr_multiplier": np.arange(1.0, 4.5, 0.5),
            "atr_period": np.array([5, 10, 15, 20]),
        },
    },
    "time_decay_trail": {
        "function": "batch_time_decay_stop",
        "params": {
            "initial_trail_pct": np.arange(3.0, 5.25, 0.5),
            "decay_rate": np.arange(0.02, 0.12, 0.02),
        },
    },
    "fixed_tp": {
        "function": "batch_take_profit",
        "params": {
            "tp_pct": np.arange(0.5, 5.25, 0.25),
        },
    },
    "time_exit": {
        "function": "batch_time_exit",
        "params": {
            "max_hold_minutes": np.array([15, 30, 45, 60, 90, 120, 180]),
        },
    },
    "partial_plus_trail": {
        "function": "batch_partial_trail",
        "params": {
            "partial_tp_pct": np.arange(1.0, 3.25, 0.25),
            "partial_size": np.array([0.5]),
            "trail_pct_after": np.arange(1.0, 3.25, 0.25),
        },
    },
    "breakeven_plus_trail": {
        "function": "batch_breakeven_trail",
        "params": {
            "trigger_pct": np.arange(0.5, 2.25, 0.25),
            "trail_pct_after": np.arange(1.0, 3.25, 0.25),
        },
    },
    "volume_climax": {
        "function": "batch_volume_climax",
        "params": {
            "volume_multiplier": np.arange(2.0, 5.5, 0.5),
            "lookback_bars": np.array([5, 10, 20]),
        },
    },
    "holly_baseline": {
        "function": "batch_holly_baseline",
        "params": {},
    },
}
