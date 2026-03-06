# Holly AI Dashboard v2 — Enterprise Implementation Blueprint

## Status: Model Live (77 columns, 95 measures pushed via TOM)

---

## File Inventory

| # | File | Purpose | Status |
|---|------|---------|--------|
| 1 | `01-holly-trades.pq` | Power Query M — main data table | Ready to paste |
| 2 | `02-date-table.pq` | Power Query M — date dimension | Ready to paste |
| 3 | `03-strategy-lookup.pq` | Power Query M — strategy lookup | Ready to paste |
| 4 | `04-dax-measures.dax` | All 70+ DAX measures by folder | Reference (95 already in model) |
| 5 | `05-calc-groups.csx` | Tabular Editor C# script | Ready for Tabular Editor |
| 6 | `06-field-parameters.dax` | 3 field params + What-If param | Ready to create |
| 7 | `07-visual-specs.md` | Complete visual specs for 10 pages | Build guide |
| 8 | `holly-dark-v2.json` | Updated theme (0E1117 background) | Import via View > Themes |

---

## Implementation Order

### Phase 1: Data Model (Power Query) — ~20 min
1. In PBI Desktop: Home > Transform data > Advanced Editor
2. Replace current query with contents of `01-holly-trades.pq`
   - Adjust file path if CSV location differs
   - Click "Close & Apply"
3. Create new blank query > Advanced Editor > paste `02-date-table.pq`
   - Rename query to "Date_Table"
4. Create new blank query > Advanced Editor > paste `03-strategy-lookup.pq`
   - Rename query to "Strategy_Lookup"
5. In Model view, create relationships:
   - Drag `Date_Table[Date]` → `Holly_Trades[trade_date]` (many-to-one)
   - Drag `Strategy_Lookup[Strategy]` → `Holly_Trades[strategy]` (many-to-one)
6. Mark `Date_Table` as Date Table (Table tools > Mark as date table > Date column)

### Phase 2: Theme — 1 min
1. View > Themes > Browse for themes
2. Select `holly-dark-v2.json`
3. Verify: page background should be `#0E1117`, visuals `#1A1F2E`

### Phase 3: Measures — Already Done
95 measures already pushed to model via TOM scripts. Verify in Model view.

If you need additional measures from `04-dax-measures.dax` (e.g., the Time Intelligence measures that require Date_Table):
1. Switch to Model view
2. Select Holly_Trades table (or create a Measures table)
3. New Measure > paste each measure

**Measures requiring Date_Table relationship** (add after Phase 1):
- PnL MTD, PnL YTD
- PnL Prior Year, PnL YoY Change, PnL YoY Pct
- Trades Prior Year, Win Rate Prior Year, Win Rate YoY Change

### Phase 4: Calculation Groups — ~10 min
1. Download Tabular Editor 3 (free): https://tabulareditor.com
2. Open PBI Desktop's model: File > Open > From DB > localhost:14448
3. File > New C# Script > paste `05-calc-groups.csx`
4. Run script (F5)
5. Save changes back to PBI model
6. Two new tables appear: "Time Comparison" and "Measure Selector"

### Phase 5: Field Parameters — ~5 min
1. In PBI Desktop: Modeling > New Parameter > Fields
2. Create "Performance Metric" parameter:
   - Add measures: Total PnL, Avg PnL, Win Rate, Profit Factor, Sharpe Ratio, etc.
   - Check "Add slicer to this page"
3. Create "Time Dimension" parameter:
   - Add columns: trade_year, Month_Name_Short, Day_Name_Short, Entry_Hour_Label
4. Create "Category Dimension" parameter:
   - Add columns: strategy, direction, trend_regime, vol_regime, momentum_regime, opt_exit_rule
5. Create What-If Parameter:
   - Modeling > New Parameter > What If
   - Name: "Min Stop Buffer", Min: 0, Max: 3, Increment: 0.05, Default: 0

### Phase 6: Report Pages — ~90 min
Follow `07-visual-specs.md` page by page. Key notes:

**Page 1: Executive Command Center**
- 10 KPI cards in horizontal row (use "new card" visual)
- Combo chart for equity curve (line + area)
- Waterfall for monthly P&L
- Line chart for running win rate

**Page 2: Strategy Scorecard**
- Matrix with conditional formatting on every column
- Strategy slicer (vertical, single-select)
- Enable drillthrough: Format > Drillthrough > Add strategy field

**Page 3: Strategy Drillthrough (Hidden)**
- Add drillthrough field: strategy
- Hide page from navigation: right-click tab > Hide
- Back button: Insert > Buttons > Back

**Page 4: Regime Analysis**
- Three cross-tab heatmaps (matrix with conditional formatting)
- RSI scatter with reference lines at 30 and 70
- Page filter: Has_Regime_Flag = "With Regime Data"

**Page 5: Time Analysis**
- Hour × Day heatmap (matrix with diverging conditional format)
- Dynamic chart using both field parameter slicers
- Grouped bar (direction × day)

**Page 6: MFE/MAE Risk Lab**
- MFE vs MAE scatter (28K points — enable high density sampling)
- Three strategy bar charts filtered to Top 25 by trade count
- 4 KPI cards

**Page 7: Exit Rule Optimizer**
- Strategy × Rule matrix
- Scatter chart for win rate vs profit factor clusters
- Page filter: Has_Exit_Rule_Flag = "With Exit Rule"

**Page 8: Strategy Comparison** (new)
- Multi-select strategy slicer
- Overlaid equity curves (multi-line chart with legend = strategy)

**Page 9: What-If Stop Buffer** (new)
- What-If slider slicer
- Filtered KPI cards using Filtered_ measures
- Side-by-side equity curves (filtered vs unfiltered)

**Tooltip Pages** (hidden)
- Strategy Tooltip: 320 × 240, mini cards + sparkline
- Trade Detail Tooltip: 320 × 240, detail table

### Phase 7: Bookmarks & Navigation — ~15 min
1. View > Bookmarks pane
2. Set up each page with desired filters, create bookmark
3. Add navigation buttons to each page header:
   - Insert > Buttons > Blank
   - Format > Action > Type: Bookmark > select target
   - Style: `#1A1F2E` background, `#00D4AA` text, `#2D2D5E` border

### Phase 8: Slicer Sync — ~10 min
1. View > Sync slicers
2. For each slicer, check sync/visible per the table in `07-visual-specs.md`

### Phase 9: Final Polish — ~15 min
1. Add `[Last Refreshed]` card to Page 1 footer
2. Add alt-text to every visual (Format > General > Alt text)
3. Add info buttons (ℹ️) using bookmark-linked action buttons
4. Test cross-filtering between all pages
5. Test drillthrough from Page 2 → Page 3
6. Verify field parameters respond correctly on Pages 4, 5
7. Test What-If slider on Page 9

---

## Conditional Formatting Quick Reference

### Gradient Backgrounds (for Matrix cells)
```
Win Rate:   Min 0.30 → #FF4444 | Mid 0.50 → #FFD700 | Max 0.70 → #00D4AA
PF:         Min 0.50 → #FF4444 | Mid 1.00 → #FFD700 | Max 2.00 → #00D4AA
Sharpe:     Min 0.00 → #FF4444 | Mid 1.00 → #FFD700 | Max 3.00 → #00D4AA
Consistency:Min 0.30 → #FF4444 | Mid 0.50 → #FFD700 | Max 0.70 → #00D4AA
Edge Score: Min 0.50 → #FF4444 | Mid 1.00 → #FFD700 | Max 2.00 → #00D4AA
```

### Rules-based (for KPI cards)
Use DAX color measures: [PnL Color], [Win Rate Color], [PF Color], etc.
Format > Conditional formatting > Background color > Field value > select color measure.

### Data Bars (for matrix PnL columns)
Positive: `#00D4AA`
Negative: `#FF4444`

### Heatmaps (diverging)
Center: 0
Min: `#FF4444`
Mid: `#FAFAFA` (white)
Max: `#00D4AA`

---

## DAX Efficiency Notes (Iteration 2 Review)

1. **Variables everywhere**: All measures use VAR for intermediate calculations — no redundant CALCULATE calls.

2. **ALLSELECTED vs ALL**: Cumulative measures use ALLSELECTED to respect slicer context while removing date filter. ALL is only used for grand-total measures (Max Single Trade Win/Loss).

3. **KEEPFILTERS**: Not needed in current measures since we're not combining conflicting filter contexts.

4. **Storage Engine friendly**: Measures like Sharpe Ratio use ADDCOLUMNS + SUMMARIZE to create virtual tables, which are evaluated in a single storage engine query when possible.

5. **Avoid nested CALCULATE**: No measure has more than one level of CALCULATE nesting. Complex measures use VAR chains instead.

6. **Iterator caution**: Running Max PnL uses MAXX iterator over dates, which is O(n*m). For 2,500 trading days this is fine. If slow, pre-compute in Power Query.

---

## Model Summary

| Metric | Count |
|--------|-------|
| Tables | 1 (Holly_Trades) + Date_Table + Strategy_Lookup |
| Columns | 77 (52 source + 25 calculated) |
| Measures | 95 (in model) + ~15 more in DAX file |
| Calculation Groups | 2 (after Tabular Editor) |
| Field Parameters | 3 + 1 What-If |
| Report Pages | 9 main + 2 tooltip = 11 |
| Bookmarks | 5 |
| Relationships | 2 |
