"""
Deep analysis of IBKR vs Holly trade mapping.

Dimensions:
  1. Exit timing analysis — early exit cost, hold time distribution
  2. Position sizing impact — your size vs Holly 100sh, R-multiple analysis
  3. Strategy-level teardown — which strategies you execute well vs poorly
  4. Win/loss asymmetry — average win vs average loss, expectancy
  5. Time-of-day patterns — when you enter, when you exit, best/worst hours
  6. Slippage by urgency — does entering faster help or hurt?
  7. "What-if" scenarios — if you held to Holly exit, if you used Holly sizing
  8. Day-of-week patterns
  9. Monthly P&L trajectory
  10. Your edge vs Holly edge — where you outperform
"""
import pandas as pd
import numpy as np
from pathlib import Path
from datetime import timedelta
import json
import sys

REPORT_DIR = Path(__file__).parent.parent / "output" / "reports" / "trade_mapping"
OUT = REPORT_DIR / "deep_analysis"


def load_data():
    m = pd.read_csv(REPORT_DIR / "ibkr_holly_matched.csv")
    matched = m[m["category"] == "matched"].copy()
    for col in ["ibkr_entry_time", "ibkr_exit_time", "holly_entry_time", "holly_exit_time"]:
        matched[col] = pd.to_datetime(matched[col], errors="coerce")
    return matched


def section(title):
    print()
    print("=" * 90)
    print(f"  {title}")
    print("=" * 90)


def exit_timing_analysis(df):
    """How early do you exit vs Holly, and what does it cost?"""
    section("1. EXIT TIMING ANALYSIS")

    closed = df[df["ibkr_status"] == "closed"].copy()
    has_holly_exit = closed[closed["holly_exit_time"].notna()].copy()

    if has_holly_exit.empty:
        print("  No trades with Holly exit times."); return {}

    has_holly_exit["exit_delta_min"] = (
        (has_holly_exit["ibkr_exit_time"] - has_holly_exit["holly_exit_time"])
        .dt.total_seconds() / 60
    )
    has_holly_exit["exited_early"] = has_holly_exit["exit_delta_min"] < -5

    early = has_holly_exit[has_holly_exit["exited_early"]]
    late = has_holly_exit[~has_holly_exit["exited_early"]]

    print(f"\n  Trades with Holly exit reference: {len(has_holly_exit)}")
    print(f"  You exited BEFORE Holly: {len(early)} ({len(early)/len(has_holly_exit)*100:.1f}%)")
    print(f"  You exited AFTER Holly:  {len(late)} ({len(late)/len(has_holly_exit)*100:.1f}%)")

    print(f"\n  --- When you exit EARLY ({len(early)} trades) ---")
    print(f"    How early (median):      {abs(early['exit_delta_min'].median()):.0f} min")
    print(f"    Your avg P&L:            ${early['ibkr_net_pnl'].mean():+.2f}")
    print(f"    Holly avg P&L:           ${early['holly_pnl'].mean():+.2f}")
    print(f"    Your win rate:           {(early['ibkr_net_pnl'] > 0).mean():.1%}")
    print(f"    P&L left on table:       ${(early['holly_pnl'] - early['ibkr_net_pnl']).sum():+,.2f}")

    print(f"\n  --- When you hold PAST Holly ({len(late)} trades) ---")
    print(f"    How late (median):       {late['exit_delta_min'].median():.0f} min")
    print(f"    Your avg P&L:            ${late['ibkr_net_pnl'].mean():+.2f}")
    print(f"    Holly avg P&L:           ${late['holly_pnl'].mean():+.2f}")
    print(f"    Your win rate:           {(late['ibkr_net_pnl'] > 0).mean():.1%}")

    # Hold time distribution
    print(f"\n  --- Your hold time distribution ---")
    hold = has_holly_exit["ibkr_hold_minutes"].dropna()
    for pct in [10, 25, 50, 75, 90]:
        print(f"    P{pct}: {hold.quantile(pct/100):.0f} min")

    # Holly hold time
    holly_hold = ((has_holly_exit["holly_exit_time"] - has_holly_exit["holly_entry_time"])
                  .dt.total_seconds() / 60).dropna()
    print(f"\n  --- Holly hold time distribution ---")
    for pct in [10, 25, 50, 75, 90]:
        print(f"    P{pct}: {holly_hold.quantile(pct/100):.0f} min")

    # Early exit on WINNERS specifically
    early_winners = early[early["holly_pnl"] > 0]
    if len(early_winners) > 0:
        print(f"\n  --- Early exits on Holly WINNERS ({len(early_winners)} trades) ---")
        print(f"    Your avg P&L:    ${early_winners['ibkr_net_pnl'].mean():+.2f}")
        print(f"    Holly avg P&L:   ${early_winners['holly_pnl'].mean():+.2f}")
        print(f"    You also won:    {(early_winners['ibkr_net_pnl'] > 0).sum()}/{len(early_winners)}")
        cost = (early_winners["holly_pnl"] - early_winners["ibkr_net_pnl"]).sum()
        print(f"    Cost of cutting: ${cost:+,.2f} total")

    return {
        "early_exit_pct": len(early) / len(has_holly_exit) * 100,
        "early_exit_avg_pnl": early["ibkr_net_pnl"].mean(),
        "late_exit_avg_pnl": late["ibkr_net_pnl"].mean(),
        "early_exit_cost": (early["holly_pnl"] - early["ibkr_net_pnl"]).sum(),
    }


def sizing_analysis(df):
    """Position sizing comparison and impact."""
    section("2. POSITION SIZING IMPACT")

    closed = df[df["ibkr_status"] == "closed"].copy()
    closed["holly_shares"] = closed["holly_shares"].fillna(100)

    print(f"\n  --- Your sizing vs Holly (always 100 sh) ---")
    your = closed["ibkr_shares"]
    print(f"    Your avg shares:    {your.mean():.0f}")
    print(f"    Your median shares: {your.median():.0f}")
    print(f"    Min / Max:          {your.min():.0f} / {your.max():.0f}")

    # Size buckets
    buckets = [
        ("Tiny (1-50 sh)", (1, 50)),
        ("Small (51-100 sh)", (51, 100)),
        ("Medium (101-250 sh)", (101, 250)),
        ("Large (251-500 sh)", (251, 500)),
        ("XL (501+ sh)", (501, 99999)),
    ]
    print(f"\n  --- P&L by your position size ---")
    print(f"  {'Bucket':25s} {'N':>4s} {'Avg P&L':>10s} {'WR':>6s} {'Total':>12s}")
    for label, (lo, hi) in buckets:
        b = closed[(closed["ibkr_shares"] >= lo) & (closed["ibkr_shares"] <= hi)]
        if len(b) == 0:
            continue
        wr = (b["ibkr_net_pnl"] > 0).mean()
        print(f"  {label:25s} {len(b):4d} ${b['ibkr_net_pnl'].mean():+9.2f} {wr:5.1%} ${b['ibkr_net_pnl'].sum():+11,.2f}")

    # Normalized comparison: P&L per share
    closed["pnl_per_share"] = closed["ibkr_net_pnl"] / closed["ibkr_shares"]
    closed["holly_pnl_per_share"] = closed["holly_pnl"] / closed["holly_shares"]

    print(f"\n  --- P&L per share comparison ---")
    print(f"    Your avg P&L/share:   ${closed['pnl_per_share'].mean():+.4f}")
    print(f"    Holly avg P&L/share:  ${closed['holly_pnl_per_share'].mean():+.4f}")
    print(f"    Ratio (you/holly):    {closed['pnl_per_share'].mean() / closed['holly_pnl_per_share'].mean():.2f}x" if closed['holly_pnl_per_share'].mean() != 0 else "")

    # What-if: your entries, Holly's hold time, your sizing
    print(f"\n  --- What-if: your size at Holly P&L/share ---")
    closed["whatif_pnl"] = closed["holly_pnl_per_share"] * closed["ibkr_shares"]
    print(f"    Actual total P&L:     ${closed['ibkr_net_pnl'].sum():+,.2f}")
    print(f"    What-if total:        ${closed['whatif_pnl'].sum():+,.2f}")
    print(f"    Difference:           ${closed['whatif_pnl'].sum() - closed['ibkr_net_pnl'].sum():+,.2f}")


def strategy_teardown(df):
    """Per-strategy deep dive."""
    section("3. STRATEGY-LEVEL TEARDOWN")

    closed = df[df["ibkr_status"] == "closed"].copy()
    if closed.empty:
        return

    print(f"\n  {'Strategy':25s} {'N':>3s} {'Your $':>10s} {'Holly $':>10s} {'Your WR':>8s} {'Holly WR':>8s} {'Avg Hold':>9s} {'Edge':>8s}")
    print("  " + "-" * 85)

    strats = closed.groupby("strategy")
    rows = []
    for strat, g in strats:
        your_pnl = g["ibkr_net_pnl"].sum()
        holly_pnl = g["holly_pnl"].sum()
        your_wr = (g["ibkr_net_pnl"] > 0).mean()
        holly_wr = (g["holly_pnl"] > 0).mean()
        avg_hold = g["ibkr_hold_minutes"].mean()
        edge = "YOU" if your_pnl > holly_pnl else "HOLLY"
        rows.append((strat, len(g), your_pnl, holly_pnl, your_wr, holly_wr, avg_hold, edge))

    rows.sort(key=lambda x: x[2] - x[3], reverse=True)
    for strat, n, yp, hp, ywr, hwr, ah, edge in rows:
        print(f"  {strat:25s} {n:3d} ${yp:+9,.2f} ${hp:+9,.2f} {ywr:7.1%} {hwr:7.1%} {ah:7.0f}m  {edge}")

    # Strategies where you outperform
    your_edge = [r for r in rows if r[2] > r[3]]
    holly_edge = [r for r in rows if r[2] <= r[3]]
    print(f"\n  You beat Holly in {len(your_edge)}/{len(rows)} strategies:")
    for strat, n, yp, hp, *_ in your_edge:
        print(f"    {strat}: you ${yp:+,.2f} vs Holly ${hp:+,.2f} ({n} trades)")


def win_loss_asymmetry(df):
    """Average win vs average loss, expectancy calculation."""
    section("4. WIN/LOSS ASYMMETRY & EXPECTANCY")

    closed = df[df["ibkr_status"] == "closed"].copy()
    if closed.empty:
        return

    wins = closed[closed["ibkr_net_pnl"] > 0]
    losses = closed[closed["ibkr_net_pnl"] <= 0]

    h_wins = closed[closed["holly_pnl"] > 0]
    h_losses = closed[closed["holly_pnl"] <= 0]

    print(f"\n  --- YOUR trades ---")
    print(f"    Win rate:     {len(wins)}/{len(closed)} = {len(wins)/len(closed):.1%}")
    print(f"    Avg win:      ${wins['ibkr_net_pnl'].mean():+.2f}" if len(wins) else "")
    print(f"    Avg loss:     ${losses['ibkr_net_pnl'].mean():+.2f}" if len(losses) else "")
    if len(wins) and len(losses):
        ratio = abs(wins["ibkr_net_pnl"].mean() / losses["ibkr_net_pnl"].mean())
        wr = len(wins) / len(closed)
        expectancy = wr * wins["ibkr_net_pnl"].mean() + (1 - wr) * losses["ibkr_net_pnl"].mean()
        print(f"    Win/Loss ratio: {ratio:.2f}")
        print(f"    Expectancy:     ${expectancy:+.2f} per trade")
        print(f"    Largest win:    ${wins['ibkr_net_pnl'].max():+.2f} ({wins.loc[wins['ibkr_net_pnl'].idxmax(), 'symbol']})")
        print(f"    Largest loss:   ${losses['ibkr_net_pnl'].min():+.2f} ({losses.loc[losses['ibkr_net_pnl'].idxmin(), 'symbol']})")

    print(f"\n  --- HOLLY theoretical ---")
    print(f"    Win rate:     {len(h_wins)}/{len(closed)} = {len(h_wins)/len(closed):.1%}")
    print(f"    Avg win:      ${h_wins['holly_pnl'].mean():+.2f}" if len(h_wins) else "")
    print(f"    Avg loss:     ${h_losses['holly_pnl'].mean():+.2f}" if len(h_losses) else "")
    if len(h_wins) and len(h_losses):
        h_ratio = abs(h_wins["holly_pnl"].mean() / h_losses["holly_pnl"].mean())
        h_wr = len(h_wins) / len(closed)
        h_expectancy = h_wr * h_wins["holly_pnl"].mean() + (1 - h_wr) * h_losses["holly_pnl"].mean()
        print(f"    Win/Loss ratio: {h_ratio:.2f}")
        print(f"    Expectancy:     ${h_expectancy:+.2f} per trade")

    # Concordance: when Holly wins, do you?
    print(f"\n  --- Concordance matrix ---")
    both_win = ((closed["ibkr_net_pnl"] > 0) & (closed["holly_pnl"] > 0)).sum()
    both_lose = ((closed["ibkr_net_pnl"] <= 0) & (closed["holly_pnl"] <= 0)).sum()
    you_win_holly_lose = ((closed["ibkr_net_pnl"] > 0) & (closed["holly_pnl"] <= 0)).sum()
    holly_win_you_lose = ((closed["ibkr_net_pnl"] <= 0) & (closed["holly_pnl"] > 0)).sum()

    print(f"    Both win:              {both_win:3d} ({both_win/len(closed)*100:.1f}%)")
    print(f"    Both lose:             {both_lose:3d} ({both_lose/len(closed)*100:.1f}%)")
    print(f"    You win, Holly loses:  {you_win_holly_lose:3d} ({you_win_holly_lose/len(closed)*100:.1f}%)")
    print(f"    Holly wins, you lose:  {holly_win_you_lose:3d} ({holly_win_you_lose/len(closed)*100:.1f}%)")

    # The "Holly wins, you lose" bucket is where the money is
    if holly_win_you_lose > 0:
        hwyl = closed[(closed["ibkr_net_pnl"] <= 0) & (closed["holly_pnl"] > 0)]
        print(f"\n  --- Holly wins but you lose ({holly_win_you_lose} trades) ---")
        print(f"    Your total:   ${hwyl['ibkr_net_pnl'].sum():+,.2f}")
        print(f"    Holly total:  ${hwyl['holly_pnl'].sum():+,.2f}")
        print(f"    Gap:          ${hwyl['holly_pnl'].sum() - hwyl['ibkr_net_pnl'].sum():+,.2f}")
        print(f"    Avg hold you: {hwyl['ibkr_hold_minutes'].mean():.0f}m")
        print(f"    Worst:")
        worst = hwyl.nsmallest(5, "ibkr_net_pnl")
        for _, r in worst.iterrows():
            print(f"      {r['symbol']:6s} you ${r['ibkr_net_pnl']:+.2f} vs Holly ${r['holly_pnl']:+.2f}  hold {r['ibkr_hold_minutes']:.0f}m  strat={r['strategy']}")


def time_of_day_analysis(df):
    """When do you enter, when do you exit, what works best?"""
    section("5. TIME-OF-DAY PATTERNS")

    closed = df[df["ibkr_status"] == "closed"].copy()
    if closed.empty:
        return

    closed["entry_hour"] = closed["ibkr_entry_time"].dt.hour
    closed["exit_hour"] = closed["ibkr_exit_time"].dt.hour

    print(f"\n  --- Entry hour distribution ---")
    print(f"  {'Hour':>6s} {'N':>4s} {'Avg P&L':>10s} {'WR':>6s} {'Total':>12s}")
    for h in sorted(closed["entry_hour"].unique()):
        g = closed[closed["entry_hour"] == h]
        wr = (g["ibkr_net_pnl"] > 0).mean()
        print(f"  {h:5d}h {len(g):4d} ${g['ibkr_net_pnl'].mean():+9.2f} {wr:5.1%} ${g['ibkr_net_pnl'].sum():+11,.2f}")

    print(f"\n  --- Exit hour distribution ---")
    print(f"  {'Hour':>6s} {'N':>4s} {'Avg P&L':>10s} {'WR':>6s} {'Total':>12s}")
    for h in sorted(closed["exit_hour"].unique()):
        g = closed[closed["exit_hour"] == h]
        wr = (g["ibkr_net_pnl"] > 0).mean()
        print(f"  {h:5d}h {len(g):4d} ${g['ibkr_net_pnl'].mean():+9.2f} {wr:5.1%} ${g['ibkr_net_pnl'].sum():+11,.2f}")

    # First 30 min vs rest of day
    closed["first_30"] = closed["entry_hour"] * 60 + closed["ibkr_entry_time"].dt.minute < 600  # before 10:00
    f30 = closed[closed["first_30"]]
    rest = closed[~closed["first_30"]]
    print(f"\n  --- First 30 min after open (9:30-10:00) vs rest ---")
    if len(f30):
        print(f"    First 30m:  {len(f30)} trades, ${f30['ibkr_net_pnl'].mean():+.2f} avg, {(f30['ibkr_net_pnl']>0).mean():.1%} WR, ${f30['ibkr_net_pnl'].sum():+,.2f} total")
    if len(rest):
        print(f"    Rest of day: {len(rest)} trades, ${rest['ibkr_net_pnl'].mean():+.2f} avg, {(rest['ibkr_net_pnl']>0).mean():.1%} WR, ${rest['ibkr_net_pnl'].sum():+,.2f} total")


def entry_delay_analysis(df):
    """Does entering faster after Holly alert help or hurt?"""
    section("6. ENTRY DELAY ANALYSIS (does speed help?)")

    closed = df[df["ibkr_status"] == "closed"].copy()
    closed["delay_min"] = closed["time_delta_sec"] / 60

    # Bucket by delay
    buckets = [
        ("< 3 hours", 0, 180),
        ("3-4 hours", 180, 240),
        ("4-5 hours", 240, 300),
        ("5+ hours", 300, 9999),
    ]
    print(f"\n  --- P&L by entry delay after Holly alert ---")
    print(f"  {'Delay':15s} {'N':>4s} {'Avg P&L':>10s} {'WR':>6s} {'Avg Slip':>10s} {'Total':>12s}")
    for label, lo, hi in buckets:
        b = closed[(closed["delay_min"] >= lo) & (closed["delay_min"] < hi)]
        if len(b) == 0:
            continue
        wr = (b["ibkr_net_pnl"] > 0).mean()
        slip = b["entry_slippage_%"].mean() if "entry_slippage_%" in b else 0
        print(f"  {label:15s} {len(b):4d} ${b['ibkr_net_pnl'].mean():+9.2f} {wr:5.1%} {slip:+9.2f}% ${b['ibkr_net_pnl'].sum():+11,.2f}")

    # Correlation
    corr = closed[["delay_min", "ibkr_net_pnl"]].dropna().corr().iloc[0, 1]
    print(f"\n  Correlation (delay vs P&L): {corr:+.3f}")
    print(f"  Interpretation: {'faster entry helps' if corr < -0.1 else 'no clear relationship' if abs(corr) < 0.1 else 'slower entry actually better'}")


def slippage_deep_dive(df):
    """Entry slippage breakdown."""
    section("7. ENTRY SLIPPAGE DEEP DIVE")

    closed = df[df["ibkr_status"] == "closed"].copy()
    slip = closed["entry_slippage_%"].dropna()

    print(f"\n  --- Entry slippage distribution ---")
    for pct in [5, 10, 25, 50, 75, 90, 95]:
        print(f"    P{pct:2d}: {slip.quantile(pct/100):+.3f}%")

    # Favorable vs unfavorable
    fav = closed[closed["entry_slippage_%"] < 0]  # got better price
    unfav = closed[closed["entry_slippage_%"] > 0]  # paid more
    neutral = closed[closed["entry_slippage_%"] == 0]

    print(f"\n  Better than Holly price: {len(fav)} ({len(fav)/len(closed)*100:.1f}%) -> avg P&L ${fav['ibkr_net_pnl'].mean():+.2f}")
    print(f"  Same as Holly price:     {len(neutral)} ({len(neutral)/len(closed)*100:.1f}%) -> avg P&L ${neutral['ibkr_net_pnl'].mean():+.2f}" if len(neutral) else "")
    print(f"  Worse than Holly price:  {len(unfav)} ({len(unfav)/len(closed)*100:.1f}%) -> avg P&L ${unfav['ibkr_net_pnl'].mean():+.2f}")

    # By direction
    for d in ["Long", "Short"]:
        g = closed[closed["direction"] == d]
        if g.empty: continue
        s = g["entry_slippage_%"].dropna()
        print(f"\n  {d} entries: mean slip {s.mean():+.3f}%, median {s.median():+.3f}%")


def day_of_week_analysis(df):
    """Day of week patterns."""
    section("8. DAY-OF-WEEK PATTERNS")

    closed = df[df["ibkr_status"] == "closed"].copy()
    closed["dow"] = closed["ibkr_entry_time"].dt.day_name()
    dow_order = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]

    print(f"\n  {'Day':12s} {'N':>4s} {'Avg P&L':>10s} {'WR':>6s} {'Total':>12s} {'Avg Hold':>9s}")
    for day in dow_order:
        g = closed[closed["dow"] == day]
        if len(g) == 0: continue
        wr = (g["ibkr_net_pnl"] > 0).mean()
        print(f"  {day:12s} {len(g):4d} ${g['ibkr_net_pnl'].mean():+9.2f} {wr:5.1%} ${g['ibkr_net_pnl'].sum():+11,.2f} {g['ibkr_hold_minutes'].mean():7.0f}m")


def monthly_trajectory(df):
    """Monthly P&L trajectory."""
    section("9. MONTHLY P&L TRAJECTORY")

    closed = df[df["ibkr_status"] == "closed"].copy()
    closed["month"] = closed["ibkr_entry_time"].dt.to_period("M")

    print(f"\n  {'Month':10s} {'N':>4s} {'Your P&L':>12s} {'Holly P&L':>12s} {'Your WR':>8s} {'Cum You':>12s} {'Cum Holly':>12s}")
    cum_you = 0
    cum_holly = 0
    for month, g in closed.groupby("month"):
        yp = g["ibkr_net_pnl"].sum()
        hp = g["holly_pnl"].sum()
        cum_you += yp
        cum_holly += hp
        wr = (g["ibkr_net_pnl"] > 0).mean()
        print(f"  {str(month):10s} {len(g):4d} ${yp:+11,.2f} ${hp:+11,.2f} {wr:7.1%} ${cum_you:+11,.2f} ${cum_holly:+11,.2f}")


def direction_analysis(df):
    """Long vs Short performance."""
    section("10. LONG vs SHORT BREAKDOWN")

    closed = df[df["ibkr_status"] == "closed"].copy()

    for d in ["Long", "Short"]:
        g = closed[closed["direction"] == d]
        if g.empty: continue
        wins = (g["ibkr_net_pnl"] > 0).sum()
        h_wins = (g["holly_pnl"] > 0).sum()
        print(f"\n  --- {d} ({len(g)} trades) ---")
        print(f"    Your total P&L:   ${g['ibkr_net_pnl'].sum():+,.2f}")
        print(f"    Holly total P&L:  ${g['holly_pnl'].sum():+,.2f}")
        print(f"    Your WR:          {wins}/{len(g)} = {wins/len(g):.1%}")
        print(f"    Holly WR:         {h_wins}/{len(g)} = {h_wins/len(g):.1%}")
        print(f"    Your avg win:     ${g[g['ibkr_net_pnl']>0]['ibkr_net_pnl'].mean():+.2f}" if wins else "")
        print(f"    Your avg loss:    ${g[g['ibkr_net_pnl']<=0]['ibkr_net_pnl'].mean():+.2f}" if len(g)-wins else "")
        print(f"    Avg hold:         {g['ibkr_hold_minutes'].mean():.0f}m")
        print(f"    Avg entry slip:   {g['entry_slippage_%'].mean():+.3f}%")


def your_edge(df):
    """Where you beat Holly."""
    section("11. WHERE YOU BEAT HOLLY")

    closed = df[df["ibkr_status"] == "closed"].copy()
    you_better = closed[closed["ibkr_net_pnl"] > closed["holly_pnl"]]

    print(f"\n  You outperformed Holly on {len(you_better)}/{len(closed)} trades ({len(you_better)/len(closed)*100:.1f}%)")
    if you_better.empty:
        return

    print(f"  Total P&L advantage: ${(you_better['ibkr_net_pnl'] - you_better['holly_pnl']).sum():+,.2f}")
    print(f"\n  Common traits of YOUR winning trades:")
    print(f"    Avg hold time:     {you_better['ibkr_hold_minutes'].mean():.0f}m")
    print(f"    Avg entry slip:    {you_better['entry_slippage_%'].mean():+.3f}%")

    # Direction mix
    for d in ["Long", "Short"]:
        g = you_better[you_better["direction"] == d]
        print(f"    {d}: {len(g)} trades")

    # Strategy mix
    strats = you_better["strategy"].value_counts()
    print(f"\n  Strategies where you beat Holly most often:")
    for s, c in strats.head(5).items():
        total_strat = len(closed[closed["strategy"] == s])
        print(f"    {s}: {c}/{total_strat} trades")

    # Top outperformances
    you_better["your_edge_$"] = you_better["ibkr_net_pnl"] - you_better["holly_pnl"]
    top = you_better.nlargest(5, "your_edge_$")
    print(f"\n  Top 5 outperformances:")
    for _, r in top.iterrows():
        print(f"    {r['symbol']:6s} you ${r['ibkr_net_pnl']:+.2f} vs Holly ${r['holly_pnl']:+.2f} = ${r['your_edge_$']:+.2f} edge  ({r['strategy']})")


def hold_time_vs_pnl(df):
    """Relationship between hold time and P&L."""
    section("12. HOLD TIME vs P&L RELATIONSHIP")

    closed = df[df["ibkr_status"] == "closed"].copy()
    hold = closed["ibkr_hold_minutes"].dropna()

    buckets = [
        ("Scalp (< 5m)", 0, 5),
        ("Quick (5-15m)", 5, 15),
        ("Short (15-30m)", 15, 30),
        ("Medium (30-60m)", 30, 60),
        ("Long (1-2h)", 60, 120),
        ("Extended (2h+)", 120, 99999),
    ]
    print(f"\n  {'Hold time':20s} {'N':>4s} {'Avg P&L':>10s} {'WR':>6s} {'Total':>12s} {'Avg Size':>9s}")
    for label, lo, hi in buckets:
        b = closed[(closed["ibkr_hold_minutes"] >= lo) & (closed["ibkr_hold_minutes"] < hi)]
        if len(b) == 0: continue
        wr = (b["ibkr_net_pnl"] > 0).mean()
        print(f"  {label:20s} {len(b):4d} ${b['ibkr_net_pnl'].mean():+9.2f} {wr:5.1%} ${b['ibkr_net_pnl'].sum():+11,.2f} {b['ibkr_shares'].mean():7.0f}")

    corr = closed[["ibkr_hold_minutes", "ibkr_net_pnl"]].dropna().corr().iloc[0, 1]
    print(f"\n  Correlation (hold time vs P&L): {corr:+.3f}")


def actionable_summary(df):
    """Final actionable insights."""
    section("ACTIONABLE SUMMARY")

    closed = df[df["ibkr_status"] == "closed"].copy()
    has_exit = closed[closed["holly_exit_time"].notna()].copy()

    if not has_exit.empty:
        has_exit["exit_delta_min"] = (
            (has_exit["ibkr_exit_time"] - has_exit["holly_exit_time"]).dt.total_seconds() / 60
        )
        early = has_exit[has_exit["exit_delta_min"] < -5]
        early_winners = early[early["holly_pnl"] > 0]
        early_cost = (early_winners["holly_pnl"] - early_winners["ibkr_net_pnl"]).sum() if len(early_winners) else 0
    else:
        early_cost = 0

    your_total = closed["ibkr_net_pnl"].sum()
    holly_total = closed["holly_pnl"].sum()

    wins = closed[closed["ibkr_net_pnl"] > 0]
    losses = closed[closed["ibkr_net_pnl"] <= 0]
    avg_win = wins["ibkr_net_pnl"].mean() if len(wins) else 0
    avg_loss = abs(losses["ibkr_net_pnl"].mean()) if len(losses) else 1

    print(f"""
  1. BIGGEST LEVER: EXIT TIMING
     You exit too early on winners. Cost of cutting winners short: ${early_cost:+,.2f}
     Your avg winner: ${avg_win:.2f}, Holly avg winner: ${wins['holly_pnl'].mean():.2f}
     -> Try trailing stops or time-based exits instead of discretionary cuts

  2. WIN/LOSS RATIO
     Your W:L ratio: {avg_win/avg_loss:.2f}:1 (need >1.0 for positive expectancy at 50% WR)
     Holly W:L ratio: {abs(closed[closed['holly_pnl']>0]['holly_pnl'].mean() / closed[closed['holly_pnl']<=0]['holly_pnl'].mean()):.2f}:1
     -> Your wins are too small relative to losses

  3. POSITION SIZING
     You vary size (25-1000 sh) while Holly uses flat 100.
     Large positions on losers hurt disproportionately.
     -> Consider consistent sizing until exit discipline improves

  4. COMMISSION DRAG
     ${closed['ibkr_commission'].sum():.2f} total on {len(closed)} trades = ${closed['ibkr_commission'].mean():.2f}/trade
     That's {closed['ibkr_commission'].sum() / abs(your_total) * 100:.1f}% of your gross P&L
""")


def main():
    df = load_data()
    print(f"Loaded {len(df)} matched trades")

    OUT.mkdir(parents=True, exist_ok=True)

    exit_timing_analysis(df)
    sizing_analysis(df)
    strategy_teardown(df)
    win_loss_asymmetry(df)
    time_of_day_analysis(df)
    entry_delay_analysis(df)
    slippage_deep_dive(df)
    day_of_week_analysis(df)
    monthly_trajectory(df)
    direction_analysis(df)
    your_edge(df)
    hold_time_vs_pnl(df)
    actionable_summary(df)


if __name__ == "__main__":
    main()
