// ============================================================
// HOLLY ANALYTICS — Power Query M Code
// ============================================================
// IMPORT INSTRUCTIONS:
// 1. Open Power BI Desktop > Home > Transform Data (Power Query Editor)
// 2. For each section below, click "New Source > Blank Query"
// 3. Click "Advanced Editor" and paste the code
// 4. Rename the query as indicated
// ============================================================


// ============================================================
// QUERY 1: "holly_analytics" — Main Data Table
// ============================================================
// Steps: Load Excel > Type columns > Replace nulls > Add calculated columns

let
    // UPDATE THIS PATH to your actual file location
    Source = Excel.Workbook(File.Contents("C:\Users\dotca\source\market-data-bridge\powerbi\holly_analytics.xlsx"), null, true),
    Sheet1 = Source{[Item="Sheet1",Kind="Sheet"]}[Data],
    PromotedHeaders = Table.PromoteHeaders(Sheet1, [PromoteAllScalars=true]),

    // ----- Type Conversions -----
    TypedColumns = Table.TransformColumnTypes(PromotedHeaders, {
        {"trade_id", Int64.Type},
        {"symbol", type text},
        {"strategy", type text},
        {"direction", type text},
        {"entry_time", type datetime},
        {"entry_price", type number},
        {"exit_time", type datetime},
        {"exit_price", type number},
        {"holly_pnl", type number},
        {"shares", Int64.Type},
        {"stop_price", type number},
        {"target_price", type number},
        {"mfe", type number},
        {"mae", type number},
        {"stop_buffer_pct", type number},
        {"trade_date", type date},
        {"trade_year", Int64.Type},
        {"trade_month", Int64.Type},
        {"trade_dow", Int64.Type},
        {"entry_hour", Int64.Type},
        {"sma20", type number},
        {"sma5", type number},
        {"trend_slope", type number},
        {"above_sma20", type logical},
        {"atr14", type number},
        {"atr_pct", type number},
        {"daily_range_pct", type number},
        {"rsi14", type number},
        {"roc5", type number},
        {"roc20", type number},
        {"trend_regime", type text},
        {"vol_regime", type text},
        {"momentum_regime", type text},
        {"opt_exit_rule", type text},
        {"opt_params", type text},
        {"opt_avg_pnl", type number},
        {"opt_profit_factor", type number},
        {"opt_win_rate", type number},
        {"opt_sharpe", type number},
        {"opt_max_drawdown", type number},
        {"opt_total_trades", Int64.Type},
        {"has_minute_bars", type logical},
        {"has_regime_data", type logical},
        {"hold_minutes", Int64.Type},
        {"pnl_per_share", type number},
        {"is_winner", type logical},
        {"is_loser", type logical},
        {"risk_per_share", type number},
        {"r_multiple", type number}
    }),

    // ----- Replace nulls in regime columns with "No Data" -----
    ReplaceRegime1 = Table.ReplaceValue(TypedColumns, null, "No Data", Replacer.ReplaceValue, {"trend_regime"}),
    ReplaceRegime2 = Table.ReplaceValue(ReplaceRegime1, null, "No Data", Replacer.ReplaceValue, {"vol_regime"}),
    ReplaceRegime3 = Table.ReplaceValue(ReplaceRegime2, null, "No Data", Replacer.ReplaceValue, {"momentum_regime"}),

    // ----- Replace nulls in optimization columns -----
    ReplaceOpt1 = Table.ReplaceValue(ReplaceRegime3, null, "No Data", Replacer.ReplaceValue, {"opt_exit_rule"}),
    ReplaceOpt2 = Table.ReplaceValue(ReplaceOpt1, null, "No Data", Replacer.ReplaceValue, {"opt_params"}),

    // ----- Add Calculated Columns -----

    // Quality Tier based on r_multiple
    AddQualityTier = Table.AddColumn(ReplaceOpt2, "Quality Tier", each
        if [r_multiple] = null then "6-No Data"
        else if [r_multiple] > 2 then "1-Elite (R>2)"
        else if [r_multiple] > 1 then "2-Good (1<R≤2)"
        else if [r_multiple] > 0 then "3-Marginal (0<R≤1)"
        else if [r_multiple] > -1 then "4-Bad (-1<R≤0)"
        else "5-Terrible (R<-1)",
        type text
    ),

    // Month Name for display
    AddMonthName = Table.AddColumn(AddQualityTier, "Month Name", each
        Date.ToText([trade_date], "MMM"),
        type text
    ),

    // Day Name for display
    AddDayName = Table.AddColumn(AddMonthName, "Day Name", each
        let dow = [trade_dow] in
        if dow = 0 then "Mon"
        else if dow = 1 then "Tue"
        else if dow = 2 then "Wed"
        else if dow = 3 then "Thu"
        else if dow = 4 then "Fri"
        else "Other",
        type text
    ),

    // Day Sort Order (for proper weekday sorting in charts)
    AddDaySort = Table.AddColumn(AddDayName, "Day Sort", each [trade_dow], Int64.Type),

    // Trade Result Category
    AddResult = Table.AddColumn(AddDaySort, "Trade Result", each
        if [holly_pnl] > 0 then "Win"
        else if [holly_pnl] < 0 then "Loss"
        else "Scratch",
        type text
    ),

    // Quarter for time grouping
    AddQuarter = Table.AddColumn(AddResult, "Quarter", each
        "Q" & Text.From(Date.QuarterOfYear([trade_date])),
        type text
    ),

    // Year-Quarter for time series
    AddYearQuarter = Table.AddColumn(AddQuarter, "Year-Quarter", each
        Text.From([trade_year]) & "-Q" & Text.From(Date.QuarterOfYear([trade_date])),
        type text
    ),

    // Year-Month for time series
    AddYearMonth = Table.AddColumn(AddYearQuarter, "Year-Month", each
        Date.ToText([trade_date], "yyyy-MM"),
        type text
    ),

    // Left on Table (how much MFE was not captured)
    AddLeftOnTable = Table.AddColumn(AddYearMonth, "Left on Table", each
        if [mfe] <> null and [holly_pnl] <> null then [mfe] - [holly_pnl] else null,
        type number
    ),

    // Trade Index (for cumulative calculations — sort by entry_time)
    SortedByTime = Table.Sort(AddLeftOnTable, {{"entry_time", Order.Ascending}}),
    AddIndex = Table.AddIndexColumn(SortedByTime, "Trade Index", 1, 1, Int64.Type)

in
    AddIndex


// ============================================================
// QUERY 2: "DateTable" — Date Dimension Table
// ============================================================
// Create as a separate blank query

// let
//     StartDate = #date(2016, 1, 1),
//     EndDate = #date(2026, 12, 31),
//     DateCount = Duration.Days(EndDate - StartDate) + 1,
//     DateList = List.Dates(StartDate, DateCount, #duration(1, 0, 0, 0)),
//     DateTable = Table.FromList(DateList, Splitter.SplitByNothing(), {"Date"}, null, ExtraValues.Error),
//     TypedDate = Table.TransformColumnTypes(DateTable, {{"Date", type date}}),
//     AddYear = Table.AddColumn(TypedDate, "Year", each Date.Year([Date]), Int64.Type),
//     AddMonth = Table.AddColumn(AddYear, "Month", each Date.Month([Date]), Int64.Type),
//     AddMonthName = Table.AddColumn(AddMonth, "Month Name", each Date.ToText([Date], "MMM"), type text),
//     AddMonthSort = Table.AddColumn(AddMonthName, "Month Sort", each Date.Month([Date]), Int64.Type),
//     AddQuarter = Table.AddColumn(AddMonthSort, "Quarter", each "Q" & Text.From(Date.QuarterOfYear([Date])), type text),
//     AddDOW = Table.AddColumn(AddQuarter, "Day of Week", each Date.DayOfWeek([Date], Day.Monday), Int64.Type),
//     AddDayName = Table.AddColumn(AddDOW, "Day Name", each Date.ToText([Date], "ddd"), type text),
//     AddYearMonth = Table.AddColumn(AddDayName, "Year-Month", each Date.ToText([Date], "yyyy-MM"), type text)
// in
//     AddYearMonth


// ============================================================
// QUERY 3: "Measures" — Empty Table for DAX Measures
// ============================================================
// Create as a blank query, then enter DAX measures on this table

// let
//     Source = #table({"Measures Column"}, {{""}})
// in
//     Source

// After loading, hide the "Measures Column" — this table is just
// a container for your DAX measures.


// ============================================================
// RELATIONSHIP SETUP (after loading all queries):
// ============================================================
// In Model view, create:
//   DateTable[Date] → holly_analytics[trade_date]  (Many-to-One, Single direction)
//
// Mark DateTable as "Date Table" (Table tools > Mark as date table > Date column)
// This enables DAX time intelligence functions (TOTALYTD, SAMEPERIODLASTYEAR, etc.)
