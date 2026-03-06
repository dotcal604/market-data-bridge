# Holly AI Trade Data Dictionary

> **Source:** Trade Ideas Holly AI Strategy Trades Window export
> **Format:** CSV (raw) or XLSX (cleaned)
> **Granularity:** One row per Holly trade (entry → exit)
> **Note:** Trade Ideas does not publish official column definitions. These definitions were reverse-engineered from 10,500+ trades with mathematical verification against actual data. Fields marked ⚠️ have unverified or uncertain definitions.

---

## Core Trade Fields

| Column | Type | Description |
|--------|------|-------------|
| **Entry Time** | datetime | Timestamp when Holly entered the trade (Eastern Time). In raw CSV exports this uses Trade Ideas' non-standard format: `YYYY,Mon,DD,"HH:MM:SS,YYYY"`. |
| **Exit Time** | datetime | Timestamp when Holly exited the trade. Exit can be triggered by stop hit, target hit, time stop, trailing stop (profit save), reduce risk, or timed exit — depending on risk mode. |
| **Symbol** | string | Ticker symbol of the traded security (NYSE/NASDAQ equities). |
| **Shares** | integer | Number of shares in the simulated trade. Controlled by Holly's AI Risk Size setting (default: 100 shares per trade). |
| **Entry Price** | float | Price at which Holly entered the trade. This is the simulated fill price at alert time. |
| **Exit Price** | float | Price at which Holly exited the trade. May differ slightly from `Entry Price + Change from Entry $` due to rounding or partial fills in simulation. |
| **Last Price** | float | Most recent price at time of data export (NOT at time of exit). For historical/closed trades, this reflects the stock's price when the data was exported — potentially months or years later. **Not useful for trade analysis.** |
| **Strategy** | string | Holly's AI strategy that generated the trade. Examples: `Breakout Long`, `Breakdown Short`, `Tailwind`, `Pullback Long`, `Pullback Short`, `Downward Dog`, `Bon Shorty`, `Float On`, `Quarterback`, `Power Hour Short`, `Looking for Bounce`, `Breakout`, etc. ~35 unique strategies. |
| **Segment** | string \| null | Holly's model grouping. Two values observed: `Holly Grail` (curated picks) and `Holly Neo` (extended universe). Null for some trades. |

---

## Profit & Loss Fields

| Column | Type | Formula (Verified ✓) | Description |
|--------|------|----------------------|-------------|
| **Change from Entry $** | float | `(current_or_exit_price - entry_price)` for longs; `(entry_price - current_or_exit_price)` for shorts | Per-share dollar change from entry. Directional — positive means trade moved in Holly's favor. ✓ |
| **Change from Entry %** | float | `change_from_entry / entry_price × 100` | Per-share percentage change from entry. ✓ |
| **Closed Profit** | float | `change_from_entry × shares` | Total dollar P&L for the closed trade. This is the primary P&L field. Positive = winner, negative = loser. ✓ |
| **Profit Basis Points** | integer | `closed_profit / entry_price × 10000` | P&L normalized as basis points relative to entry price. Useful for comparing profitability across different price levels. 1 bp = 0.01%. Since shares=100, this effectively equals `change_from_entry_pct × 100`. ✓ |
| **Open Profit** | float | Always `0` for closed trades | Unrealized P&L. Only non-zero for currently open trades (live view). In historical exports, always 0. |
| **Change from the Close $** | float \| null | | Per-share change from previous day's closing price. Measures overnight gap component. Null when prior close data unavailable. |
| **Change from the Close %** | float \| null | | Percentage change from previous day's close. |
| **Long Term Profit $** | float | Equals `Closed Profit` for completed trades | Dollar P&L measured over a longer horizon. For day trades that closed, this equals Closed Profit. May differ for swing/overnight holds. |
| **Long Term Profit %** | float | Equals `Change from Entry %` for completed trades | Percentage P&L over longer horizon. |

---

## Intraday P&L Dynamics (MFE / MAE)

These fields track how the trade's P&L evolved during the holding period — critical for exit optimization.

| Column | Type | Formula (Verified ✓) | Description |
|--------|------|----------------------|-------------|
| **Max Profit** | float | | **Maximum Favorable Excursion (MFE)** — the best unrealized P&L (in dollars, for full position) the trade reached at any point before exit. Minimum value is 0 (entry price). ✓ |
| **Max Profit Time of Day** | datetime | | Timestamp when MFE occurred. Use `max_profit_time - entry_time` to calculate time-to-MFE. |
| **Min Profit** | float | | **Maximum Adverse Excursion (MAE)** — the worst unrealized P&L (in dollars, for full position) the trade reached. Always ≤ 0. If 0, the trade never went against Holly. |
| **Min Profit Time of Day** | datetime | | Timestamp when MAE occurred. If equal to Entry Time, the worst point was at entry (trade immediately went in Holly's favor). |
| **Distance from Max Profit** | float | `max_profit - closed_profit` ✓ | Dollar amount "left on the table" — how much profit was given back from peak to exit. Positive = gave back profits. Negative = closed better than peak (rare, only with post-peak exit improvements). This is the **giveback**. |
| **Distance from Stop Price** | float | `min_profit - stop_loss_dollars` (approx) | Dollar difference between the worst drawdown (MAE) and the theoretical stop loss. Positive = got close to stop but didn't hit it. Negative = closed well above stop. ⚠️ Approximately verified — formula has slight deviations, likely due to intraday stop recalculation. |

---

## Momentum & Recency Fields

| Column | Type | Description |
|--------|------|-------------|
| **Profit Change Last 15** | float | Dollar change in trade P&L during the **last 15 minutes** before exit. Positive = P&L was improving; negative = P&L was deteriorating. Useful for identifying momentum at exit. |
| **Profit Change Last 5** | float | Dollar change in trade P&L during the **last 5 minutes** before exit. More granular momentum signal. Compare with Last 15 to see if deterioration was accelerating. |

---

## Stop & Risk Management Fields

| Column | Type | Formula (Verified ✓) | Description |
|--------|------|----------------------|-------------|
| **Stop Price** | float | | Holly's stop-loss price level. For longs, this is below entry; for shorts, above entry. |
| **% to Stop Price** | float | `abs(entry_price - stop_price)` ✓ | Dollar distance from entry to stop. Despite the "%" column name, this is in **dollars, not percent**. Trade Ideas UI mislabels this. |
| **Smart Stop** | float | `last_price - stop_price` ✓ | Dollar distance between the current/last price and the stop price. Positive = price is above stop (safe for longs); negative = price is below stop (danger for longs). For shorts, interpretation is inverted. Per Trade Ideas docs, the Smart Stop level itself is a proprietary calculation based on "the stock's volatility, relative volume and daily range" — it's not a fixed percentage. |
| **Time Stop** | datetime | | The scheduled time at which Holly will exit if no other exit condition triggers first. Depends on risk mode — conservative mode has 5 exit triggers, moderate only uses stop + time stop. |

---

## Derived / Unclear Fields

| Column | Type | Description |
|--------|------|-------------|
| **Time Until** | float | ⚠️ **Unverified.** Values range from -532 to +100. Possibly a composite score or percentage related to time-stop proximity and price action, but no formula could be confirmed against the data. Treat with caution — do not rely on for analysis without further validation. |

---

## Exit Mode Reference

Holly's exit behavior depends on the **Risk Mode** setting (from Trade Ideas docs):

| Risk Mode | Exit Triggers |
|-----------|--------------|
| **Aggressive** | No stop placed (presentation only — do not trade live) |
| **Moderate** | Stop Hit, Timed Exit |
| **Conservative** | Stop Hit, Target Hit, Profit Save (trailing stop), Reduce Risk (unexpected price action), Timed Exit |

---

## Strategy Reference

Observed strategies in dataset (10,500+ trades, 2020–2025):

| Strategy | Count (approx) | Direction | Notes |
|----------|----------------|-----------|-------|
| Breakout Long | High | Long | |
| Breakdown Short | High | Short | |
| Pullback Long | High | Long | |
| Tailwind | High | Long | |
| Downward Dog | Medium | Short | |
| Pullback Short | Medium | Short | |
| Breakout | Medium | Long | Distinct from "Breakout Long" |
| Bon Shorty | Medium | Short | |
| Float On | Medium | Long | |
| Quarterback | Low | Long | |
| Power Hour Short | Low | Short | Time-of-day strategy |
| Looking for Bounce | Low | Long | |
| *~23 others* | Low | Mixed | |

---

## Segment Reference

| Segment | Description |
|---------|-------------|
| **Holly Grail** | Holly's curated, higher-conviction picks. Tighter selection criteria. |
| **Holly Neo** | Extended universe — broader scan with more experimental setups. |
| *(null)* | Some trades have no segment assignment (older data or edge cases). |

---

## Data Quality Notes

1. **Shares always 100** in this dataset — Holly defaults to 100-share position sizing. Real trade sizes depend on user's AI Risk Size setting.
2. **"Last Price" is export-time, not trade-time** — do not use for P&L calculations. Use Exit Price instead.
3. **Closed Profit includes simulated slippage/spread** — small discrepancies between `Change from Entry $ × Shares` and `Closed Profit` (typically <$1) are normal.
4. **Raw CSV date format is non-standard** — `YYYY,Mon,DD,"HH:MM:SS,YYYY"` with commas inside quoted fields. The trade-importer.ts parser handles this.
5. **90-day export limit** — Trade Ideas caps historical exports to 90 days. Use `holly-export-bot.py` to automate chunked exports and merging.
6. **Times are Eastern** — all timestamps are US Eastern Time (ET).

---

## Column Mapping to Bridge Database

| CSV Column | DB Column (`holly_trades`) | Derived? |
|------------|---------------------------|----------|
| Entry Time | `entry_time` | |
| Exit Time | `exit_time` | |
| Symbol | `symbol` | |
| Shares | `shares` | |
| Entry Price | `entry_price` | |
| Last Price | `last_price` | |
| Change from Entry $ | `change_from_entry` | |
| Change from the Close $ | `change_from_close` | |
| Change from the Close % | `change_from_close_pct` | |
| Strategy | `strategy` | |
| Exit Price | `exit_price` | |
| Closed Profit | `closed_profit` | |
| Profit Change Last 15 | `profit_change_15` | |
| Profit Change Last 5 | `profit_change_5` | |
| Max Profit | `max_profit` | |
| Profit Basis Points | `profit_basis_points` | |
| Open Profit | `open_profit` | |
| Stop Price | `stop_price` | |
| Time Stop | `time_stop` | |
| Max Profit Time of Day | `max_profit_time` | |
| Distance from Max Profit | `distance_from_max_profit` | |
| Min Profit | `min_profit` | |
| Min Profit Time of Day | `min_profit_time` | |
| Distance from Stop Price | `distance_from_stop` | |
| Smart Stop | `smart_stop` | |
| % to Stop Price | `pct_to_stop` | |
| Time Until | `time_until` | |
| Segment | `segment` | |
| Change from Entry % | `change_from_entry_pct` | |
| Long Term Profit $ | `long_term_profit` | |
| Long Term Profit % | `long_term_profit_pct` | |
| — | `hold_minutes` | ✓ `(exit_time - entry_time)` in minutes |
| — | `mfe` | ✓ `= max_profit` |
| — | `mae` | ✓ `= min_profit` |
| — | `giveback` | ✓ `= max_profit - actual_pnl` |
| — | `giveback_ratio` | ✓ `= giveback / max_profit` (0–1) |
| — | `time_to_mfe_min` | ✓ `(max_profit_time - entry_time)` in minutes |
| — | `time_to_mae_min` | ✓ `(min_profit_time - entry_time)` in minutes |
| — | `r_multiple` | ✓ `= actual_pnl / risk` |
| — | `actual_pnl` | ✓ `= (exit_price - entry_price) × shares` |
