// ============================================================
// DATE_TABLE — Power Query M (Advanced Editor)
// ============================================================
// Standard date dimension from 2016-01-01 to 2026-12-31
// Mark as Date Table after loading. Relate to Holly_Trades[trade_date].
// ============================================================

let
    StartDate = #date(2016, 1, 1),
    EndDate = #date(2026, 12, 31),
    DayCount = Duration.Days(EndDate - StartDate) + 1,

    DateList = List.Dates(StartDate, DayCount, #duration(1, 0, 0, 0)),
    DateTable = Table.FromList(DateList, Splitter.SplitByNothing(), {"Date"}, null, ExtraValues.Error),
    TypedDate = Table.TransformColumnTypes(DateTable, {{"Date", type date}}),

    // Year
    AddYear = Table.AddColumn(TypedDate, "Year", each Date.Year([Date]), Int64.Type),

    // Quarter
    AddQuarter = Table.AddColumn(AddYear, "Quarter", each Date.QuarterOfYear([Date]), Int64.Type),
    AddQuarterLabel = Table.AddColumn(AddQuarter, "QuarterLabel", each "Q" & Text.From(Date.QuarterOfYear([Date])), type text),
    AddYearQuarter = Table.AddColumn(AddQuarterLabel, "YearQuarter", each Text.From(Date.Year([Date])) & "-Q" & Text.From(Date.QuarterOfYear([Date])), type text),

    // Month
    AddMonth = Table.AddColumn(AddYearQuarter, "Month", each Date.Month([Date]), Int64.Type),
    AddMonthName = Table.AddColumn(AddMonth, "MonthName", each Date.MonthName([Date]), type text),
    AddMonthNameShort = Table.AddColumn(AddMonthName, "MonthNameShort", each Text.Start(Date.MonthName([Date]), 3), type text),
    AddMonthYear = Table.AddColumn(AddMonthNameShort, "MonthYear", each Text.Start(Date.MonthName([Date]), 3) & " " & Text.From(Date.Year([Date])), type text),

    // YearMonth sortable integer (202401 format)
    AddYearMonth = Table.AddColumn(AddMonthYear, "YearMonth", each Date.Year([Date]) * 100 + Date.Month([Date]), Int64.Type),

    // Week
    AddWeekOfYear = Table.AddColumn(AddYearMonth, "WeekOfYear", each Date.WeekOfYear([Date]), Int64.Type),

    // Day
    AddDayOfWeek = Table.AddColumn(AddWeekOfYear, "DayOfWeek", each Date.DayOfWeek([Date], Day.Monday) + 1, Int64.Type),
    AddDayName = Table.AddColumn(AddDayOfWeek, "DayName", each Date.DayOfWeekName([Date]), type text),
    AddDayNameShort = Table.AddColumn(AddDayName, "DayNameShort", each Text.Start(Date.DayOfWeekName([Date]), 3), type text),
    AddDayOfMonth = Table.AddColumn(AddDayNameShort, "DayOfMonth", each Date.Day([Date]), Int64.Type),

    // Flags
    AddIsWeekday = Table.AddColumn(AddDayOfMonth, "IsWeekday", each Date.DayOfWeek([Date], Day.Monday) < 5, type logical),

    // Fiscal Year (calendar year = fiscal year for Jan start)
    AddFiscalYear = Table.AddColumn(AddIsWeekday, "FiscalYear", each Date.Year([Date]), Int64.Type),

    // ISO Year-Week (for weekly grouping)
    AddISOYearWeek = Table.AddColumn(AddFiscalYear, "ISOYearWeek", each
        Text.From(Date.Year([Date])) & "-W" & Text.PadStart(Text.From(Date.WeekOfYear([Date])), 2, "0"),
        type text
    )
in
    AddISOYearWeek
