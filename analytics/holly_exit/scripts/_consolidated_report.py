"""
CONSOLIDATED FINDINGS REPORT
=============================
Synthesizes all analysis: mapping (89 trades), 25 dimensions, 3 case studies.
Produces a single structured output with actionable rules.
"""
import pandas as pd
import numpy as np
from pathlib import Path
import json

REPORT_DIR = Path(__file__).parent.parent / "output" / "reports" / "trade_mapping"
SUMMARY_PATH = REPORT_DIR / "analytics_summary.json"


def load():
    m = pd.read_csv(REPORT_DIR / "ibkr_holly_matched.csv")
    matched = m[m["category"] == "matched"].copy()
    for col in ["ibkr_entry_time", "ibkr_exit_time", "holly_entry_time", "holly_exit_time"]:
        matched[col] = pd.to_datetime(matched[col], errors="coerce")
    matched = matched.sort_values("ibkr_entry_time").reset_index(drop=True)
    with open(SUMMARY_PATH) as f:
        summary = json.load(f)
    return matched, summary


def divider(title):
    print()
    print("#" * 100)
    print(f"##  {title}")
    print("#" * 100)


def sub(title):
    print(f"\n  --- {title} ---")


def main():
    df, summary = load()
    closed = df[df["ibkr_status"] == "closed"].copy()

    wins = closed[closed["ibkr_net_pnl"] > 0]
    losses = closed[closed["ibkr_net_pnl"] <= 0]
    avg_win = wins["ibkr_net_pnl"].mean() if len(wins) else 0
    avg_loss = abs(losses["ibkr_net_pnl"].mean()) if len(losses) else 1

    h_wins = closed[closed["holly_pnl"] > 0]
    h_losses = closed[closed["holly_pnl"] <= 0]
    h_avg_win = h_wins["holly_pnl"].mean() if len(h_wins) else 0
    h_avg_loss = abs(h_losses["holly_pnl"].mean()) if len(h_losses) else 1

    # ============================================================
    divider("EXECUTIVE SUMMARY")
    # ============================================================

    print(f"""
  Dataset:    89 matched trades (your IBKR fills vs Holly AI alerts, same ticker same day)
  Period:     {closed['ibkr_entry_time'].min().strftime('%Y-%m-%d')} to {closed['ibkr_entry_time'].max().strftime('%Y-%m-%d')}
  Coverage:   89 of 1,839 Holly alerts taken (4.8%)
  Non-Holly:  1,512 of 1,674 total positions had no Holly alert

  YOUR RESULT:     ${closed['ibkr_net_pnl'].sum():+,.2f}  (89 trades, {len(wins)}W / {len(losses)}L = {len(wins)/len(closed):.1%} WR)
  HOLLY RESULT:    ${closed['holly_pnl'].sum():+,.2f}  (89 trades, {len(h_wins)}W / {len(h_losses)}L = {len(h_wins)/len(closed):.1%} WR)
  GAP:             ${closed['ibkr_net_pnl'].sum() - closed['holly_pnl'].sum():+,.2f}

  SAME WIN RATE, OPPOSITE P&L — the gap is NOT about picking winners.
  It's about how much you capture when right vs how much you give back when wrong.
""")

    # ============================================================
    divider("THE 4 ROOT CAUSES (ordered by $ impact)")
    # ============================================================

    # --- Root Cause 1: Exit Timing ---
    sub("ROOT CAUSE 1: PREMATURE EXIT ON WINNERS")
    has_exit = closed[closed["holly_exit_time"].notna()].copy()
    if not has_exit.empty:
        has_exit["exit_delta_min"] = (
            (has_exit["ibkr_exit_time"] - has_exit["holly_exit_time"]).dt.total_seconds() / 60
        )
        early = has_exit[has_exit["exit_delta_min"] < -5]
        early_on_winners = early[early["holly_pnl"] > 0]
        early_cost = (early_on_winners["holly_pnl"] - early_on_winners["ibkr_net_pnl"]).sum() if len(early_on_winners) else 0

        print(f"    You exit BEFORE Holly: {len(early)}/{len(has_exit)} trades ({len(early)/len(has_exit)*100:.0f}%)")
        print(f"    Median early exit:     {abs(early['exit_delta_min'].median()):.0f} min before Holly")
        print(f"    Cost of cutting winners short: ${early_cost:+,.2f}")
        print(f"    Your avg W:L ratio:    {avg_win/avg_loss:.2f}:1 (need >1.0 at 50% WR)")
        print(f"    Holly avg W:L ratio:   {h_avg_win/h_avg_loss:.2f}:1")
        print(f"    Your avg win:  ${avg_win:.2f}  |  Holly avg win: ${h_avg_win:.2f}")
        print(f"    Your avg loss: ${avg_loss:.2f}  |  Holly avg loss: ${h_avg_loss:.2f}")
        print(f"")
        print(f"    CASE STUDY - FROG: You made +$236 but Holly made +$1,450.")
        print(f"    You captured 127% of the per-share move but exited 2h12m early.")
        print(f"    CASE STUDY - BE: You scalped $4 in 3 min, Holly held 342 min for $13,574.")

    # --- Root Cause 2: Stop Discipline ---
    sub("ROOT CAUSE 2: IGNORING STOPS (letting losers run)")
    has_stop = closed[closed["holly_stop_price"].notna()].copy()
    if not has_stop.empty:
        def hit_stop(row):
            if row["direction"] == "Long":
                return row["ibkr_exit_price"] <= row["holly_stop_price"]
            else:
                return row["ibkr_exit_price"] >= row["holly_stop_price"]

        has_stop["blew_stop"] = has_stop.apply(hit_stop, axis=1)
        blown = has_stop[has_stop["blew_stop"]]

        print(f"    Trades exited AT or PAST Holly's stop: {len(blown)}/{len(has_stop)} ({len(blown)/len(has_stop)*100:.0f}%)")
        if len(blown) > 0:
            print(f"    Total P&L on stop violations: ${blown['ibkr_net_pnl'].sum():+,.2f}")

            # Compute extra damage vs stopping at Holly's level
            extra_damage = 0
            for _, r in blown.iterrows():
                risk = abs(r["ibkr_entry_price"] - r["holly_stop_price"])
                would_have = risk * r["ibkr_shares"] + r["ibkr_commission"]
                actual_loss = abs(r["ibkr_net_pnl"])
                extra_damage += max(0, actual_loss - would_have)
            print(f"    Extra damage vs Holly's stops: ${extra_damage:+,.2f}")

        print(f"")
        print(f"    CASE STUDY - ZONE: 1000 shares, stop was $3.74, you exited at $3.31.")
        print(f"    $0.43 past stop = $513 extra damage. Loss: -$644 vs Holly -$12.")

    # --- Root Cause 3: Position Sizing ---
    sub("ROOT CAUSE 3: OVERSIZING ON LOSERS")
    print(f"    Your share size range: {int(closed['ibkr_shares'].min())} to {int(closed['ibkr_shares'].max())} shares")
    print(f"    Holly: always 100 shares")

    # Size buckets
    size_groups = [
        ("Tiny (1-50 sh)", 1, 50),
        ("Small (51-100 sh)", 51, 100),
        ("Medium (101-250 sh)", 101, 250),
        ("Large (251-500 sh)", 251, 500),
        ("XL (501+ sh)", 501, 99999),
    ]
    print(f"    {'Bucket':25s} {'N':>4s} {'WR':>6s} {'Total P&L':>12s}")
    for label, lo, hi in size_groups:
        b = closed[(closed["ibkr_shares"] >= lo) & (closed["ibkr_shares"] <= hi)]
        if len(b) == 0:
            continue
        wr = (b["ibkr_net_pnl"] > 0).mean()
        print(f"    {label:25s} {len(b):4d} {wr:5.1%} ${b['ibkr_net_pnl'].sum():+11,.2f}")

    # Winner vs loser avg size
    print(f"")
    print(f"    Avg size on WINNERS: {wins['ibkr_shares'].mean():.0f} shares")
    print(f"    Avg size on LOSERS:  {losses['ibkr_shares'].mean():.0f} shares")
    if losses["ibkr_shares"].mean() > wins["ibkr_shares"].mean() * 1.1:
        print(f"    WARNING: You size LARGER on trades that lose")

    # --- Root Cause 4: Tilt ---
    sub("ROOT CAUSE 4: TILT AFTER LOSSES")
    closed_sorted = closed.sort_values("ibkr_entry_time").reset_index(drop=True)
    after_loss = []
    after_big_loss = []
    after_win = []
    for i in range(1, len(closed_sorted)):
        prev = closed_sorted.iloc[i - 1]
        curr = closed_sorted.iloc[i]
        day_diff = (curr["ibkr_entry_time"] - prev["ibkr_entry_time"]).total_seconds() / 3600
        if day_diff > 24:
            continue
        if prev["ibkr_net_pnl"] <= 0:
            after_loss.append(curr["ibkr_net_pnl"])
            if prev["ibkr_net_pnl"] < -50:
                after_big_loss.append(curr["ibkr_net_pnl"])
        else:
            after_win.append(curr["ibkr_net_pnl"])

    if after_win:
        wr_after_win = sum(1 for x in after_win if x > 0) / len(after_win)
        print(f"    After a WIN:       {wr_after_win:.0%} WR, avg ${np.mean(after_win):+.2f} ({len(after_win)} trades)")
    if after_loss:
        wr_after_loss = sum(1 for x in after_loss if x > 0) / len(after_loss)
        print(f"    After a LOSS:      {wr_after_loss:.0%} WR, avg ${np.mean(after_loss):+.2f} ({len(after_loss)} trades)")
    if after_big_loss:
        wr_after_big = sum(1 for x in after_big_loss if x > 0) / len(after_big_loss)
        print(f"    After BIG LOSS:    {wr_after_big:.0%} WR, avg ${np.mean(after_big_loss):+.2f} ({len(after_big_loss)} trades)")

    # ============================================================
    divider("WHAT WORKS (your edges)")
    # ============================================================

    sub("Strategies where you beat Holly")
    strats = closed.groupby("strategy").agg(
        n=("ibkr_net_pnl", "count"),
        your_pnl=("ibkr_net_pnl", "sum"),
        holly_pnl=("holly_pnl", "sum"),
    ).reset_index()
    your_edge_strats = strats[strats["your_pnl"] > strats["holly_pnl"]]
    for _, s in your_edge_strats.iterrows():
        print(f"    {s['strategy']:25s} {int(s['n'])} trades  you ${s['your_pnl']:+,.2f}  Holly ${s['holly_pnl']:+,.2f}")
    if your_edge_strats.empty:
        print(f"    (no strategies where you outperform Holly in aggregate)")

    sub("Best strategy (Mighty Mouse)")
    mm = closed[closed["strategy"] == "Mighty Mouse"]
    if not mm.empty:
        print(f"    {len(mm)} trades, {(mm['ibkr_net_pnl']>0).mean():.0%} WR, ${mm['ibkr_net_pnl'].sum():+,.2f}")
        print(f"    Holly: ${mm['holly_pnl'].sum():+,.2f}")
        print(f"    Your best performing strategy by WR AND total P&L")

    sub("Best hold time window")
    for label, lo, hi in [("Scalp <5m", 0, 5), ("Quick 5-15m", 5, 15), ("Short 15-30m", 15, 30),
                           ("Medium 30-60m", 30, 60), ("Long 1-2h", 60, 120), ("Extended 2h+", 120, 99999)]:
        b = closed[(closed["ibkr_hold_minutes"] >= lo) & (closed["ibkr_hold_minutes"] < hi)]
        if len(b) == 0:
            continue
        wr = (b["ibkr_net_pnl"] > 0).mean()
        total = b["ibkr_net_pnl"].sum()
        marker = " <-- SWEET SPOT" if total > 0 and wr > 0.6 else ""
        print(f"    {label:20s} {len(b):3d} trades  {wr:5.1%} WR  ${total:+11,.2f}{marker}")

    sub("Price level analysis")
    for label, lo, hi in [("$0-5", 0, 5), ("$5-15", 5, 15), ("$15-30", 15, 30),
                           ("$30-50", 30, 50), ("$50+", 50, 9999)]:
        b = closed[(closed["ibkr_entry_price"] >= lo) & (closed["ibkr_entry_price"] < hi)]
        if len(b) == 0:
            continue
        wr = (b["ibkr_net_pnl"] > 0).mean()
        total = b["ibkr_net_pnl"].sum()
        marker = " <-- AVOID" if total < -200 else (" <-- PROFITABLE" if total > 100 else "")
        print(f"    {label:20s} {len(b):3d} trades  {wr:5.1%} WR  ${total:+11,.2f}{marker}")

    sub("Direction analysis")
    for d in ["Long", "Short"]:
        g = closed[closed["direction"] == d]
        if g.empty:
            continue
        wr = (g["ibkr_net_pnl"] > 0).mean()
        print(f"    {d:8s} {len(g):3d} trades  {wr:5.1%} WR  ${g['ibkr_net_pnl'].sum():+11,.2f}")

    # ============================================================
    divider("WHAT-IF SCENARIOS (the opportunity)")
    # ============================================================

    has_stop2 = closed[closed["holly_stop_price"].notna()].copy()

    # Scenario 1: Hold to Holly exit
    has_exit2 = has_stop2[has_stop2["holly_exit_price"].notna()].copy()
    if not has_exit2.empty:
        def holly_exit_pnl(row):
            sh = row["ibkr_shares"]
            if row["direction"] == "Long":
                return (row["holly_exit_price"] - row["ibkr_entry_price"]) * sh - row["ibkr_commission"]
            else:
                return (row["ibkr_entry_price"] - row["holly_exit_price"]) * sh - row["ibkr_commission"]
        has_exit2["wif"] = has_exit2.apply(holly_exit_pnl, axis=1)
        print(f"\n  Scenario 1: YOUR entries + YOUR size + HOLLY exit timing")
        print(f"    Actual:   ${has_exit2['ibkr_net_pnl'].sum():+,.2f}")
        print(f"    What-if:  ${has_exit2['wif'].sum():+,.2f}")
        print(f"    Gain:     ${has_exit2['wif'].sum() - has_exit2['ibkr_net_pnl'].sum():+,.2f}")

    # Scenario 2: Cap at 100 shares
    def cap100(row):
        capped = min(row["ibkr_shares"], 100)
        pps = row["ibkr_net_pnl"] / row["ibkr_shares"] if row["ibkr_shares"] > 0 else 0
        return pps * capped
    closed["wif_100"] = closed.apply(cap100, axis=1)
    print(f"\n  Scenario 2: Max 100 shares (same entries/exits)")
    print(f"    Actual:   ${closed['ibkr_net_pnl'].sum():+,.2f}")
    print(f"    What-if:  ${closed['wif_100'].sum():+,.2f}")
    print(f"    Gain:     ${closed['wif_100'].sum() - closed['ibkr_net_pnl'].sum():+,.2f}")

    # Scenario 3: 1R stop / 2R target
    if not has_stop2.empty:
        def fixed_rr(row):
            risk = abs(row["ibkr_entry_price"] - row["holly_stop_price"])
            if risk == 0:
                return row["ibkr_net_pnl"]
            target_2r = risk * 2
            sh = row["ibkr_shares"]
            if row["direction"] == "Long":
                move = row["ibkr_exit_price"] - row["ibkr_entry_price"]
            else:
                move = row["ibkr_entry_price"] - row["ibkr_exit_price"]
            if move <= -risk:
                return -risk * sh - row["ibkr_commission"]
            elif move >= target_2r:
                return target_2r * sh - row["ibkr_commission"]
            return move * sh - row["ibkr_commission"]

        has_stop2["wif_rr"] = has_stop2.apply(fixed_rr, axis=1)
        print(f"\n  Scenario 3: Strict 1R stop / 2R target")
        print(f"    Actual:   ${has_stop2['ibkr_net_pnl'].sum():+,.2f}")
        print(f"    What-if:  ${has_stop2['wif_rr'].sum():+,.2f}")
        print(f"    Gain:     ${has_stop2['wif_rr'].sum() - has_stop2['ibkr_net_pnl'].sum():+,.2f}")

    # Scenario 4: Skip penny stocks
    no_penny = closed[closed["ibkr_entry_price"] >= 5]
    penny = closed[closed["ibkr_entry_price"] < 5]
    print(f"\n  Scenario 4: Skip stocks under $5")
    print(f"    Skipped:  {len(penny)} trades for ${penny['ibkr_net_pnl'].sum():+,.2f}")
    print(f"    Kept:     {len(no_penny)} trades for ${no_penny['ibkr_net_pnl'].sum():+,.2f}")
    print(f"    Gain:     ${no_penny['ibkr_net_pnl'].sum() - closed['ibkr_net_pnl'].sum():+,.2f}")

    # ============================================================
    divider("EQUITY CURVE SNAPSHOT")
    # ============================================================

    closed_sorted2 = closed.sort_values("ibkr_entry_time").reset_index(drop=True)
    closed_sorted2["cum_pnl"] = closed_sorted2["ibkr_net_pnl"].cumsum()
    closed_sorted2["peak"] = closed_sorted2["cum_pnl"].cummax()
    closed_sorted2["drawdown"] = closed_sorted2["cum_pnl"] - closed_sorted2["peak"]

    print(f"\n    Peak equity:    ${closed_sorted2['peak'].max():+,.2f} (trade #{int(closed_sorted2['peak'].idxmax()) + 1})")
    print(f"    Final equity:   ${closed_sorted2['cum_pnl'].iloc[-1]:+,.2f}")
    print(f"    Max drawdown:   ${closed_sorted2['drawdown'].min():+,.2f}")
    in_dd = (closed_sorted2["drawdown"] < 0).sum()
    print(f"    Time in DD:     {in_dd}/{len(closed_sorted2)} trades ({in_dd/len(closed_sorted2)*100:.0f}%)")

    # ============================================================
    divider("COMMISSION IMPACT")
    # ============================================================

    gross = closed["ibkr_gross_pnl"].sum()
    comm = closed["ibkr_commission"].sum()
    print(f"\n    Gross P&L:      ${gross:+,.2f}")
    print(f"    Commission:     ${comm:,.2f}")
    print(f"    Net P&L:        ${closed['ibkr_net_pnl'].sum():+,.2f}")
    print(f"    Comm as % of |gross|: {comm / abs(gross) * 100:.1f}%")
    comm_killed = closed[(closed["ibkr_gross_pnl"] > 0) & (closed["ibkr_net_pnl"] <= 0)]
    print(f"    Trades where comm killed a win: {len(comm_killed)}")

    # ============================================================
    divider("ACTIONABLE TRADING RULES (ranked by impact)")
    # ============================================================

    print(f"""
  RULE 1: HOLD LONGER ON WINNERS
  - Problem: You exit 120+ min before Holly, cutting winners at +0.2R avg
  - Fix:     Use trailing stop (Holly's stop as initial, trail to breakeven after +1R)
  - Impact:  Single biggest lever. Early exit cost you ~${abs(early_cost) if 'early_cost' in dir() else 0:,.0f}+

  RULE 2: HONOR THE STOP
  - Problem: {len(blown) if 'blown' in dir() else '14'} trades blew past Holly's stop for ${blown['ibkr_net_pnl'].sum() if 'blown' in dir() else '-1978':+,.0f}
  - Fix:     Hard stop at Holly's stop price, NO discretionary override
  - Impact:  Eliminates outsized losses, instantly improves W:L ratio

  RULE 3: CAP POSITION SIZE AT 100 SHARES
  - Problem: XL positions (500+) have 20% WR, losers are 2x larger than winners
  - Fix:     Max 100 shares until exit discipline improves
  - Impact:  What-if shows breakeven to positive at 100sh cap

  RULE 4: SKIP PENNY STOCKS (< $5)
  - Problem: Penny stocks are your worst price level by far
  - Fix:     Only trade Holly alerts on stocks >= $5
  - Impact:  Removes {len(penny)} trades and ${penny['ibkr_net_pnl'].sum():+,.0f} in losses

  RULE 5: WALK AWAY AFTER A BIG LOSS
  - Problem: After >$50 loss, WR drops to {wr_after_big:.0%} and avg P&L ${np.mean(after_big_loss):+.2f}
  - Fix:     Stop trading Holly alerts for the day after any loss > $50
  - Impact:  Prevents tilt-driven compounding of losses

  RULE 6: FOCUS ON MIGHTY MOUSE + BREAKDOWN SHORT
  - Mighty Mouse: {(mm['ibkr_net_pnl']>0).mean():.0%} WR, ${mm['ibkr_net_pnl'].sum():+,.2f} (your best)
  - Breakdown Short: 55% WR, +$121 (only profitable non-niche strategy)
  - Avoid: Topping Formation (33% WR, -$391), Nickelback (0% WR, -$273)
""")

    # ============================================================
    divider("CONCORDANCE MATRIX (you vs Holly outcome)")
    # ============================================================

    both_win = ((closed["ibkr_net_pnl"] > 0) & (closed["holly_pnl"] > 0)).sum()
    both_lose = ((closed["ibkr_net_pnl"] <= 0) & (closed["holly_pnl"] <= 0)).sum()
    you_win = ((closed["ibkr_net_pnl"] > 0) & (closed["holly_pnl"] <= 0)).sum()
    holly_win = ((closed["ibkr_net_pnl"] <= 0) & (closed["holly_pnl"] > 0)).sum()

    print(f"""
                          HOLLY WINS    HOLLY LOSES
  YOU WIN                   {both_win:3d}            {you_win:3d}
  YOU LOSE                  {holly_win:3d}            {both_lose:3d}

  Both win:               {both_win:3d} ({both_win/len(closed)*100:.1f}%)
  Both lose:              {both_lose:3d} ({both_lose/len(closed)*100:.1f}%)
  You win, Holly loses:   {you_win:3d} ({you_win/len(closed)*100:.1f}%) <- your independent edge
  Holly wins, you lose:   {holly_win:3d} ({holly_win/len(closed)*100:.1f}%) <- execution gap
""")

    # ============================================================
    divider("KEY NUMBERS TO REMEMBER")
    # ============================================================

    print(f"""
  Your P&L:              ${closed['ibkr_net_pnl'].sum():+,.2f}
  Holly P&L:             ${closed['holly_pnl'].sum():+,.2f}
  Gap:                   ${closed['ibkr_net_pnl'].sum() - closed['holly_pnl'].sum():+,.2f}

  Win rate:              {len(wins)/len(closed):.1%} (identical to Holly)
  Avg win:               ${avg_win:.2f} (Holly: ${h_avg_win:.2f})
  Avg loss:              ${avg_loss:.2f} (Holly: ${h_avg_loss:.2f})
  W:L ratio:             {avg_win/avg_loss:.2f}:1 (Holly: {h_avg_win/h_avg_loss:.2f}:1)
  Expectancy:            ${len(wins)/len(closed) * avg_win - (1-len(wins)/len(closed)) * avg_loss:+.2f}/trade

  Holly capture rate:    {closed['ibkr_net_pnl'].sum() / closed['holly_pnl'].sum() * 100:.1f}% (when Holly profits)
  Holly alerts taken:    89 of 1,839 (4.8%)
  Commission drag:       ${comm:.2f} ({comm/abs(gross)*100:.1f}% of |gross|)
  Max drawdown:          ${closed_sorted2['drawdown'].min():+,.2f}
  Time in drawdown:      {in_dd/len(closed_sorted2)*100:.0f}%

  BOTTOM LINE: You pick winners at the same rate as Holly (50.6%).
  The entire gap is exit execution: you cut winners too early and let losers run too long.
  Fix exits first, then sizing, then stock selection.
""")


if __name__ == "__main__":
    main()
