"""
Script 100 -- Adversarial Test: Shrunk Strategy-Sector Prior Overlay
=====================================================================
Tries to BREAK the SSP overlay from script 99.

Tests:
  1. Permutation test — shuffle overlay, measure if spread gain is noise
  2. Walk-forward expanding window — no static split, true sequential
  3. Worst-regime stress — test only in regimes where things should fail
  4. Parameter sensitivity sweep — min_cell, cap, neutral_band
  5. Recency-weighted vs full-history accumulators
  6. Bootstrap CIs on the spread improvement
  7. Newest-data-only test — 2024-2026 only (the weak spot)

Verdict: PASS/FAIL for each test, with honest numbers.

Usage:
    python scripts/100_adversarial_ssp_test.py
"""

import sys
import time
import warnings
from pathlib import Path

import duckdb
import numpy as np
import pandas as pd
from scipy import stats

sys.path.insert(0, str(Path(__file__).parent.parent))
from config.settings import DUCKDB_PATH

warnings.filterwarnings("ignore")

np.random.seed(42)


# ─── Core functions (from script 99, condensed) ────────────────────────────

def compute_aqs_v2(row):
    score = 50.0
    d = row.get("direction", "").lower()
    is_long, is_short = d == "long", d == "short"
    ep, sp = row.get("entry_price"), row.get("stop_price")
    mc, vr = row.get("market_cap"), str(row.get("vol_regime", "")).lower()
    ex = str(row.get("primary_exchange", "")).upper()

    if is_long and mc is not None and mc < 3e8:
        return 0.0
    if "OTC" in ex:
        return 0.0

    if vr:
        if is_long:
            score += 10 if vr in ("normal_vol", "low_vol") else (-10 if vr == "high_vol" else 0)
        elif is_short:
            score += 7 if vr == "high_vol" else (-15 if vr == "normal_vol" else 0)

    if is_short and mc is not None and mc >= 3e8:
        score -= 3
    if ep and sp and ep > 0:
        risk = abs(ep - sp) / ep * 100
        if is_long:
            score += 5 if risk < 0.85 else (-5 if risk > 4.10 else 0)
        elif is_short:
            score += 5 if risk > 4.75 else (-5 if risk < 1.00 else 0)
    if is_long and ep:
        score += 5 if 50 <= ep <= 100 else (-5 if 5 <= ep <= 20 else 0)
    if is_short and mc is not None and mc < 3e8:
        score += 20

    swr = row.get("strategy_recent_wr")
    if swr is not None and not np.isnan(swr):
        score += 10 if swr > 60 else (-15 if swr < 35 else 0)
    nc = row.get("news_count_24h")
    if nc is not None and not np.isnan(nc):
        score += 10 if nc > 10 else (5 if nc > 5 else 0)

    return max(0, min(100, score))


def build_shrunk_priors(df, min_cell=5, min_strat=10, decay=None):
    """
    Build shrunk priors. If decay is set, uses exponential recency weighting.
    decay=None → full history. decay=0.995 → ~200 trade half-life.
    """
    df = df.sort_values("entry_time").reset_index(drop=True)
    n = len(df)

    gw, gc = 0.0, 0.0
    sw, sc = {}, {}
    cw, cc = {}, {}

    raw_wr = np.full(n, np.nan)
    shrunk_wr = np.full(n, np.nan)
    cell_n = np.full(n, np.nan)

    for i in range(n):
        strat = df.loc[i, "strategy"]
        sic2 = df.loc[i, "sic2"]
        win = float(df.loc[i, "win"])
        cell_key = f"{strat}_{sic2}" if pd.notna(sic2) else None

        gp = gw / gc * 100 if gc >= 20 else np.nan
        sp = sw.get(strat, 0) / sc.get(strat, 0) * 100 \
            if sc.get(strat, 0) >= min_strat else np.nan

        if cell_key and cc.get(cell_key, 0) >= min_cell:
            cn = cc[cell_key]
            cwr = cw[cell_key] / cn * 100
            raw_wr[i] = cwr
            cell_n[i] = cn
            alpha = min_cell / (min_cell + cn)
            target = sp if not np.isnan(sp) else (gp if not np.isnan(gp) else 50.0)
            shrunk_wr[i] = (1 - alpha) * cwr + alpha * target
        elif not np.isnan(sp):
            shrunk_wr[i] = sp
            cell_n[i] = 0

        # Update with optional decay
        if decay:
            gc = gc * decay + 1
            gw = gw * decay + win
            sc[strat] = sc.get(strat, 0) * decay + 1
            sw[strat] = sw.get(strat, 0) * decay + win
            if cell_key:
                cc[cell_key] = cc.get(cell_key, 0) * decay + 1
                cw[cell_key] = cw.get(cell_key, 0) * decay + win
        else:
            gc += 1; gw += win
            sc[strat] = sc.get(strat, 0) + 1
            sw[strat] = sw.get(strat, 0) + win
            if cell_key:
                cc[cell_key] = cc.get(cell_key, 0) + 1
                cw[cell_key] = cw.get(cell_key, 0) + win

    df["raw_strat_sector_wr"] = raw_wr
    df["shrunk_strat_sector_wr"] = shrunk_wr
    df["cell_n"] = cell_n
    return df


def apply_overlay(df, cap=10.0, neutral_band=2.0):
    """Compute AQS v2 and AQS v2 + overlay scores."""
    aqs, aqs_ov = [], []
    gw, gc = 0, 0

    for i in range(len(df)):
        row = df.iloc[i]
        base = compute_aqs_v2(row)
        shrunk = row.get("shrunk_strat_sector_wr")

        gp = gw / gc * 100 if gc >= 20 else np.nan
        gc += 1; gw += row["win"]

        bonus = 0.0
        if not (np.isnan(shrunk) if isinstance(shrunk, float) else shrunk is None):
            if not np.isnan(gp):
                delta = shrunk - gp
                if delta > neutral_band:
                    bonus = min(delta - neutral_band, cap)
                elif delta < -neutral_band:
                    bonus = max(delta + neutral_band, -cap)

        aqs.append(base)
        aqs_ov.append(max(0, min(100, base + bonus)))

    df["aqs_v2"] = aqs
    df["aqs_v2_overlay"] = aqs_ov
    return df


def decile_spread(df, score_col):
    """Compute D10-D1 PnL spread on test set."""
    valid = df[df[score_col].notna() & (df[score_col] != 0)].copy()
    if len(valid) < 100:
        return np.nan, np.nan, np.nan, 0
    try:
        valid["dec"] = pd.qcut(valid[score_col], 10, labels=False, duplicates="drop")
    except ValueError:
        return np.nan, np.nan, np.nan, 0
    dec = valid.groupby("dec")["holly_pnl"].mean()
    if len(dec) < 2:
        return np.nan, np.nan, np.nan, 0
    d10, d1 = dec.iloc[-1], dec.iloc[0]
    spread = d10 - d1

    d10_v = valid[valid["dec"] == dec.index[-1]]["holly_pnl"]
    d1_v = valid[valid["dec"] == dec.index[0]]["holly_pnl"]
    n1, n2 = len(d10_v), len(d1_v)
    if n1 > 10 and n2 > 10:
        ps = np.sqrt(((n1-1)*d10_v.var() + (n2-1)*d1_v.var()) / (n1+n2-2))
        d_val = abs(d10_v.mean() - d1_v.mean()) / ps if ps > 0 else 0
    else:
        d_val = 0

    return spread, d_val, d10 - d1, len(valid)


def wr_spread(df, score_col):
    """D10-D1 WR spread."""
    valid = df[df[score_col].notna() & (df[score_col] != 0)].copy()
    if len(valid) < 100:
        return np.nan
    try:
        valid["dec"] = pd.qcut(valid[score_col], 10, labels=False, duplicates="drop")
    except ValueError:
        return np.nan
    dec = valid.groupby("dec")["win"].mean()
    if len(dec) < 2:
        return np.nan
    return (dec.iloc[-1] - dec.iloc[0]) * 100


# ─── Data loading ───────────────────────────────────────────────────────────

def load_data():
    con = duckdb.connect(str(DUCKDB_PATH), read_only=True)
    df = con.execute("""
        SELECT
            t.trade_id, CAST(t.entry_time AS DATE) AS entry_date,
            t.entry_time, t.symbol, t.direction, t.strategy,
            t.entry_price, t.stop_price, t.holly_pnl,
            CASE WHEN t.holly_pnl > 0 THEN 1 ELSE 0 END AS win,
            td.sic_code, td.sic_description, td.market_cap,
            r.vol_regime, r.trend_regime, r.momentum_regime,
            m.vix_regime,
            bf.news_count_24h
        FROM trades t
        LEFT JOIN ticker_details td ON t.symbol = td.symbol
        LEFT JOIN trade_regime r ON t.trade_id = r.trade_id
        LEFT JOIN fred_macro_daily m ON CAST(t.entry_time AS DATE) = m.date
        LEFT JOIN benzinga_features_broad bf ON bf.trade_id = t.trade_id
        WHERE t.holly_pnl IS NOT NULL
        ORDER BY t.entry_time
    """).df()

    # Strategy rolling WR
    df = df.sort_values("entry_time").reset_index(drop=True)
    strat_hist = {}
    swr = np.full(len(df), np.nan)
    for i in range(len(df)):
        s, w = df.loc[i, "strategy"], df.loc[i, "win"]
        if s in strat_hist and len(strat_hist[s]) >= 10:
            swr[i] = sum(strat_hist[s]) / len(strat_hist[s]) * 100
        strat_hist.setdefault(s, []).append(w)
    df["strategy_recent_wr"] = swr

    con.close()

    def safe_sic2(x):
        if pd.isna(x) or x == "" or x is None:
            return None
        try:
            return str(int(float(x)))[:2]
        except Exception:
            return None

    df["sic2"] = df["sic_code"].apply(safe_sic2)
    return df


# ─── TEST 1: Permutation test ──────────────────────────────────────────────

def test_permutation(df, n_perms=200):
    """Shuffle overlay labels, measure if observed spread gain is real."""
    print(f"\n{'='*70}")
    print("TEST 1: PERMUTATION TEST (H0: overlay adds no value)")
    print(f"{'='*70}")

    split = int(len(df) * 0.6)
    test = df.iloc[split:].copy()

    # Observed spread improvement
    sp_base, _, _, _ = decile_spread(test, "aqs_v2")
    sp_overlay, _, _, _ = decile_spread(test, "aqs_v2_overlay")
    observed_gain = sp_overlay - sp_base
    print(f"  Observed spread gain: ${observed_gain:,.0f}")

    # Permutations: shuffle shrunk_strat_sector_wr, recompute overlay
    null_gains = []
    for p in range(n_perms):
        test_perm = test.copy()
        test_perm["shrunk_strat_sector_wr"] = np.random.permutation(
            test_perm["shrunk_strat_sector_wr"].values
        )
        test_perm = apply_overlay(test_perm)
        sp_perm, _, _, _ = decile_spread(test_perm, "aqs_v2_overlay")
        null_gains.append(sp_perm - sp_base)

    null_gains = np.array(null_gains)
    p_value = (np.sum(null_gains >= observed_gain) + 1) / (n_perms + 1)
    ci_95 = np.percentile(null_gains, 95)

    print(f"  Null distribution: mean=${np.mean(null_gains):,.0f}, "
          f"std=${np.std(null_gains):,.0f}")
    print(f"  95th percentile of null: ${ci_95:,.0f}")
    print(f"  Observed gain vs null 95th: ${observed_gain:,.0f} vs ${ci_95:,.0f}")
    print(f"  p-value: {p_value:.4f}")

    verdict = "PASS" if p_value < 0.05 else "FAIL"
    print(f"  VERDICT: {verdict} (p={p_value:.4f})")
    return verdict, p_value


# ─── TEST 2: Walk-forward expanding window ─────────────────────────────────

def test_walk_forward(df, n_folds=6):
    """Expanding window walk-forward. No single static split."""
    print(f"\n{'='*70}")
    print(f"TEST 2: WALK-FORWARD ({n_folds} folds, expanding window)")
    print(f"{'='*70}")

    fold_size = len(df) // (n_folds + 1)
    min_train = fold_size * 2  # need at least 2 folds of training

    gains = []
    wr_gains = []
    print(f"  {'Fold':>4} {'Train':>7} {'Test':>7} {'Base$':>9} "
          f"{'Overlay$':>10} {'Gain$':>9} {'WR_base':>8} {'WR_ov':>8}")

    for fold in range(n_folds):
        test_start = min_train + fold * fold_size
        test_end = min(test_start + fold_size, len(df))
        if test_end <= test_start or test_start >= len(df):
            break

        test_fold = df.iloc[test_start:test_end].copy()

        sp_b, _, _, n_b = decile_spread(test_fold, "aqs_v2")
        sp_o, _, _, n_o = decile_spread(test_fold, "aqs_v2_overlay")

        wr_b = wr_spread(test_fold, "aqs_v2")
        wr_o = wr_spread(test_fold, "aqs_v2_overlay")

        gain = sp_o - sp_b if not np.isnan(sp_o) and not np.isnan(sp_b) else np.nan
        wr_g = wr_o - wr_b if not np.isnan(wr_o) and not np.isnan(wr_b) else np.nan

        if not np.isnan(gain):
            gains.append(gain)
        if not np.isnan(wr_g):
            wr_gains.append(wr_g)

        sp_b_s = f"${sp_b:>8,.0f}" if not np.isnan(sp_b) else "     n/a"
        sp_o_s = f"${sp_o:>9,.0f}" if not np.isnan(sp_o) else "      n/a"
        gain_s = f"${gain:>8,.0f}" if not np.isnan(gain) else "     n/a"
        wr_b_s = f"{wr_b:>7.1f}pp" if not np.isnan(wr_b) else "     n/a"
        wr_o_s = f"{wr_o:>7.1f}pp" if not np.isnan(wr_o) else "     n/a"

        print(f"  {fold+1:>4} {test_start:>7,} {test_end-test_start:>7,} "
              f"{sp_b_s} {sp_o_s} {gain_s} {wr_b_s} {wr_o_s}")

    if gains:
        mean_gain = np.mean(gains)
        pos_folds = sum(1 for g in gains if g > 0)
        t_stat, t_p = stats.ttest_1samp(gains, 0) if len(gains) > 2 else (0, 1)
        print(f"\n  Mean gain: ${mean_gain:,.0f}")
        print(f"  Positive folds: {pos_folds}/{len(gains)}")
        print(f"  t-test vs 0: t={t_stat:.2f}, p={t_p:.4f}")

        verdict = "PASS" if pos_folds >= len(gains) * 0.6 and mean_gain > 0 else "FAIL"
        print(f"  VERDICT: {verdict}")
        return verdict, mean_gain
    else:
        print("  VERDICT: FAIL (no valid folds)")
        return "FAIL", 0


# ─── TEST 3: Worst-regime stress test ──────────────────────────────────────

def test_worst_regime(df):
    """Test overlay only in the regimes where it should struggle."""
    print(f"\n{'='*70}")
    print("TEST 3: WORST-REGIME STRESS TEST")
    print(f"{'='*70}")

    split = int(len(df) * 0.6)
    test = df.iloc[split:]

    results = []
    # High VIX = elevated or high
    for label, mask_fn in [
        ("VIX elevated/high",
         lambda d: d["vix_regime"].isin(["elevated", "high"])),
        ("High vol regime",
         lambda d: d["vol_regime"] == "high_vol"),
        ("Downtrend",
         lambda d: d["trend_regime"] == "downtrend"),
        ("Short trades only",
         lambda d: d["direction"] == "Short"),
        ("2024-2026 only",
         lambda d: pd.to_datetime(d["entry_date"]).dt.year >= 2024),
        ("2025-2026 only",
         lambda d: pd.to_datetime(d["entry_date"]).dt.year >= 2025),
    ]:
        try:
            sub = test[mask_fn(test)].copy()
        except Exception:
            continue
        if len(sub) < 100:
            print(f"  {label:25s}: N={len(sub):,} — too small")
            continue

        sp_b, d_b, _, n_b = decile_spread(sub, "aqs_v2")
        sp_o, d_o, _, n_o = decile_spread(sub, "aqs_v2_overlay")
        gain = sp_o - sp_b if not np.isnan(sp_o) and not np.isnan(sp_b) else np.nan

        wr_b = wr_spread(sub, "aqs_v2")
        wr_o = wr_spread(sub, "aqs_v2_overlay")
        wr_g = wr_o - wr_b if not np.isnan(wr_o) and not np.isnan(wr_b) else np.nan

        gain_s = f"${gain:+,.0f}" if not np.isnan(gain) else "n/a"
        d_b_s = f"{d_b:.3f}" if not np.isnan(d_b) else "n/a"
        d_o_s = f"{d_o:.3f}" if not np.isnan(d_o) else "n/a"
        wr_g_s = f"{wr_g:+.1f}pp" if not np.isnan(wr_g) else "n/a"

        status = "OK" if (not np.isnan(gain) and gain >= 0) else "HURT"
        results.append((label, gain, status))

        print(f"  {label:25s}: N={len(sub):>5,} | "
              f"d: {d_b_s}->{d_o_s} | spread: {gain_s} | WR: {wr_g_s} | {status}")

    hurts = sum(1 for _, _, s in results if s == "HURT")
    total = len(results)
    verdict = "PASS" if hurts <= 1 else ("MARGINAL" if hurts <= 2 else "FAIL")
    print(f"\n  Hurt count: {hurts}/{total}")
    print(f"  VERDICT: {verdict}")
    return verdict, hurts


# ─── TEST 4: Parameter sensitivity sweep ───────────────────────────────────

def test_param_sweep(df_raw):
    """Sweep min_cell, cap, neutral_band. Signal shouldn't be fragile."""
    print(f"\n{'='*70}")
    print("TEST 4: PARAMETER SENSITIVITY SWEEP")
    print(f"{'='*70}")

    configs = [
        # (min_cell, cap, neutral_band, label)
        (3, 10, 2.0, "aggressive shrink"),
        (5, 10, 2.0, "DEFAULT"),
        (10, 10, 2.0, "conservative shrink"),
        (20, 10, 2.0, "heavy shrink"),
        (5, 5, 2.0, "small cap"),
        (5, 15, 2.0, "large cap"),
        (5, 10, 0.5, "tight band"),
        (5, 10, 5.0, "wide band"),
    ]

    results = []
    print(f"  {'Config':>22} {'min_c':>5} {'cap':>4} {'band':>5} "
          f"{'Spread$':>9} {'d':>6} {'WR_pp':>7}")

    for min_c, cap, band, label in configs:
        test_df = df_raw.copy()
        test_df = build_shrunk_priors(test_df, min_cell=min_c)
        test_df = apply_overlay(test_df, cap=cap, neutral_band=band)

        split = int(len(test_df) * 0.6)
        test = test_df.iloc[split:]

        sp, d_val, _, _ = decile_spread(test, "aqs_v2_overlay")
        wr = wr_spread(test, "aqs_v2_overlay")

        sp_s = f"${sp:>8,.0f}" if not np.isnan(sp) else "     n/a"
        d_s = f"{d_val:>5.3f}" if not np.isnan(d_val) else "  n/a"
        wr_s = f"{wr:>6.1f}pp" if not np.isnan(wr) else "  n/a"

        results.append((label, sp, d_val, wr))
        marker = " <<<" if label == "DEFAULT" else ""
        print(f"  {label:>22} {min_c:>5} {cap:>4} {band:>5.1f} "
              f"{sp_s} {d_s} {wr_s}{marker}")

    # Check: does the spread vary wildly?
    spreads = [s for _, s, _, _ in results if not np.isnan(s)]
    if spreads:
        spread_std = np.std(spreads)
        spread_mean = np.mean(spreads)
        cv = spread_std / abs(spread_mean) if spread_mean != 0 else 999
        print(f"\n  Spread mean: ${spread_mean:,.0f} | std: ${spread_std:,.0f} | CV: {cv:.2f}")
        verdict = "PASS" if cv < 0.5 else ("MARGINAL" if cv < 0.75 else "FAIL")
        print(f"  VERDICT: {verdict} (CV<0.5 = robust)")
        return verdict, cv
    return "FAIL", 999


# ─── TEST 5: Recency weighting comparison ──────────────────────────────────

def test_recency_weighting(df_raw):
    """Compare full-history vs exponential-decay accumulators."""
    print(f"\n{'='*70}")
    print("TEST 5: RECENCY-WEIGHTED vs FULL-HISTORY ACCUMULATORS")
    print(f"{'='*70}")

    decays = [
        (None, "Full history (no decay)"),
        (0.999, "Slow decay (~693 trade half-life)"),
        (0.997, "Medium decay (~231 trade half-life)"),
        (0.995, "Fast decay (~138 trade half-life)"),
        (0.990, "Aggressive decay (~69 trade half-life)"),
    ]

    results = []
    print(f"  {'Decay':>35} {'Spread$':>10} {'d':>7} {'WR_pp':>8} {'Avail%':>7}")

    for decay, label in decays:
        test_df = df_raw.copy()
        test_df = build_shrunk_priors(test_df, min_cell=5, decay=decay)
        test_df = apply_overlay(test_df)

        split = int(len(test_df) * 0.6)
        test = test_df.iloc[split:]

        sp, d_val, _, n = decile_spread(test, "aqs_v2_overlay")
        wr = wr_spread(test, "aqs_v2_overlay")
        avail = test["shrunk_strat_sector_wr"].notna().mean() * 100

        sp_s = f"${sp:>9,.0f}" if not np.isnan(sp) else "      n/a"
        d_s = f"{d_val:>6.3f}" if not np.isnan(d_val) else "   n/a"
        wr_s = f"{wr:>7.1f}pp" if not np.isnan(wr) else "   n/a"
        marker = " <<<" if decay is None else ""

        results.append((label, sp, d_val))
        print(f"  {label:>35} {sp_s} {d_s} {wr_s} {avail:>6.1f}%{marker}")

    # Also test: recency on newest data only (2024+)
    print("\n  --- Newest data only (2024+) ---")
    for decay, label in decays:
        test_df = df_raw.copy()
        test_df = build_shrunk_priors(test_df, min_cell=5, decay=decay)
        test_df = apply_overlay(test_df)

        recent = test_df[pd.to_datetime(test_df["entry_date"]).dt.year >= 2024].copy()
        if len(recent) < 100:
            continue
        sp, d_val, _, _ = decile_spread(recent, "aqs_v2_overlay")
        wr = wr_spread(recent, "aqs_v2_overlay")

        sp_s = f"${sp:>9,.0f}" if not np.isnan(sp) else "      n/a"
        d_s = f"{d_val:>6.3f}" if not np.isnan(d_val) else "   n/a"
        wr_s = f"{wr:>7.1f}pp" if not np.isnan(wr) else "   n/a"
        print(f"  {label:>35} {sp_s} {d_s} {wr_s}")

    # Best decay for newest data
    print("\n  VERDICT: Compare full-history vs best decay on 2024+ data above")
    return "INFO", None


# ─── TEST 6: Bootstrap confidence intervals ────────────────────────────────

def test_bootstrap(df, n_boot=1000):
    """Bootstrap CI on the spread improvement."""
    print(f"\n{'='*70}")
    print(f"TEST 6: BOOTSTRAP CI ({n_boot} resamples)")
    print(f"{'='*70}")

    split = int(len(df) * 0.6)
    test = df.iloc[split:].copy()

    boot_gains = []
    for b in range(n_boot):
        sample = test.sample(n=len(test), replace=True)
        sp_b, _, _, _ = decile_spread(sample, "aqs_v2")
        sp_o, _, _, _ = decile_spread(sample, "aqs_v2_overlay")
        if not np.isnan(sp_b) and not np.isnan(sp_o):
            boot_gains.append(sp_o - sp_b)

    boot_gains = np.array(boot_gains)
    ci_lo = np.percentile(boot_gains, 2.5)
    ci_hi = np.percentile(boot_gains, 97.5)
    mean_gain = np.mean(boot_gains)
    pct_positive = (boot_gains > 0).mean() * 100

    print(f"  Mean gain: ${mean_gain:,.0f}")
    print(f"  95% CI: [${ci_lo:,.0f}, ${ci_hi:,.0f}]")
    print(f"  % positive: {pct_positive:.1f}%")

    verdict = "PASS" if ci_lo > 0 else ("MARGINAL" if pct_positive > 70 else "FAIL")
    print(f"  VERDICT: {verdict} (CI lower bound {'>' if ci_lo > 0 else '<'} $0)")
    return verdict, (ci_lo, ci_hi)


# ─── TEST 7: Newest-data-only test ─────────────────────────────────────────

def test_newest_data(df):
    """The hardest test: does the overlay help in 2024-2026?"""
    print(f"\n{'='*70}")
    print("TEST 7: NEWEST DATA ONLY (2024-2026)")
    print(f"{'='*70}")

    for year_start, label in [(2024, "2024-2026"), (2025, "2025-2026")]:
        recent = df[pd.to_datetime(df["entry_date"]).dt.year >= year_start].copy()
        if len(recent) < 50:
            print(f"  {label}: too few trades ({len(recent)})")
            continue

        sp_b, d_b, _, n_b = decile_spread(recent, "aqs_v2")
        sp_o, d_o, _, n_o = decile_spread(recent, "aqs_v2_overlay")
        wr_b = wr_spread(recent, "aqs_v2")
        wr_o = wr_spread(recent, "aqs_v2_overlay")

        gain = sp_o - sp_b if not np.isnan(sp_o) and not np.isnan(sp_b) else np.nan
        wr_g = wr_o - wr_b if not np.isnan(wr_o) and not np.isnan(wr_b) else np.nan

        print(f"\n  {label} (N={len(recent):,}):")
        sp_b_s = f"${sp_b:,.0f}" if not np.isnan(sp_b) else "n/a"
        sp_o_s = f"${sp_o:,.0f}" if not np.isnan(sp_o) else "n/a"
        d_b_s = f"{d_b:.3f}" if not np.isnan(d_b) else "n/a"
        d_o_s = f"{d_o:.3f}" if not np.isnan(d_o) else "n/a"
        print(f"    AQS v2:          spread={sp_b_s}, d={d_b_s}")
        print(f"    AQS v2+overlay:  spread={sp_o_s}, d={d_o_s}")
        gain_s = f"${gain:+,.0f}" if not np.isnan(gain) else "n/a"
        wr_g_s = f"{wr_g:+.1f}pp" if not np.isnan(wr_g) else "n/a"
        print(f"    Gain: {gain_s} | WR: {wr_g_s}")

        # Direction split
        for direction in ["Long", "Short"]:
            d_sub = recent[recent["direction"] == direction]
            if len(d_sub) < 50:
                continue
            sp_b2, _, _, _ = decile_spread(d_sub, "aqs_v2")
            sp_o2, _, _, _ = decile_spread(d_sub, "aqs_v2_overlay")
            g2 = sp_o2 - sp_b2 if not np.isnan(sp_o2) and not np.isnan(sp_b2) else np.nan
            g2_s = f"${g2:+,.0f}" if not np.isnan(g2) else "n/a"
            print(f"      {direction}: gain={g2_s} (N={len(d_sub):,})")

    # This test is informational — newest data is always the hardest
    print(f"\n  VERDICT: INFORMATIONAL (inspect gains above)")
    return "INFO", None


# ─── Main ───────────────────────────────────────────────────────────────────

def main():
    print("=" * 70)
    print("SCRIPT 100: ADVERSARIAL TEST — SHRUNK SSP OVERLAY vs AQS v2")
    print("=" * 70)
    t0 = time.time()

    print("\nLoading data...")
    df = load_data()
    print(f"  {len(df):,} trades, {df['entry_date'].min()} to {df['entry_date'].max()}")

    # Build default overlay (full history, default params)
    df = build_shrunk_priors(df, min_cell=5, min_strat=10)
    df = apply_overlay(df, cap=10.0, neutral_band=2.0)
    print(f"  Overlay built: {df['shrunk_strat_sector_wr'].notna().sum():,} "
          f"trades scored ({df['shrunk_strat_sector_wr'].notna().mean()*100:.0f}%)")

    # ─── Run all adversarial tests ───
    verdicts = {}

    v1, _ = test_permutation(df, n_perms=200)
    verdicts["Permutation"] = v1

    v2, _ = test_walk_forward(df, n_folds=6)
    verdicts["Walk-forward"] = v2

    v3, _ = test_worst_regime(df)
    verdicts["Worst-regime"] = v3

    # Param sweep needs raw df (rebuilds priors each time)
    df_raw = df.drop(columns=[
        "raw_strat_sector_wr", "shrunk_strat_sector_wr", "cell_n",
        "aqs_v2", "aqs_v2_overlay"
    ], errors="ignore")
    v4, _ = test_param_sweep(df_raw)
    verdicts["Param sensitivity"] = v4

    v5, _ = test_recency_weighting(df_raw)
    verdicts["Recency weighting"] = v5

    v6, _ = test_bootstrap(df, n_boot=500)
    verdicts["Bootstrap CI"] = v6

    v7, _ = test_newest_data(df)
    verdicts["Newest data"] = v7

    # ─── FINAL SCORECARD ───
    print(f"\n{'='*70}")
    print("FINAL ADVERSARIAL SCORECARD")
    print(f"{'='*70}")
    for test_name, verdict in verdicts.items():
        icon = {"PASS": "+", "FAIL": "X", "MARGINAL": "~", "INFO": "i"}
        print(f"  [{icon.get(verdict, '?')}] {test_name:25s}: {verdict}")

    passes = sum(1 for v in verdicts.values() if v == "PASS")
    fails = sum(1 for v in verdicts.values() if v == "FAIL")
    marginals = sum(1 for v in verdicts.values() if v == "MARGINAL")

    print(f"\n  Score: {passes} PASS / {marginals} MARGINAL / {fails} FAIL")

    if fails == 0 and marginals <= 1:
        print("  OVERALL: SHIP IT — overlay is adversarially validated")
    elif fails <= 1:
        print("  OVERALL: CONDITIONAL SHIP — address failures before production")
    else:
        print("  OVERALL: DO NOT SHIP — overlay fails adversarial testing")

    elapsed = time.time() - t0
    print(f"\nScript 100 complete in {elapsed:.1f}s")


if __name__ == "__main__":
    main()
