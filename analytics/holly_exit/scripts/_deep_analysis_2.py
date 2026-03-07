"""
Deep analysis part 2 — behavioral & structural patterns.

Dimensions:
  13. R-Multiple analysis — actual risk/reward using Holly's stop
  14. Exit location — where you exit vs Holly's stop/target range
  15. Holly signal quality — when Holly is right, how do you do?
  16. Repeat tickers — stocks traded multiple times
  17. Multi-trade days — does trading more Holly alerts same day hurt?
  18. Price level analysis — cheap vs expensive stocks
  19. Streaks — consecutive wins/losses
  20. Tilt detection — does a loss affect your next trade?
  21. Equity curve & drawdown
  22. What-if scenarios — alternative exit rules
  23. Entry order type — LMT vs MKT
  24. Commission breakeven — how many more $ per trade to break even
  25. Your biggest winners vs biggest losers — pattern comparison
"""
import pandas as pd
import numpy as np
from pathlib import Path
import sys

REPORT_DIR = Path(__file__).parent.parent / "output" / "reports" / "trade_mapping"


def load_data():
    m = pd.read_csv(REPORT_DIR / "ibkr_holly_matched.csv")
    matched = m[m["category"] == "matched"].copy()
    for col in ["ibkr_entry_time", "ibkr_exit_time", "holly_entry_time", "holly_exit_time"]:
        matched[col] = pd.to_datetime(matched[col], errors="coerce")
    matched = matched.sort_values("ibkr_entry_time").reset_index(drop=True)
    return matched


def section(title):
    print()
    print("=" * 90)
    print(f"  {title}")
    print("=" * 90)


def r_multiple_analysis(df):
    """Risk/reward using Holly's stop price."""
    section("13. R-MULTIPLE ANALYSIS (using Holly's stop as risk)")

    closed = df[(df["ibkr_status"] == "closed") & df["holly_stop_price"].notna()].copy()
    if closed.empty:
        print("  No trades with Holly stop data."); return

    def calc_r(row):
        risk = abs(row["ibkr_entry_price"] - row["holly_stop_price"])
        if risk == 0:
            return None
        if row["direction"] == "Long":
            return (row["ibkr_exit_price"] - row["ibkr_entry_price"]) / risk
        else:
            return (row["ibkr_entry_price"] - row["ibkr_exit_price"]) / risk

    def calc_holly_r(row):
        risk = abs(row["holly_entry_price"] - row["holly_stop_price"])
        if risk == 0 or pd.isna(row["holly_exit_price"]):
            return None
        if row["direction"] == "Long":
            return (row["holly_exit_price"] - row["holly_entry_price"]) / risk
        else:
            return (row["holly_entry_price"] - row["holly_exit_price"]) / risk

    closed["your_R"] = closed.apply(calc_r, axis=1)
    closed["holly_R"] = closed.apply(calc_holly_r, axis=1)

    valid = closed[closed["your_R"].notna() & closed["holly_R"].notna()]
    if valid.empty:
        print("  Could not compute R-multiples."); return

    print(f"\n  Trades with computable R: {len(valid)}")
    print(f"\n  --- Your R-multiple distribution ---")
    for pct in [10, 25, 50, 75, 90]:
        print(f"    P{pct:2d}: {valid['your_R'].quantile(pct/100):+.2f}R")
    print(f"    Mean: {valid['your_R'].mean():+.2f}R")

    print(f"\n  --- Holly R-multiple distribution ---")
    for pct in [10, 25, 50, 75, 90]:
        print(f"    P{pct:2d}: {valid['holly_R'].quantile(pct/100):+.2f}R")
    print(f"    Mean: {valid['holly_R'].mean():+.2f}R")

    # Bucketed R analysis
    print(f"\n  --- Your trades by R-multiple outcome ---")
    r_buckets = [
        ("Stopped out (< -1R)", -999, -0.8),
        ("Small loss (-1R to 0)", -0.8, 0),
        ("Small win (0 to +1R)", 0, 1),
        ("Good win (+1R to +2R)", 1, 2),
        ("Great win (+2R to +5R)", 2, 5),
        ("Home run (+5R+)", 5, 999),
    ]
    for label, lo, hi in r_buckets:
        b = valid[(valid["your_R"] >= lo) & (valid["your_R"] < hi)]
        if len(b) == 0: continue
        print(f"    {label:30s} {len(b):3d} ({len(b)/len(valid)*100:4.1f}%)  avg P&L ${b['ibkr_net_pnl'].mean():+.2f}")

    # Did you honor the stop?
    def hit_stop(row):
        if row["direction"] == "Long":
            return row["ibkr_exit_price"] <= row["holly_stop_price"]
        else:
            return row["ibkr_exit_price"] >= row["holly_stop_price"]

    valid_copy = valid.copy()
    valid_copy["hit_stop"] = valid_copy.apply(hit_stop, axis=1)
    stopped = valid_copy[valid_copy["hit_stop"]]
    print(f"\n  Trades where you exited AT or PAST Holly's stop: {len(stopped)}/{len(valid)} ({len(stopped)/len(valid)*100:.1f}%)")
    if len(stopped) > 0:
        print(f"    Avg P&L on stop violations: ${stopped['ibkr_net_pnl'].mean():+.2f}")
        print(f"    Total damage: ${stopped['ibkr_net_pnl'].sum():+,.2f}")
        for _, r in stopped.iterrows():
            over = abs(r["ibkr_exit_price"] - r["holly_stop_price"])
            print(f"      {r['symbol']:6s} exit ${r['ibkr_exit_price']:.2f} vs stop ${r['holly_stop_price']:.2f} (${over:.2f} past stop)  P&L ${r['ibkr_net_pnl']:+.2f}")


def exit_location_analysis(df):
    """Where do you exit relative to Holly's defined range?"""
    section("14. EXIT LOCATION (where in Holly's stop-to-target range)")

    closed = df[(df["ibkr_status"] == "closed") & df["holly_stop_price"].notna()].copy()
    if closed.empty:
        return

    def exit_pct_of_range(row):
        stop = row["holly_stop_price"]
        entry = row["holly_entry_price"]
        rng = abs(entry - stop)
        if rng == 0:
            return None
        if row["direction"] == "Long":
            return (row["ibkr_exit_price"] - entry) / rng
        else:
            return (entry - row["ibkr_exit_price"]) / rng

    closed["exit_in_range"] = closed.apply(exit_pct_of_range, axis=1)
    valid = closed[closed["exit_in_range"].notna()]

    if valid.empty:
        return

    print(f"\n  Exit location as multiple of risk (0 = entry, -1 = stop, +1 = 1R profit)")
    print(f"\n  Distribution:")
    for pct in [10, 25, 50, 75, 90]:
        print(f"    P{pct:2d}: {valid['exit_in_range'].quantile(pct/100):+.2f}R")
    print(f"    Mean: {valid['exit_in_range'].mean():+.2f}R")

    below_entry = (valid["exit_in_range"] < 0).sum()
    at_entry = ((valid["exit_in_range"] >= -0.1) & (valid["exit_in_range"] <= 0.1)).sum()
    small_win = ((valid["exit_in_range"] > 0.1) & (valid["exit_in_range"] <= 1)).sum()
    big_win = (valid["exit_in_range"] > 1).sum()
    past_stop = (valid["exit_in_range"] < -1).sum()

    print(f"\n  Past stop (< -1R):    {past_stop} ({past_stop/len(valid)*100:.1f}%)")
    print(f"  Below entry (-1R to 0): {below_entry - past_stop} ({(below_entry-past_stop)/len(valid)*100:.1f}%)")
    print(f"  Near entry (~0R):     {at_entry} ({at_entry/len(valid)*100:.1f}%)")
    print(f"  Small profit (0-1R):  {small_win} ({small_win/len(valid)*100:.1f}%)")
    print(f"  Beyond 1R:            {big_win} ({big_win/len(valid)*100:.1f}%)")


def holly_signal_quality(df):
    """When Holly is right vs wrong, how do you perform?"""
    section("15. HOLLY SIGNAL QUALITY (when Holly is right vs wrong)")

    closed = df[df["ibkr_status"] == "closed"].copy()

    holly_right = closed[closed["holly_pnl"] > 0]
    holly_wrong = closed[closed["holly_pnl"] <= 0]

    print(f"\n  Holly correct (profitable): {len(holly_right)}/{len(closed)} ({len(holly_right)/len(closed)*100:.1f}%)")
    print(f"  Holly wrong (unprofitable):  {len(holly_wrong)}/{len(closed)} ({len(holly_wrong)/len(closed)*100:.1f}%)")

    if len(holly_right) > 0:
        print(f"\n  --- When Holly is RIGHT ({len(holly_right)} trades) ---")
        your_wr = (holly_right["ibkr_net_pnl"] > 0).mean()
        print(f"    Your win rate:     {your_wr:.1%}")
        print(f"    Your avg P&L:      ${holly_right['ibkr_net_pnl'].mean():+.2f}")
        print(f"    Holly avg P&L:     ${holly_right['holly_pnl'].mean():+.2f}")
        print(f"    Your total:        ${holly_right['ibkr_net_pnl'].sum():+,.2f}")
        print(f"    Holly total:       ${holly_right['holly_pnl'].sum():+,.2f}")
        print(f"    Capture rate:      {holly_right['ibkr_net_pnl'].sum() / holly_right['holly_pnl'].sum() * 100:.1f}%")
        print(f"    Avg hold you:      {holly_right['ibkr_hold_minutes'].mean():.0f}m")

    if len(holly_wrong) > 0:
        print(f"\n  --- When Holly is WRONG ({len(holly_wrong)} trades) ---")
        your_wr = (holly_wrong["ibkr_net_pnl"] > 0).mean()
        print(f"    Your win rate:     {your_wr:.1%}")
        print(f"    Your avg P&L:      ${holly_wrong['ibkr_net_pnl'].mean():+.2f}")
        print(f"    Holly avg P&L:     ${holly_wrong['holly_pnl'].mean():+.2f}")
        print(f"    Your total:        ${holly_wrong['ibkr_net_pnl'].sum():+,.2f}")
        print(f"    Holly total:       ${holly_wrong['holly_pnl'].sum():+,.2f}")
        you_better = (holly_wrong["ibkr_net_pnl"] > holly_wrong["holly_pnl"]).sum()
        print(f"    You beat Holly:    {you_better}/{len(holly_wrong)} ({you_better/len(holly_wrong)*100:.1f}%)")


def repeat_tickers(df):
    """Stocks traded more than once."""
    section("16. REPEAT TICKERS")

    closed = df[df["ibkr_status"] == "closed"].copy()
    counts = closed["symbol"].value_counts()
    repeats = counts[counts > 1]

    if repeats.empty:
        print("  No repeat tickers."); return

    print(f"\n  {len(repeats)} symbols traded more than once:")
    print(f"\n  {'Symbol':8s} {'N':>3s} {'Your P&L':>10s} {'Holly P&L':>10s} {'WR':>6s} {'Strategies':>30s}")
    for sym in repeats.index:
        g = closed[closed["symbol"] == sym]
        wr = (g["ibkr_net_pnl"] > 0).mean()
        strats = ", ".join(g["strategy"].unique())
        print(f"  {sym:8s} {len(g):3d} ${g['ibkr_net_pnl'].sum():+9.2f} ${g['holly_pnl'].sum():+9.2f} {wr:5.1%} {strats}")

    # Do you improve on repeat visits?
    print(f"\n  --- Learning curve on repeats ---")
    for sym in repeats.index:
        g = closed[closed["symbol"] == sym].sort_values("ibkr_entry_time")
        pnls = g["ibkr_net_pnl"].tolist()
        times = g["ibkr_entry_time"].dt.strftime("%m/%d").tolist()
        results = " -> ".join(f"{t} ${p:+.0f}" for t, p in zip(times, pnls))
        print(f"    {sym:6s}: {results}")


def multi_trade_days(df):
    """Days with multiple Holly trades — does it hurt?"""
    section("17. MULTI-TRADE DAYS (does trading more alerts same day hurt?)")

    closed = df[df["ibkr_status"] == "closed"].copy()
    closed["trade_date"] = closed["ibkr_entry_time"].dt.date

    day_counts = closed.groupby("trade_date").agg(
        n_trades=("ibkr_net_pnl", "count"),
        total_pnl=("ibkr_net_pnl", "sum"),
        avg_pnl=("ibkr_net_pnl", "mean"),
    ).reset_index()

    buckets = [
        ("1 trade/day", 1, 1),
        ("2 trades/day", 2, 2),
        ("3 trades/day", 3, 3),
        ("4+ trades/day", 4, 99),
    ]
    print(f"\n  {'Trades/day':15s} {'Days':>5s} {'Total trades':>13s} {'Avg day P&L':>12s} {'Total P&L':>12s}")
    for label, lo, hi in buckets:
        b = day_counts[(day_counts["n_trades"] >= lo) & (day_counts["n_trades"] <= hi)]
        if len(b) == 0: continue
        total_trades = b["n_trades"].sum()
        print(f"  {label:15s} {len(b):5d} {total_trades:13d} ${b['total_pnl'].mean():+11.2f} ${b['total_pnl'].sum():+11,.2f}")

    # Biggest multi-trade days
    big_days = day_counts[day_counts["n_trades"] >= 3].sort_values("total_pnl")
    if len(big_days) > 0:
        print(f"\n  Busiest days (3+ Holly trades):")
        for _, d in big_days.iterrows():
            emoji = "+" if d["total_pnl"] > 0 else "-"
            day_trades = closed[closed["trade_date"] == d["trade_date"]]
            syms = ", ".join(day_trades["symbol"].values)
            print(f"    {d['trade_date']}  {d['n_trades']} trades  ${d['total_pnl']:+,.2f}  [{syms}]")


def price_level_analysis(df):
    """Cheap vs expensive stocks."""
    section("18. PRICE LEVEL ANALYSIS")

    closed = df[df["ibkr_status"] == "closed"].copy()

    buckets = [
        ("Penny ($0-5)", 0, 5),
        ("Cheap ($5-15)", 5, 15),
        ("Mid ($15-30)", 15, 30),
        ("Upper ($30-50)", 30, 50),
        ("Expensive ($50+)", 50, 9999),
    ]
    print(f"\n  {'Price range':20s} {'N':>4s} {'Avg P&L':>10s} {'WR':>6s} {'Total':>12s} {'Avg Size':>9s}")
    for label, lo, hi in buckets:
        b = closed[(closed["ibkr_entry_price"] >= lo) & (closed["ibkr_entry_price"] < hi)]
        if len(b) == 0: continue
        wr = (b["ibkr_net_pnl"] > 0).mean()
        print(f"  {label:20s} {len(b):4d} ${b['ibkr_net_pnl'].mean():+9.2f} {wr:5.1%} ${b['ibkr_net_pnl'].sum():+11,.2f} {b['ibkr_shares'].mean():7.0f}")


def streak_analysis(df):
    """Consecutive wins/losses."""
    section("19. STREAK ANALYSIS")

    closed = df[df["ibkr_status"] == "closed"].copy()
    closed = closed.sort_values("ibkr_entry_time").reset_index(drop=True)

    results = (closed["ibkr_net_pnl"] > 0).astype(int).values

    # Find streaks
    streaks = []
    current_val = results[0]
    current_len = 1
    for i in range(1, len(results)):
        if results[i] == current_val:
            current_len += 1
        else:
            streaks.append(("W" if current_val == 1 else "L", current_len))
            current_val = results[i]
            current_len = 1
    streaks.append(("W" if current_val == 1 else "L", current_len))

    win_streaks = [s[1] for s in streaks if s[0] == "W"]
    loss_streaks = [s[1] for s in streaks if s[0] == "L"]

    print(f"\n  Total streaks: {len(streaks)}")
    print(f"  Max win streak:  {max(win_streaks) if win_streaks else 0}")
    print(f"  Max loss streak: {max(loss_streaks) if loss_streaks else 0}")
    print(f"  Avg win streak:  {np.mean(win_streaks):.1f}")
    print(f"  Avg loss streak: {np.mean(loss_streaks):.1f}")

    print(f"\n  Streak distribution:")
    for t in ["W", "L"]:
        lens = [s[1] for s in streaks if s[0] == t]
        if not lens: continue
        from collections import Counter
        c = Counter(lens)
        print(f"    {t}: {dict(sorted(c.items()))}")


def tilt_detection(df):
    """Does a loss affect your next trade?"""
    section("20. TILT DETECTION (does a loss affect your next trade?)")

    closed = df[df["ibkr_status"] == "closed"].copy()
    closed = closed.sort_values("ibkr_entry_time").reset_index(drop=True)

    if len(closed) < 10:
        print("  Not enough trades for tilt analysis."); return

    # After a loss, what happens next?
    after_loss = []
    after_win = []
    after_big_loss = []  # > $50 loss

    for i in range(1, len(closed)):
        prev = closed.iloc[i - 1]
        curr = closed.iloc[i]

        # Only count same-day or next-day trades
        day_diff = (curr["ibkr_entry_time"] - prev["ibkr_entry_time"]).total_seconds() / 3600
        if day_diff > 24:
            continue

        if prev["ibkr_net_pnl"] <= 0:
            after_loss.append(curr["ibkr_net_pnl"])
            if prev["ibkr_net_pnl"] < -50:
                after_big_loss.append(curr["ibkr_net_pnl"])
        else:
            after_win.append(curr["ibkr_net_pnl"])

    print(f"\n  After a WIN ({len(after_win)} subsequent trades):")
    if after_win:
        print(f"    Avg P&L:     ${np.mean(after_win):+.2f}")
        print(f"    Win rate:    {sum(1 for x in after_win if x > 0)/len(after_win):.1%}")

    print(f"\n  After a LOSS ({len(after_loss)} subsequent trades):")
    if after_loss:
        print(f"    Avg P&L:     ${np.mean(after_loss):+.2f}")
        print(f"    Win rate:    {sum(1 for x in after_loss if x > 0)/len(after_loss):.1%}")

    print(f"\n  After a BIG LOSS >$50 ({len(after_big_loss)} subsequent trades):")
    if after_big_loss:
        print(f"    Avg P&L:     ${np.mean(after_big_loss):+.2f}")
        print(f"    Win rate:    {sum(1 for x in after_big_loss if x > 0)/len(after_big_loss):.1%}")

    # Size changes after loss
    print(f"\n  --- Position size changes after loss ---")
    size_after_loss = []
    size_after_win = []
    for i in range(1, len(closed)):
        prev = closed.iloc[i - 1]
        curr = closed.iloc[i]
        day_diff = (curr["ibkr_entry_time"] - prev["ibkr_entry_time"]).total_seconds() / 3600
        if day_diff > 24:
            continue
        size_change = curr["ibkr_shares"] / prev["ibkr_shares"] if prev["ibkr_shares"] > 0 else 1
        if prev["ibkr_net_pnl"] <= 0:
            size_after_loss.append(size_change)
        else:
            size_after_win.append(size_change)

    if size_after_loss:
        print(f"    Avg size ratio after loss: {np.mean(size_after_loss):.2f}x (>1 = sizing UP)")
    if size_after_win:
        print(f"    Avg size ratio after win:  {np.mean(size_after_win):.2f}x")

    if size_after_loss and size_after_win:
        if np.mean(size_after_loss) > np.mean(size_after_win) * 1.1:
            print(f"    WARNING: You size UP after losses (revenge/tilt pattern)")
        elif np.mean(size_after_loss) < np.mean(size_after_win) * 0.9:
            print(f"    You size DOWN after losses (fear/caution pattern)")
        else:
            print(f"    Size stays consistent regardless of previous result (good)")


def equity_curve(df):
    """Cumulative equity curve and drawdown."""
    section("21. EQUITY CURVE & DRAWDOWN")

    closed = df[df["ibkr_status"] == "closed"].copy()
    closed = closed.sort_values("ibkr_entry_time").reset_index(drop=True)

    closed["cum_pnl"] = closed["ibkr_net_pnl"].cumsum()
    closed["peak"] = closed["cum_pnl"].cummax()
    closed["drawdown"] = closed["cum_pnl"] - closed["peak"]

    print(f"\n  --- Equity curve ---")
    print(f"    Starting:       $0.00")
    print(f"    Peak:           ${closed['peak'].max():+,.2f} (after trade #{closed['peak'].idxmax() + 1})")
    print(f"    Final:          ${closed['cum_pnl'].iloc[-1]:+,.2f}")
    print(f"    Max drawdown:   ${closed['drawdown'].min():+,.2f}")

    # When was the drawdown?
    dd_idx = closed["drawdown"].idxmin()
    dd_trade = closed.iloc[dd_idx]
    print(f"    Max DD at trade #{dd_idx + 1}: {dd_trade['symbol']} on {dd_trade['ibkr_entry_time'].strftime('%Y-%m-%d')}")

    # Show equity at key points
    print(f"\n  --- Equity at every 10th trade ---")
    print(f"  {'Trade #':>8s} {'Date':>12s} {'P&L':>10s} {'Cumulative':>12s} {'Drawdown':>10s}")
    for i in range(0, len(closed), 10):
        r = closed.iloc[i]
        print(f"  {i+1:8d} {r['ibkr_entry_time'].strftime('%Y-%m-%d'):>12s} ${r['ibkr_net_pnl']:+9.2f} ${r['cum_pnl']:+11,.2f} ${r['drawdown']:+9.2f}")
    # Always show last
    r = closed.iloc[-1]
    print(f"  {len(closed):8d} {r['ibkr_entry_time'].strftime('%Y-%m-%d'):>12s} ${r['ibkr_net_pnl']:+9.2f} ${r['cum_pnl']:+11,.2f} ${r['drawdown']:+9.2f}")

    # Recovery analysis
    in_dd = (closed["drawdown"] < 0).sum()
    print(f"\n  Trades in drawdown: {in_dd}/{len(closed)} ({in_dd/len(closed)*100:.1f}%)")


def whatif_scenarios(df):
    """Alternative exit rule simulations."""
    section("22. WHAT-IF SCENARIOS")

    closed = df[(df["ibkr_status"] == "closed") & df["holly_stop_price"].notna()].copy()
    if closed.empty:
        return

    # Scenario 1: What if you held to Holly's exit?
    has_holly_exit = closed[closed["holly_exit_price"].notna()].copy()
    if len(has_holly_exit) > 0:
        def holly_exit_pnl(row):
            sh = row["ibkr_shares"]
            if row["direction"] == "Long":
                return (row["holly_exit_price"] - row["ibkr_entry_price"]) * sh - row["ibkr_commission"]
            else:
                return (row["ibkr_entry_price"] - row["holly_exit_price"]) * sh - row["ibkr_commission"]

        has_holly_exit["whatif_holly_exit"] = has_holly_exit.apply(holly_exit_pnl, axis=1)

        print(f"\n  Scenario 1: YOUR entries + YOUR sizing + HOLLY exit timing")
        print(f"    Actual P&L:    ${has_holly_exit['ibkr_net_pnl'].sum():+,.2f}")
        print(f"    What-if P&L:   ${has_holly_exit['whatif_holly_exit'].sum():+,.2f}")
        print(f"    Difference:    ${has_holly_exit['whatif_holly_exit'].sum() - has_holly_exit['ibkr_net_pnl'].sum():+,.2f}")
        print(f"    What-if WR:    {(has_holly_exit['whatif_holly_exit'] > 0).mean():.1%}")

    # Scenario 2: What if you always used 1R stop and 2R target?
    def fixed_rr_pnl(row):
        risk = abs(row["ibkr_entry_price"] - row["holly_stop_price"])
        if risk == 0:
            return row["ibkr_net_pnl"]
        target_2r = risk * 2
        sh = row["ibkr_shares"]

        if row["direction"] == "Long":
            actual_move = row["ibkr_exit_price"] - row["ibkr_entry_price"]
            # Clamp to -1R or +2R
            if actual_move <= -risk:
                return -risk * sh - row["ibkr_commission"]
            elif actual_move >= target_2r:
                return target_2r * sh - row["ibkr_commission"]
            else:
                return actual_move * sh - row["ibkr_commission"]
        else:
            actual_move = row["ibkr_entry_price"] - row["ibkr_exit_price"]
            if actual_move <= -risk:
                return -risk * sh - row["ibkr_commission"]
            elif actual_move >= target_2r:
                return target_2r * sh - row["ibkr_commission"]
            else:
                return actual_move * sh - row["ibkr_commission"]

    closed["whatif_fixed_rr"] = closed.apply(fixed_rr_pnl, axis=1)
    print(f"\n  Scenario 2: YOUR entries + 1R stop / 2R target")
    print(f"    Actual P&L:    ${closed['ibkr_net_pnl'].sum():+,.2f}")
    print(f"    What-if P&L:   ${closed['whatif_fixed_rr'].sum():+,.2f}")
    print(f"    Difference:    ${closed['whatif_fixed_rr'].sum() - closed['ibkr_net_pnl'].sum():+,.2f}")

    # Scenario 3: What if you capped position size at 100 shares?
    def capped_size_pnl(row):
        capped = min(row["ibkr_shares"], 100)
        pnl_per_share = row["ibkr_net_pnl"] / row["ibkr_shares"] if row["ibkr_shares"] > 0 else 0
        return pnl_per_share * capped

    closed["whatif_capped_100"] = closed.apply(capped_size_pnl, axis=1)
    print(f"\n  Scenario 3: Everything same but max 100 shares")
    print(f"    Actual P&L:    ${closed['ibkr_net_pnl'].sum():+,.2f}")
    print(f"    What-if P&L:   ${closed['whatif_capped_100'].sum():+,.2f}")
    print(f"    Difference:    ${closed['whatif_capped_100'].sum() - closed['ibkr_net_pnl'].sum():+,.2f}")

    # Scenario 4: Skip trades where slippage > 2%
    low_slip = closed[closed["entry_slippage_%"].abs() <= 2.0]
    high_slip = closed[closed["entry_slippage_%"].abs() > 2.0]
    print(f"\n  Scenario 4: Skip trades with entry slippage > 2%")
    print(f"    Trades skipped:   {len(high_slip)} ({len(high_slip)/len(closed)*100:.1f}%)")
    print(f"    Skipped P&L:      ${high_slip['ibkr_net_pnl'].sum():+,.2f}")
    print(f"    Remaining P&L:    ${low_slip['ibkr_net_pnl'].sum():+,.2f}")
    print(f"    Actual P&L:       ${closed['ibkr_net_pnl'].sum():+,.2f}")
    print(f"    Improvement:      ${low_slip['ibkr_net_pnl'].sum() - closed['ibkr_net_pnl'].sum():+,.2f}")


def order_type_analysis(df):
    """LMT vs MKT entry performance."""
    section("23. ENTRY ORDER TYPE ANALYSIS")

    closed = df[df["ibkr_status"] == "closed"].copy()
    if "ibkr_entry_order_type" not in closed.columns:
        print("  No order type data."); return

    types = closed["ibkr_entry_order_type"].value_counts()
    print(f"\n  Order type distribution:")
    for ot, c in types.items():
        g = closed[closed["ibkr_entry_order_type"] == ot]
        wr = (g["ibkr_net_pnl"] > 0).mean()
        slip = g["entry_slippage_%"].mean()
        print(f"    {ot:8s} {c:4d} trades  WR {wr:.1%}  avg slip {slip:+.3f}%  avg P&L ${g['ibkr_net_pnl'].mean():+.2f}  total ${g['ibkr_net_pnl'].sum():+,.2f}")


def biggest_trades(df):
    """Pattern comparison: biggest winners vs biggest losers."""
    section("24. BIGGEST WINNERS vs BIGGEST LOSERS")

    closed = df[df["ibkr_status"] == "closed"].copy()

    top_w = closed.nlargest(10, "ibkr_net_pnl")
    top_l = closed.nsmallest(10, "ibkr_net_pnl")

    print(f"\n  --- Top 10 Winners ---")
    print(f"  {'Symbol':8s} {'Dir':>5s} {'P&L':>10s} {'Shares':>7s} {'Hold':>7s} {'Slip%':>7s} {'Strategy':>25s} {'Holly P&L':>10s}")
    for _, r in top_w.iterrows():
        print(f"  {r['symbol']:8s} {r['direction'][:1]:>5s} ${r['ibkr_net_pnl']:+9.2f} {int(r['ibkr_shares']):7d} {r['ibkr_hold_minutes']:6.0f}m {r['entry_slippage_%']:+6.2f}% {r['strategy']:>25s} ${r['holly_pnl']:+9.2f}")

    print(f"\n  --- Top 10 Losers ---")
    print(f"  {'Symbol':8s} {'Dir':>5s} {'P&L':>10s} {'Shares':>7s} {'Hold':>7s} {'Slip%':>7s} {'Strategy':>25s} {'Holly P&L':>10s}")
    for _, r in top_l.iterrows():
        print(f"  {r['symbol']:8s} {r['direction'][:1]:>5s} ${r['ibkr_net_pnl']:+9.2f} {int(r['ibkr_shares']):7d} {r['ibkr_hold_minutes']:6.0f}m {r['entry_slippage_%']:+6.2f}% {r['strategy']:>25s} ${r['holly_pnl']:+9.2f}")

    # Compare patterns
    print(f"\n  --- Pattern comparison ---")
    print(f"  {'Metric':25s} {'Winners':>12s} {'Losers':>12s}")
    print(f"  {'Avg shares':25s} {top_w['ibkr_shares'].mean():12.0f} {top_l['ibkr_shares'].mean():12.0f}")
    print(f"  {'Avg hold (min)':25s} {top_w['ibkr_hold_minutes'].mean():12.0f} {top_l['ibkr_hold_minutes'].mean():12.0f}")
    print(f"  {'Avg entry slip %':25s} {top_w['entry_slippage_%'].mean():+11.2f}% {top_l['entry_slippage_%'].mean():+11.2f}%")
    print(f"  {'Avg Holly P&L':25s} ${top_w['holly_pnl'].mean():+10.2f} ${top_l['holly_pnl'].mean():+10.2f}")
    print(f"  {'Long/Short':25s} {(top_w['direction']=='Long').sum()}L/{(top_w['direction']=='Short').sum()}S {(top_l['direction']=='Long').sum()}L/{(top_l['direction']=='Short').sum()}S")


def commission_analysis(df):
    """Commission breakeven analysis."""
    section("25. COMMISSION & BREAKEVEN ANALYSIS")

    closed = df[df["ibkr_status"] == "closed"].copy()

    gross = closed["ibkr_gross_pnl"].sum()
    comm = closed["ibkr_commission"].sum()
    net = closed["ibkr_net_pnl"].sum()

    print(f"\n  Gross P&L:      ${gross:+,.2f}")
    print(f"  Commission:     ${comm:,.2f}")
    print(f"  Net P&L:        ${net:+,.2f}")
    print(f"  Comm % of gross: {comm / abs(gross) * 100:.1f}%" if gross != 0 else "")

    # How many trades are commission-negative (gross positive but net negative)?
    comm_killed = closed[(closed["ibkr_gross_pnl"] > 0) & (closed["ibkr_net_pnl"] <= 0)]
    print(f"\n  Trades where commission turned a winner into a loser: {len(comm_killed)}")
    if len(comm_killed) > 0:
        print(f"    Total gross given back: ${comm_killed['ibkr_gross_pnl'].sum():+,.2f}")
        print(f"    Avg gross on these: ${comm_killed['ibkr_gross_pnl'].mean():+.2f}")
        for _, r in comm_killed.iterrows():
            print(f"      {r['symbol']:6s} gross ${r['ibkr_gross_pnl']:+.2f} - comm ${r['ibkr_commission']:.2f} = net ${r['ibkr_net_pnl']:+.2f}")

    # Breakeven: how much more per trade to be profitable?
    if net < 0:
        needed = abs(net) / len(closed)
        print(f"\n  To breakeven: need ${needed:+.2f} more per trade")
        print(f"  That's {needed / closed['ibkr_entry_price'].mean() * 100:.3f}% of avg entry price (${closed['ibkr_entry_price'].mean():.2f})")


def main():
    df = load_data()
    print(f"Loaded {len(df)} matched trades for deep analysis (part 2)")

    r_multiple_analysis(df)
    exit_location_analysis(df)
    holly_signal_quality(df)
    repeat_tickers(df)
    multi_trade_days(df)
    price_level_analysis(df)
    streak_analysis(df)
    tilt_detection(df)
    equity_curve(df)
    whatif_scenarios(df)
    order_type_analysis(df)
    biggest_trades(df)
    commission_analysis(df)


if __name__ == "__main__":
    main()
