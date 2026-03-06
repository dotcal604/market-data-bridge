"""
14_audit_trades_vs_yahoo.py — Audit Holly trade data against Yahoo daily bars.

Cross-references Holly's trade records against Yahoo daily OHLCV to validate:
1. Entry price within daily high/low range
2. Exit price within daily high/low range
3. Trade date is an actual trading day
4. Price sanity (not zero, not negative)
5. Split detection (Holly price vs Yahoo price ratio)
6. Direction validation (PnL sign vs price movement)

Usage:
    python scripts/14_audit_trades_vs_yahoo.py
"""

import sys
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).parent.parent))

from config.settings import OUTPUT_DIR
from engine.data_loader import get_db


def main():
    db = get_db()

    # Load all trades
    trades = db.execute("""
        SELECT
            trade_id, symbol, strategy, direction,
            entry_time, entry_price, exit_time, exit_price,
            holly_pnl, shares, stop_price,
            real_entry_price, real_entry_time
        FROM trades
        ORDER BY entry_time
    """).fetchdf()

    trades["entry_date"] = pd.to_datetime(trades["entry_time"]).dt.date
    trades["exit_date"] = pd.to_datetime(trades["exit_time"]).dt.date

    print(f"Total trades: {len(trades):,}")

    # ── 1. Match trades to Yahoo daily bars ───────────────────────────
    matched = db.execute("""
        SELECT
            t.trade_id,
            t.symbol,
            t.entry_price,
            t.exit_price,
            t.direction,
            t.holly_pnl,
            t.shares,
            t.real_entry_price,
            CAST(t.entry_time AS DATE) AS entry_date,
            CAST(t.exit_time AS DATE) AS exit_date,
            -- Entry day bar
            ed.open   AS entry_day_open,
            ed.high   AS entry_day_high,
            ed.low    AS entry_day_low,
            ed.close  AS entry_day_close,
            ed.volume AS entry_day_volume,
            -- Exit day bar
            xd.open   AS exit_day_open,
            xd.high   AS exit_day_high,
            xd.low    AS exit_day_low,
            xd.close  AS exit_day_close,
            xd.volume AS exit_day_volume,
            -- Previous day close (for gap detection)
            prev.close AS prev_day_close
        FROM trades t
        LEFT JOIN daily_bars ed
            ON t.symbol = ed.symbol
            AND ed.bar_date = CAST(t.entry_time AS DATE)
        LEFT JOIN daily_bars xd
            ON t.symbol = xd.symbol
            AND xd.bar_date = CAST(t.exit_time AS DATE)
        LEFT JOIN LATERAL (
            SELECT close FROM daily_bars
            WHERE symbol = t.symbol
            AND bar_date < CAST(t.entry_time AS DATE)
            ORDER BY bar_date DESC
            LIMIT 1
        ) prev ON TRUE
        ORDER BY t.entry_time
    """).fetchdf()

    print(f"Trades with Yahoo entry-day bar: {matched['entry_day_high'].notna().sum():,}")
    print(f"Trades with Yahoo exit-day bar:  {matched['exit_day_high'].notna().sum():,}")
    print()

    # ── 2. Run audit checks ───────────────────────────────────────────
    checks = []

    for _, t in matched.iterrows():
        flags = []
        severity = "ok"
        tid = t["trade_id"]
        ep = t["entry_price"]
        xp = t["exit_price"]
        rep = t["real_entry_price"]

        # Use real entry price if available
        eff_entry = rep if pd.notna(rep) and rep > 0 else ep

        # -- Price sanity --
        if ep <= 0:
            flags.append("ENTRY_PRICE_ZERO")
            severity = "error"
        if pd.notna(xp) and xp <= 0:
            flags.append("EXIT_PRICE_ZERO")
            severity = "error"

        # -- Entry day validation --
        if pd.notna(t["entry_day_high"]):
            day_h = t["entry_day_high"]
            day_l = t["entry_day_low"]
            day_c = t["entry_day_close"]

            # Entry price within daily range (with 5% tolerance for pre/post market)
            tolerance = 0.05
            range_h = day_h * (1 + tolerance)
            range_l = day_l * (1 - tolerance)

            if eff_entry > range_h or eff_entry < range_l:
                # Check if it's a split mismatch
                ratio = eff_entry / day_c if day_c > 0 else 0
                abs_ratio = max(ratio, 1/ratio) if ratio > 0 else 999

                if abs_ratio > 1.8:
                    flags.append(f"SPLIT_MISMATCH({abs_ratio:.1f}x)")
                    severity = "warning"
                else:
                    flags.append(f"ENTRY_OUTSIDE_RANGE(${eff_entry:.2f} vs ${day_l:.2f}-${day_h:.2f})")
                    severity = "warning"

            # Volume sanity
            if t["entry_day_volume"] < 1000:
                flags.append(f"LOW_VOLUME({int(t['entry_day_volume'])})")
                severity = max(severity, "warning", key=lambda s: {"ok": 0, "warning": 1, "error": 2}[s])

        else:
            flags.append("NO_YAHOO_ENTRY_BAR")

        # -- Exit day validation --
        if pd.notna(xp) and pd.notna(t["exit_day_high"]):
            xday_h = t["exit_day_high"]
            xday_l = t["exit_day_low"]
            range_h = xday_h * (1 + tolerance)
            range_l = xday_l * (1 - tolerance)

            if xp > range_h or xp < range_l:
                xday_c = t["exit_day_close"]
                ratio = xp / xday_c if xday_c > 0 else 0
                abs_ratio = max(ratio, 1/ratio) if ratio > 0 else 999
                if abs_ratio > 1.8:
                    flags.append(f"EXIT_SPLIT_MISMATCH({abs_ratio:.1f}x)")
                else:
                    flags.append(f"EXIT_OUTSIDE_RANGE(${xp:.2f} vs ${xday_l:.2f}-${xday_h:.2f})")
                severity = "warning"

        # -- Direction vs PnL consistency --
        if pd.notna(t["holly_pnl"]) and pd.notna(xp) and ep > 0:
            price_move = xp - ep
            if t["direction"] == "Long" and t["holly_pnl"] != 0:
                expected_sign = np.sign(price_move)
                actual_sign = np.sign(t["holly_pnl"] / max(t["shares"], 1))
                if expected_sign != 0 and actual_sign != 0 and expected_sign != actual_sign:
                    flags.append("DIRECTION_PNL_MISMATCH")
                    severity = "warning"
            elif t["direction"] == "Short" and t["holly_pnl"] != 0:
                expected_sign = -np.sign(price_move)
                actual_sign = np.sign(t["holly_pnl"] / max(t["shares"], 1))
                if expected_sign != 0 and actual_sign != 0 and expected_sign != actual_sign:
                    flags.append("DIRECTION_PNL_MISMATCH")
                    severity = "warning"

        # -- Gap check (entry price vs previous close) --
        if pd.notna(t["prev_day_close"]) and t["prev_day_close"] > 0:
            gap_pct = abs(eff_entry - t["prev_day_close"]) / t["prev_day_close"] * 100
            if gap_pct > 20:
                flags.append(f"LARGE_GAP({gap_pct:.0f}%)")

        checks.append({
            "trade_id": tid,
            "symbol": t["symbol"],
            "entry_date": t["entry_date"],
            "direction": t["direction"],
            "entry_price": ep,
            "eff_entry_price": eff_entry,
            "exit_price": xp,
            "holly_pnl": t["holly_pnl"],
            "entry_day_low": t.get("entry_day_low"),
            "entry_day_high": t.get("entry_day_high"),
            "entry_day_close": t.get("entry_day_close"),
            "entry_day_volume": t.get("entry_day_volume"),
            "severity": severity,
            "flags": "|".join(flags) if flags else "",
            "flag_count": len(flags),
        })

    audit_df = pd.DataFrame(checks)
    db.close()

    # ── 3. Summary ────────────────────────────────────────────────────
    print("=" * 60)
    print("HOLLY TRADE AUDIT vs YAHOO DAILY BARS")
    print("=" * 60)

    total = len(audit_df)
    clean = (audit_df["flag_count"] == 0).sum()
    warned = (audit_df["severity"] == "warning").sum()
    errored = (audit_df["severity"] == "error").sum()

    print(f"\n  Clean:    {clean:>6,} ({clean/total*100:.1f}%)")
    print(f"  Warning:  {warned:>6,} ({warned/total*100:.1f}%)")
    print(f"  Error:    {errored:>6,} ({errored/total*100:.1f}%)")

    # Flag breakdown
    all_flags = []
    for flags_str in audit_df["flags"]:
        if flags_str:
            for f in flags_str.split("|"):
                # Normalize parameterized flags
                base = f.split("(")[0]
                all_flags.append(base)

    if all_flags:
        flag_counts = pd.Series(all_flags).value_counts()
        print(f"\nFlag breakdown:")
        for flag, cnt in flag_counts.items():
            print(f"  {flag:<30} {cnt:>6,} ({cnt/total*100:.1f}%)")

    # ── 4. Export ─────────────────────────────────────────────────────
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    # Full audit
    audit_path = OUTPUT_DIR / "trade_audit_vs_yahoo.csv"
    audit_df.to_csv(audit_path, index=False)
    print(f"\nFull audit: {audit_path}")

    # Flagged-only export
    flagged = audit_df[audit_df["flag_count"] > 0].copy()
    flagged_path = OUTPUT_DIR / "trade_audit_flagged.csv"
    flagged.to_csv(flagged_path, index=False)
    print(f"Flagged only: {flagged_path} ({len(flagged):,} trades)")

    # Split mismatches specifically
    splits = flagged[flagged["flags"].str.contains("SPLIT_MISMATCH", na=False)]
    if len(splits) > 0:
        print(f"\nSplit mismatches: {len(splits):,}")
        # Show distribution
        for _, row in splits.head(10).iterrows():
            print(f"  {row['symbol']} {row['entry_date']}: "
                  f"Holly=${row['entry_price']:.2f} vs "
                  f"Yahoo=${row['entry_day_close']:.2f} "
                  f"[{row['flags']}]")

    print("\nDone.")


if __name__ == "__main__":
    main()
