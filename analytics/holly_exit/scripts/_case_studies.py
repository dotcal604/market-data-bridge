"""
3 deep-dive case studies: trace your fill-by-fill activity vs Holly's plan.

Case 1: BE (Mighty Mouse) — $4 vs $13,574 (the biggest gap)
Case 2: ZONE (The 5 Day Bounce) — your biggest loss, -$644 on 1000 shares
Case 3: FROG (Breakdown Short) — your biggest win, but Holly made 6x more
"""
import pandas as pd
import duckdb
from pathlib import Path

FILLS_PATH = Path("C:/Users/dotca/Downloads/TradeConfirmations_FULL.csv")
REPORT_DIR = Path(__file__).parent.parent / "output" / "reports" / "trade_mapping"
HOLLY_DB = Path(__file__).parent.parent / "data" / "duckdb" / "holly.ddb"


def load_all():
    # Raw fills — multi-section CSV with no header row
    raw = pd.read_csv(FILLS_PATH, dtype=str, header=None)
    header_mask = raw.iloc[:, 0].str.strip() == "HEADER"
    data_mask = raw.iloc[:, 0].str.strip() == "DATA"
    header_vals = raw[header_mask].iloc[0].values
    col_names = list(header_vals)
    col_names[0] = "_rec"
    col_names[1] = "_sec"
    data_rows = raw[data_mask].copy()
    data_rows.columns = col_names[:len(data_rows.columns)]

    # Holly
    db = duckdb.connect(str(HOLLY_DB), read_only=True)
    holly = db.execute("SELECT * FROM trades ORDER BY entry_time").fetchdf()
    holly["entry_time"] = pd.to_datetime(holly["entry_time"])
    holly["exit_time"] = pd.to_datetime(holly["exit_time"])
    db.close()

    # Matched
    m = pd.read_csv(REPORT_DIR / "ibkr_holly_matched.csv")
    matched = m[m["category"] == "matched"].copy()
    for col in ["ibkr_entry_time", "ibkr_exit_time", "holly_entry_time", "holly_exit_time"]:
        matched[col] = pd.to_datetime(matched[col], errors="coerce")

    return data_rows, holly, matched


def print_fills(fills_df, symbol):
    sf = fills_df[fills_df["Symbol"].str.strip() == symbol].copy()
    if sf.empty:
        print(f"    (no fills found for {symbol})")
        return sf

    # Sort by datetime
    sf["_dt"] = pd.to_datetime(sf["Date/Time"], errors="coerce")
    sf = sf.sort_values("_dt")

    print(f"    {'Date/Time':>22s}  {'B/S':>4s}  {'Qty':>6s}  {'Price':>10s}  {'Code':>10s}  {'Type':>5s}  {'Comm':>8s}  {'Exchange':>10s}")
    for _, f in sf.iterrows():
        dt = str(f.get("Date/Time", "")).strip()
        bs = str(f.get("Buy/Sell", "")).strip()
        qty = str(f.get("Quantity", "")).strip()
        px = str(f.get("Price", "")).strip()
        code = str(f.get("Code", "")).strip()
        ot = str(f.get("OrderType", "")).strip()
        comm = str(f.get("Commission", "")).strip()
        exch = str(f.get("Exchange", "")).strip()
        print(f"    {dt:>22s}  {bs:>4s}  {qty:>6s}  ${px:>9s}  {code:>10s}  {ot:>5s}  ${comm:>7s}  {exch:>10s}")
    return sf


def print_holly(holly_df, symbol, date):
    h_trades = holly_df[
        (holly_df["symbol"] == symbol) &
        (holly_df["entry_time"].dt.date == pd.Timestamp(date).date())
    ]
    if h_trades.empty:
        print(f"    (no Holly alert for {symbol} on {date})")
        return None

    for _, h in h_trades.iterrows():
        risk = abs(h["entry_price"] - h["stop_price"]) if pd.notna(h["stop_price"]) else 0
        gain = 0
        r_mult = 0
        if pd.notna(h["exit_price"]):
            if h["direction"] == "Long":
                gain = h["exit_price"] - h["entry_price"]
            else:
                gain = h["entry_price"] - h["exit_price"]
            r_mult = gain / risk if risk > 0 else 0

        hold_min = 0
        if pd.notna(h["exit_time"]) and pd.notna(h["entry_time"]):
            hold_min = (h["exit_time"] - h["entry_time"]).total_seconds() / 60

        print(f"    Strategy:     {h['strategy']}")
        print(f"    Direction:    {h['direction']}")
        print(f"    Alert time:   {h['entry_time']}")
        print(f"    Entry price:  ${h['entry_price']:.2f}")
        print(f"    Stop price:   ${h['stop_price']:.2f}" if pd.notna(h["stop_price"]) else "    Stop: n/a")
        if pd.notna(h.get("target_price")):
            print(f"    Target price: ${h['target_price']:.2f}")
        print(f"    Risk/share:   ${risk:.2f}")
        if pd.notna(h["exit_time"]):
            print(f"    Exit time:    {h['exit_time']}")
            print(f"    Exit price:   ${h['exit_price']:.2f}")
            print(f"    Hold time:    {hold_min:.0f} min")
            print(f"    P&L/share:    ${gain:+.2f} ({r_mult:+.1f}R)")
        print(f"    Holly P&L:    ${h['holly_pnl']:.2f} on {int(h['shares'])} shares")
        print(f"    MFE (cents):  {h['mfe']}")
        print(f"    MAE (cents):  {h['mae']}")
    return h_trades.iloc[0]


def case_study(fills_df, holly_df, matched_df, symbol, date, case_num, title, subtitle):
    print()
    print("=" * 100)
    print(f"  CASE {case_num}: {symbol} -- {title}")
    print(f"  {subtitle}")
    print("=" * 100)

    # Get matched record
    mr = matched_df[matched_df["symbol"] == symbol]
    if not mr.empty:
        mr = mr.iloc[0]
    else:
        mr = None

    # ── Holly Alert ──
    print(f"\n  HOLLY ALERT:")
    h = print_holly(holly_df, symbol, date)

    # ── Your Fills ──
    print(f"\n  YOUR IBKR FILLS:")
    sf = print_fills(fills_df, symbol)

    # ── Timeline ──
    if mr is not None and h is not None:
        print(f"\n  MINUTE-BY-MINUTE TIMELINE:")
        events = []

        # Holly alert
        events.append((h["entry_time"], "HOLLY", f"Alert fires: {h['strategy']} {h['direction']} @ ${h['entry_price']:.2f}, stop ${h['stop_price']:.2f}"))

        # Your fills
        if not sf.empty:
            for _, f in sf.iterrows():
                dt = pd.to_datetime(f.get("Date/Time", ""), errors="coerce")
                if pd.isna(dt):
                    continue
                bs = str(f.get("Buy/Sell", "")).strip()
                qty = str(f.get("Quantity", "")).strip()
                px = str(f.get("Price", "")).strip()
                code = str(f.get("Code", "")).strip()
                exch = str(f.get("Exchange", "")).strip()
                events.append((dt, "YOU", f"{bs} {qty} sh @ ${px} ({code}) on {exch}"))

        # Holly exit
        if pd.notna(h["exit_time"]):
            events.append((h["exit_time"], "HOLLY", f"Exits @ ${h['exit_price']:.2f}"))

        events.sort(key=lambda x: x[0])
        prev_t = None
        for t, who, desc in events:
            gap = ""
            if prev_t is not None:
                delta_min = (t - prev_t).total_seconds() / 60
                if delta_min > 1:
                    gap_str = ""
                    if delta_min > 60:
                        gap_str = f"{delta_min/60:.1f} hours"
                    else:
                        gap_str = f"{delta_min:.0f} min"
                    print(f"{'':>28s}  ... {gap_str} pass ...")
            tag = "[HOLLY]" if who == "HOLLY" else "[ YOU ]"
            print(f"    {t.strftime('%H:%M:%S'):>10s}  {tag}  {desc}")
            prev_t = t

    # ── Analysis ──
    if mr is not None and h is not None:
        print(f"\n  ANALYSIS:")

        # Entry comparison
        entry_slip = mr["ibkr_entry_price"] - h["entry_price"]
        entry_slip_pct = entry_slip / h["entry_price"] * 100
        delay = mr["time_delta_sec"] / 60

        print(f"    Entry delay:     {delay:.0f} min after Holly alert")
        print(f"    Entry slippage:  ${entry_slip:+.4f} ({entry_slip_pct:+.2f}%)")

        risk = abs(h["entry_price"] - h["stop_price"])
        if risk > 0:
            print(f"    Slippage in R:   {entry_slip/risk:+.2f}R of Holly's risk")

        # Your hold
        print(f"    Your hold:       {mr['ibkr_hold_minutes']:.0f} min")
        if pd.notna(h["exit_time"]) and pd.notna(h["entry_time"]):
            holly_hold = (h["exit_time"] - h["entry_time"]).total_seconds() / 60
            print(f"    Holly hold:      {holly_hold:.0f} min")
            print(f"    Hold ratio:      {mr['ibkr_hold_minutes']/holly_hold*100:.1f}% of Holly's hold")

        # Exit comparison
        print(f"    Your exit:       ${mr['ibkr_exit_price']:.2f}")
        if pd.notna(h["exit_price"]):
            print(f"    Holly exit:      ${h['exit_price']:.2f}")
            if h["direction"] == "Long":
                your_capture = mr["ibkr_exit_price"] - mr["ibkr_entry_price"]
                holly_capture = h["exit_price"] - h["entry_price"]
            else:
                your_capture = mr["ibkr_entry_price"] - mr["ibkr_exit_price"]
                holly_capture = h["entry_price"] - h["exit_price"]
            if holly_capture != 0:
                print(f"    Move captured:   ${your_capture:+.2f}/share (you) vs ${holly_capture:+.2f}/share (Holly)")
                print(f"    Capture ratio:   {your_capture/holly_capture*100:.1f}%")

        # Stop analysis
        if pd.notna(h["stop_price"]):
            if h["direction"] == "Long":
                breached = mr["ibkr_exit_price"] < h["stop_price"]
            else:
                breached = mr["ibkr_exit_price"] > h["stop_price"]
            if breached:
                over = abs(mr["ibkr_exit_price"] - h["stop_price"])
                print(f"    STOP BREACHED:   You exited ${over:.2f} PAST Holly's stop")
                print(f"                     Stop was ${h['stop_price']:.2f}, you exited ${mr['ibkr_exit_price']:.2f}")
                would_have = risk * mr["ibkr_shares"] + mr["ibkr_commission"]
                print(f"                     If stopped at Holly's level: -${would_have:.2f}")
                print(f"                     Actual loss: ${mr['ibkr_net_pnl']:+.2f}")
                print(f"                     Extra damage from ignoring stop: ${abs(mr['ibkr_net_pnl']) - would_have:+.2f}")

        # P&L
        print(f"\n    YOUR P&L:        ${mr['ibkr_net_pnl']:+.2f} ({int(mr['ibkr_shares'])} shares, ${mr['ibkr_commission']:.2f} commission)")
        if pd.notna(mr["holly_pnl"]):
            print(f"    HOLLY P&L:       ${mr['holly_pnl']:+.2f} ({int(mr['holly_shares'])} shares)")

        # What-ifs
        print(f"\n  WHAT-IF:")
        if pd.notna(h["exit_price"]):
            if h["direction"] == "Long":
                wif_pnl = (h["exit_price"] - mr["ibkr_entry_price"]) * mr["ibkr_shares"] - mr["ibkr_commission"]
            else:
                wif_pnl = (mr["ibkr_entry_price"] - h["exit_price"]) * mr["ibkr_shares"] - mr["ibkr_commission"]
            print(f"    Your entry + your size + Holly exit: ${wif_pnl:+,.2f}")
            wif100 = (h["exit_price"] - mr["ibkr_entry_price"]) * 100 if h["direction"] == "Long" else (mr["ibkr_entry_price"] - h["exit_price"]) * 100
            print(f"    Your entry + 100 sh + Holly exit:    ${wif100:+,.2f}")

        if pd.notna(h["stop_price"]) and risk > 0:
            target_2r = mr["ibkr_entry_price"] + (2 * risk) if h["direction"] == "Long" else mr["ibkr_entry_price"] - (2 * risk)
            wif_2r = 2 * risk * mr["ibkr_shares"] - mr["ibkr_commission"]
            print(f"    Your entry + your size + 2R target (${target_2r:.2f}): ${wif_2r:+,.2f}")


def main():
    data_rows, holly, matched = load_all()

    # CASE 1: BE — Mighty Mouse Long, $4 vs $13,574
    case_study(data_rows, holly, matched, "BE", "2025-07-09", 1,
               "Bloom Energy (Mighty Mouse Long)",
               "Your P&L: +$4.14 | Holly P&L: +$13,574 | Gap: $13,570 | 3 min hold")

    # CASE 2: ZONE — The 5 Day Bounce Long, -$644 on 1000 shares
    case_study(data_rows, holly, matched, "ZONE", "2025-09-04", 2,
               "ZoneOmics (The 5 Day Bounce Long)",
               "Your P&L: -$643.67 | Holly P&L: -$11.58 | 1000 shares, blew through stop")

    # CASE 3: FROG — Breakdown Short, your biggest $ win but Holly 6x more
    case_study(data_rows, holly, matched, "FROG", "2026-02-13", 3,
               "JFrog (Breakdown Short)",
               "Your P&L: +$235.98 | Holly P&L: +$1,450 | Your best trade, but you left $1,214 on table")


if __name__ == "__main__":
    main()
