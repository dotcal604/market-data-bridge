// ============================================================
// CALCULATION GROUPS — Tabular Editor C# Script
// ============================================================
// Run this in Tabular Editor 3: File > New C# Script > Paste > Run
// Creates two calculation groups:
//   1. Time Comparison — apply time intelligence to any measure
//   2. Measure Selector — dynamic measure switching
// ============================================================

// ════════════════════════════════════════════════════════════
// CALCULATION GROUP 1: Time Comparison
// ════════════════════════════════════════════════════════════

var timeCompGroup = Model.AddCalculationGroup("Time Comparison");
timeCompGroup.Columns["Name"].Name = "Time Period";

// Ordinal column for sorting
timeCompGroup.Columns["Time Period"].SortByColumn = timeCompGroup.AddCalculationGroupAttribute("Time Period Sort");

// Item 1: Current Period (default)
var currentPeriod = timeCompGroup.AddCalculationItem("Current Period",
    "SELECTEDMEASURE()");
currentPeriod.FormatStringExpression = "SELECTEDMEASUREFORMATSTRING()";
// Sort = 1

// Item 2: Prior Year
var priorYear = timeCompGroup.AddCalculationItem("Prior Year",
    @"CALCULATE(
    SELECTEDMEASURE(),
    SAMEPERIODLASTYEAR(Date_Table[Date])
)");
priorYear.FormatStringExpression = "SELECTEDMEASUREFORMATSTRING()";

// Item 3: YoY Change
var yoyChange = timeCompGroup.AddCalculationItem("YoY Change",
    @"VAR _current = SELECTEDMEASURE()
VAR _py = CALCULATE(SELECTEDMEASURE(), SAMEPERIODLASTYEAR(Date_Table[Date]))
RETURN _current - _py");
yoyChange.FormatStringExpression = "SELECTEDMEASUREFORMATSTRING()";

// Item 4: YoY %
var yoyPct = timeCompGroup.AddCalculationItem("YoY %",
    @"VAR _current = SELECTEDMEASURE()
VAR _py = CALCULATE(SELECTEDMEASURE(), SAMEPERIODLASTYEAR(Date_Table[Date]))
RETURN DIVIDE(_current - _py, ABS(_py))");
yoyPct.FormatStringExpression = @"""0.0%""";

// Item 5: YTD
var ytd = timeCompGroup.AddCalculationItem("YTD",
    @"CALCULATE(SELECTEDMEASURE(), DATESYTD(Date_Table[Date]))");
ytd.FormatStringExpression = "SELECTEDMEASUREFORMATSTRING()";

// Item 6: MTD
var mtd = timeCompGroup.AddCalculationItem("MTD",
    @"CALCULATE(SELECTEDMEASURE(), DATESMTD(Date_Table[Date]))");
mtd.FormatStringExpression = "SELECTEDMEASUREFORMATSTRING()";


// ════════════════════════════════════════════════════════════
// CALCULATION GROUP 2: Measure Selector
// ════════════════════════════════════════════════════════════

var measSelGroup = Model.AddCalculationGroup("Measure Selector");
measSelGroup.Columns["Name"].Name = "Selected Measure";

// Each item simply returns the named measure (but respects any
// Time Comparison calc group applied on top)

var items = new Dictionary<string, string> {
    {"Total PnL",       "[Total PnL]"},
    {"Avg PnL",         "[Avg PnL]"},
    {"Win Rate",        "[Win Rate]"},
    {"Profit Factor",   "[Profit Factor]"},
    {"Sharpe Ratio",    "[Sharpe Ratio]"},
    {"Avg R Multiple",  "[Avg R Multiple]"},
    {"Total Trades",    "[Total Trades]"},
    {"Avg Hold Minutes","[Avg Hold Minutes]"},
    {"Expectancy",      "[Expectancy]"},
    {"Edge Score",      "[Edge Score]"},
    {"Consistency Score","[Consistency Score]"}
};

foreach (var kv in items) {
    var item = measSelGroup.AddCalculationItem(kv.Key,
        "SELECTEDMEASURE()");
    // Format string logic per item
    if (kv.Key == "Win Rate" || kv.Key == "Consistency Score") {
        item.FormatStringExpression = @"""0.0%""";
    } else if (kv.Key == "Total Trades") {
        item.FormatStringExpression = @"""#,0""";
    } else if (kv.Key == "Avg Hold Minutes") {
        item.FormatStringExpression = @"""#,0""";
    } else if (kv.Key.Contains("PnL")) {
        item.FormatStringExpression = @"""$#,0.00""";
    } else {
        item.FormatStringExpression = @"""#,0.00""";
    }
}

// Save
Model.SaveChanges();

// ============================================================
// NOTE: After running, you'll see two new tables in Model view:
//   - "Time Comparison" with column "Time Period"
//   - "Measure Selector" with column "Selected Measure"
// Place "Time Period" on a slicer. Place "Selected Measure" on
// a slicer or in the Legend well to switch which measure is shown.
// ============================================================
