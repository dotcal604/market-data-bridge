/**
 * IBKR Flex Report Parser
 *
 * Handles two report types:
 *   1. Trade Confirmations — individual fills
 *   2. Activity Statements — comprehensive daily/monthly statements
 *
 * Supports three input formats:
 *   - XML (default Flex Web Service output)
 *   - Flat CSV (single header row)
 *   - Multi-section CSV (BOF/HEADER/DATA/TRAILER prefixes)
 */

import { parse as csvParse } from "csv-parse/sync";
import { logger } from "../logging.js";

const log = logger.child({ module: "flex-parser" });

export interface FlexTrade {
  account_id: string;
  trade_id: string;
  symbol: string;
  conid: string;
  asset_class: string;
  description: string;
  action: string;       // BUY / SELL
  quantity: number;
  price: number;
  proceeds: number;
  commission: number;
  net_cash: number;
  trade_date: string;   // YYYY-MM-DD
  trade_time: string;   // HH:MM:SS
  settle_date: string;
  exchange: string;
  order_type: string;
  currency: string;
  fx_rate: number;
  realized_pnl: number;
  cost_basis: number;
  order_id: string;
  exec_id: string;
  open_close: string;   // O / C
  notes: string;
  raw_json: string;     // Full original record as JSON for audit
}

export interface FlexParseResult {
  trades: FlexTrade[];
  report_type: string;   // "trade_confirmations" | "activity_statement" | "unknown"
  account_id: string;
  from_date: string;
  to_date: string;
  generated_at: string;
  total_rows: number;
  parsed: number;
  errors: string[];
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Parse a Flex report (auto-detects XML vs CSV format).
 */
export function parseFlexReport(content: string): FlexParseResult {
  const trimmed = content.trim();

  if (trimmed.startsWith("<") || trimmed.startsWith("<?xml")) {
    return parseFlexXml(trimmed);
  }

  return parseFlexCsv(trimmed);
}

// ── XML Parser ─────────────────────────────────────────────────────────────

function parseFlexXml(xml: string): FlexParseResult {
  const errors: string[] = [];
  const trades: FlexTrade[] = [];

  // Extract report metadata
  const accountId = extractAttr(xml, "accountId") ?? extractAttr(xml, "AccountId") ?? "";
  const fromDate = extractAttr(xml, "fromDate") ?? "";
  const toDate = extractAttr(xml, "toDate") ?? "";
  const whenGenerated = extractAttr(xml, "whenGenerated") ?? "";

  // Detect report type
  let reportType = "unknown";
  if (xml.includes("<TradeConfirm") || xml.includes("<Trades>")) {
    reportType = "trade_confirmations";
  } else if (xml.includes("<ActivityStatement") || xml.includes("<FlexStatements>")) {
    reportType = "activity_statement";
  }

  // Extract trade elements — handle both <Trade .../> and <TradeConfirm .../>
  const tradePatterns = [
    /<Trade\s+([^>]+?)\/>/g,
    /<TradeConfirm\s+([^>]+?)\/>/g,
    /<Order\s+([^>]+?)\/>/g,
  ];

  let totalRows = 0;

  for (const pattern of tradePatterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(xml)) !== null) {
      totalRows++;
      try {
        const attrs = parseXmlAttributes(match[1]);
        const trade = mapXmlToTrade(attrs, accountId);
        if (trade.symbol) {
          trades.push(trade);
        }
      } catch (e: any) {
        errors.push(`XML trade element ${totalRows}: ${e.message}`);
      }
    }
  }

  if (totalRows === 0) {
    // Try nested structure: <Trades><Trade>...</Trade></Trades>
    const nestedPattern = /<Trade\b[^>]*>([\s\S]*?)<\/Trade>/g;
    let nestedMatch: RegExpExecArray | null;
    while ((nestedMatch = nestedPattern.exec(xml)) !== null) {
      totalRows++;
      try {
        const innerXml = `<Trade ${nestedMatch[0].match(/<Trade\s+([^>]*)/)?.[1] ?? ""} />`;
        const attrs = parseXmlAttributes(nestedMatch[0].match(/<Trade\s+([^>]*)/)?.[1] ?? "");
        const trade = mapXmlToTrade(attrs, accountId);
        if (trade.symbol) {
          trades.push(trade);
        }
      } catch (e: any) {
        errors.push(`Nested trade ${totalRows}: ${e.message}`);
      }
    }
  }

  log.info({ reportType, accountId, totalRows, parsed: trades.length, errors: errors.length }, "Parsed Flex XML");

  return {
    trades,
    report_type: reportType,
    account_id: accountId,
    from_date: fromDate,
    to_date: toDate,
    generated_at: whenGenerated,
    total_rows: totalRows,
    parsed: trades.length,
    errors,
  };
}

function extractAttr(xml: string, name: string): string | undefined {
  const pattern = new RegExp(`${name}="([^"]*)"`, "i");
  return pattern.exec(xml)?.[1];
}

function parseXmlAttributes(attrString: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const pattern = /(\w+)="([^"]*)"/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(attrString)) !== null) {
    attrs[match[1]] = match[2];
  }
  return attrs;
}

function mapXmlToTrade(attrs: Record<string, string>, defaultAccountId: string): FlexTrade {
  const dateTime = attrs.dateTime ?? attrs.tradeDate ?? attrs.reportDate ?? "";
  const [date, time] = splitDateTime(dateTime);

  return {
    account_id: attrs.accountId ?? attrs.acctAlias ?? defaultAccountId,
    trade_id: attrs.tradeID ?? attrs.transactionID ?? "",
    symbol: attrs.symbol ?? "",
    conid: attrs.conid ?? "",
    asset_class: attrs.assetCategory ?? attrs.assetClass ?? "STK",
    description: attrs.description ?? attrs.listingExchange ?? "",
    action: normalizeSide(attrs.buySell ?? attrs.side ?? ""),
    quantity: parseFlexNum(attrs.quantity),
    price: parseFlexNum(attrs.tradePrice ?? attrs.price),
    proceeds: parseFlexNum(attrs.proceeds),
    commission: parseFlexNum(attrs.ibCommission ?? attrs.commission),
    net_cash: parseFlexNum(attrs.netCash),
    trade_date: normalizeFlexDate(date || attrs.tradeDate || attrs.reportDate || ""),
    trade_time: time || attrs.tradeTime || "",
    settle_date: normalizeFlexDate(attrs.settleDate ?? attrs.settleDateTarget ?? ""),
    exchange: attrs.exchange ?? attrs.listingExchange ?? "",
    order_type: attrs.orderType ?? "",
    currency: attrs.currency ?? "USD",
    fx_rate: parseFlexNum(attrs.fxRateToBase ?? "1"),
    realized_pnl: parseFlexNum(attrs.fifoPnlRealized ?? attrs.realizedPnl ?? attrs.mtmPnl),
    cost_basis: parseFlexNum(attrs.costBasis ?? attrs.cost),
    order_id: attrs.ibOrderID ?? attrs.orderID ?? "",
    exec_id: attrs.ibExecID ?? attrs.execID ?? "",
    open_close: attrs.openCloseIndicator ?? attrs.code ?? "",
    notes: attrs.notes ?? attrs.code ?? "",
    raw_json: JSON.stringify(attrs),
  };
}

// ── CSV Parser ─────────────────────────────────────────────────────────────

function parseFlexCsv(content: string): FlexParseResult {
  const lines = content.split(/\r?\n/);
  const errors: string[] = [];
  const trades: FlexTrade[] = [];
  let accountId = "";
  let reportType = "unknown";

  // Check if multi-section format (BOF/HEADER/DATA/TRAILER)
  const firstField = lines[0]?.split(",")[0]?.replace(/"/g, "").trim();
  const isMultiSection = ["BOF", "HEADER", "DATA", "TRAILER"].includes(firstField);

  if (isMultiSection) {
    return parseMultiSectionCsv(lines);
  }

  // Flat CSV — standard header row
  let records: Record<string, string>[];
  try {
    records = csvParse(content, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      relax_column_count: true,
    });
  } catch (e: any) {
    return emptyResult(`CSV parse error: ${e.message}`);
  }

  reportType = detectCsvReportType(records[0] ?? {});

  for (let i = 0; i < records.length; i++) {
    try {
      const trade = mapCsvToTrade(records[i]);
      if (trade.symbol) {
        if (!accountId && trade.account_id) accountId = trade.account_id;
        trades.push(trade);
      }
    } catch (e: any) {
      errors.push(`Row ${i + 2}: ${e.message}`);
    }
  }

  log.info({ reportType, totalRows: records.length, parsed: trades.length }, "Parsed Flex CSV");

  return {
    trades,
    report_type: reportType,
    account_id: accountId,
    from_date: trades[0]?.trade_date ?? "",
    to_date: trades[trades.length - 1]?.trade_date ?? "",
    generated_at: "",
    total_rows: records.length,
    parsed: trades.length,
    errors,
  };
}

function parseMultiSectionCsv(lines: string[]): FlexParseResult {
  const errors: string[] = [];
  const trades: FlexTrade[] = [];
  let accountId = "";
  let headers: string[] = [];
  let totalRows = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const firstComma = trimmed.indexOf(",");
    const recordType = trimmed.slice(0, firstComma).replace(/"/g, "").trim();
    const rest = trimmed.slice(firstComma + 1);

    if (recordType === "BOF") {
      // BOF line may contain account ID
      const parts = rest.split(",").map((s) => s.replace(/"/g, "").trim());
      accountId = parts[0] ?? "";
      continue;
    }

    if (recordType === "HEADER") {
      headers = rest.split(",").map((s) => s.replace(/"/g, "").trim());
      continue;
    }

    if (recordType === "DATA") {
      totalRows++;
      if (headers.length === 0) {
        errors.push(`Row ${totalRows}: DATA row before HEADER`);
        continue;
      }

      let values: string[];
      try {
        values = csvParse(rest, { relax_column_count: true, trim: true })[0] ?? [];
      } catch {
        values = rest.split(",").map((s) => s.replace(/"/g, "").trim());
      }

      const record: Record<string, string> = {};
      for (let i = 0; i < headers.length; i++) {
        record[headers[i]] = values[i] ?? "";
      }

      try {
        const trade = mapCsvToTrade(record);
        if (trade.symbol) {
          trades.push(trade);
        }
      } catch (e: any) {
        errors.push(`Row ${totalRows}: ${e.message}`);
      }
      continue;
    }

    // TRAILER or unknown — skip
  }

  const reportType = headers.length > 0 ? detectCsvReportType(Object.fromEntries(headers.map((h) => [h, ""]))) : "unknown";

  log.info({ reportType, totalRows, parsed: trades.length, errors: errors.length }, "Parsed Flex multi-section CSV");

  return {
    trades,
    report_type: reportType,
    account_id: accountId,
    from_date: trades[0]?.trade_date ?? "",
    to_date: trades[trades.length - 1]?.trade_date ?? "",
    generated_at: "",
    total_rows: totalRows,
    parsed: trades.length,
    errors,
  };
}

function detectCsvReportType(firstRow: Record<string, string>): string {
  const keys = Object.keys(firstRow).map((k) => k.toLowerCase());
  if (keys.some((k) => k.includes("tradeid") || k.includes("trade_id"))) return "trade_confirmations";
  if (keys.some((k) => k.includes("transactionid"))) return "activity_statement";
  return "unknown";
}

function mapCsvToTrade(record: Record<string, string>): FlexTrade {
  // Flex CSV columns can vary; try common column names
  const dateTime = record["Date/Time"] ?? record["DateTime"] ?? record["TradeDate"] ?? "";
  const [date, time] = splitDateTime(dateTime);

  return {
    account_id: record["ClientAccountID"] ?? record["AccountId"] ?? record["Account"] ?? "",
    trade_id: record["TradeID"] ?? record["TransactionID"] ?? "",
    symbol: record["Symbol"] ?? record["UnderlyingSymbol"] ?? "",
    conid: record["Conid"] ?? record["ConID"] ?? "",
    asset_class: record["AssetClass"] ?? record["AssetCategory"] ?? "STK",
    description: record["Description"] ?? "",
    action: normalizeSide(record["Buy/Sell"] ?? record["Side"] ?? record["Code"] ?? ""),
    quantity: parseFlexNum(record["Quantity"]),
    price: parseFlexNum(record["TradePrice"] ?? record["Price"]),
    proceeds: parseFlexNum(record["Proceeds"]),
    commission: parseFlexNum(record["IBCommission"] ?? record["Commission"]),
    net_cash: parseFlexNum(record["NetCash"]),
    trade_date: normalizeFlexDate(date || record["TradeDate"] || ""),
    trade_time: time || record["TradeTime"] || "",
    settle_date: normalizeFlexDate(record["SettleDate"] ?? record["SettleDateTarget"] ?? ""),
    exchange: record["Exchange"] ?? record["ListingExchange"] ?? "",
    order_type: record["OrderType"] ?? "",
    currency: record["CurrencyPrimary"] ?? record["Currency"] ?? "USD",
    fx_rate: parseFlexNum(record["FxRateToBase"] ?? "1"),
    realized_pnl: parseFlexNum(record["FifoPnlRealized"] ?? record["RealizedPnl"] ?? record["MtmPnl"]),
    cost_basis: parseFlexNum(record["CostBasis"] ?? record["Cost"]),
    order_id: record["IBOrderID"] ?? record["OrderID"] ?? "",
    exec_id: record["IBExecID"] ?? record["ExecID"] ?? "",
    open_close: record["OpenCloseIndicator"] ?? record["Open/CloseIndicator"] ?? "",
    notes: record["Notes"] ?? record["Code"] ?? "",
    raw_json: JSON.stringify(record),
  };
}

// ── Helpers ────────────────────────────────────────────────────────────────

function parseFlexNum(val: string | undefined | null): number {
  if (!val || val.trim() === "" || val === "--") return 0;
  const cleaned = val.replace(/[$,"\s]/g, "");
  const n = Number(cleaned);
  return isNaN(n) ? 0 : n;
}

/** Normalize YYYYMMDD or YYYY-MM-DD or "20260115" → "2026-01-15" */
function normalizeFlexDate(raw: string): string {
  const s = raw.trim().replace(/"/g, "");
  if (!s) return "";
  // Already YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  // YYYYMMDD
  if (/^\d{8}$/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  // Try Date parse
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return s;
}

/** Split "20260115;153045" or "2026-01-15, 15:30:45" into [date, time] */
function splitDateTime(dt: string): [string, string] {
  if (!dt) return ["", ""];
  // YYYYMMDD;HHMMSS
  const semi = dt.split(";");
  if (semi.length === 2) {
    const time = semi[1].trim();
    const formattedTime = time.length === 6 ? `${time.slice(0, 2)}:${time.slice(2, 4)}:${time.slice(4, 6)}` : time;
    return [semi[0].trim(), formattedTime];
  }
  // "2026-01-15, 15:30:45" or "2026-01-15 15:30:45"
  const parts = dt.split(/[,\s]+/).filter(Boolean);
  if (parts.length >= 2) return [parts[0], parts.slice(1).join(" ")];
  return [dt.trim(), ""];
}

function normalizeSide(raw: string): string {
  const s = raw.trim().toUpperCase();
  if (s === "BUY" || s === "B" || s === "BOT") return "BUY";
  if (s === "SELL" || s === "S" || s === "SLD") return "SELL";
  return s;
}

function emptyResult(error: string): FlexParseResult {
  return {
    trades: [],
    report_type: "unknown",
    account_id: "",
    from_date: "",
    to_date: "",
    generated_at: "",
    total_rows: 0,
    parsed: 0,
    errors: [error],
  };
}
