/**
 * IBKR Flex Web Service Client
 *
 * Two-step flow:
 *   1. POST SendRequest → get ReferenceCode
 *   2. POST GetStatement with ReferenceCode → get report XML/CSV
 *
 * Endpoints:
 *   - https://gdcdyn.interactivebrokers.com/Universal/servlet/FlexStatementService.SendRequest
 *   - https://gdcdyn.interactivebrokers.com/Universal/servlet/FlexStatementService.GetStatement
 *
 * @see https://www.interactivebrokers.com/en/software/am/am/reports/flex_web_service_version_3.htm
 */

import { logger } from "../logging.js";

const log = logger.child({ module: "flex-client" });

const BASE = "https://gdcdyn.interactivebrokers.com/Universal/servlet";
const SEND_REQUEST_URL = `${BASE}/FlexStatementService.SendRequest`;
const GET_STATEMENT_URL = `${BASE}/FlexStatementService.GetStatement`;

/** Default poll settings */
const DEFAULT_POLL_INTERVAL_MS = 5_000;
const DEFAULT_MAX_POLLS = 60; // 5 min max wait

export interface FlexRequestResult {
  referenceCode: string;
  url: string;
}

export interface FlexStatementResult {
  content: string;
  format: "xml" | "csv";
  referenceCode: string;
}

/**
 * Step 1: Request a Flex report.
 * Returns a reference code to poll for results.
 */
export async function sendFlexRequest(
  queryId: string,
  token: string,
  version: number = 3,
): Promise<FlexRequestResult> {
  const url = `${SEND_REQUEST_URL}?t=${encodeURIComponent(token)}&q=${encodeURIComponent(queryId)}&v=${version}`;
  log.info({ queryId }, "Requesting Flex report");

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Flex SendRequest HTTP ${res.status}: ${res.statusText}`);
  }

  const text = await res.text();

  // Parse response XML: <FlexStatementResponse><Status>Success</Status><ReferenceCode>...</ReferenceCode><Url>...</Url></FlexStatementResponse>
  const statusMatch = text.match(/<Status>([^<]+)<\/Status>/);
  const status = statusMatch?.[1]?.trim();

  if (status !== "Success") {
    const errorCode = text.match(/<ErrorCode>([^<]+)<\/ErrorCode>/)?.[1] ?? "unknown";
    const errorMsg = text.match(/<ErrorMessage>([^<]+)<\/ErrorMessage>/)?.[1] ?? text;
    throw new Error(`Flex SendRequest failed (${errorCode}): ${errorMsg}`);
  }

  const refCode = text.match(/<ReferenceCode>([^<]+)<\/ReferenceCode>/)?.[1]?.trim();
  const resultUrl = text.match(/<Url>([^<]+)<\/Url>/)?.[1]?.trim();

  if (!refCode) {
    throw new Error("Flex SendRequest: no ReferenceCode in response");
  }

  log.info({ queryId, referenceCode: refCode }, "Flex report requested");

  return {
    referenceCode: refCode,
    url: resultUrl ?? GET_STATEMENT_URL,
  };
}

/**
 * Step 2: Download a Flex report using the reference code.
 * Polls until the report is ready.
 */
export async function getFlexStatement(
  referenceCode: string,
  token: string,
  opts?: { pollIntervalMs?: number; maxPolls?: number },
): Promise<FlexStatementResult> {
  const pollInterval = opts?.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const maxPolls = opts?.maxPolls ?? DEFAULT_MAX_POLLS;

  for (let attempt = 1; attempt <= maxPolls; attempt++) {
    const url = `${GET_STATEMENT_URL}?t=${encodeURIComponent(token)}&q=${encodeURIComponent(referenceCode)}&v=3`;

    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Flex GetStatement HTTP ${res.status}: ${res.statusText}`);
    }

    const text = await res.text();

    // Check if it's an error/status response (XML with Status element)
    const statusMatch = text.match(/<Status>([^<]+)<\/Status>/);
    if (statusMatch) {
      const status = statusMatch[1].trim();
      if (status === "Warn") {
        // Report not ready yet — ErrorCode 1019 = "Statement is being generated"
        const errorCode = text.match(/<ErrorCode>([^<]+)<\/ErrorCode>/)?.[1] ?? "";
        if (errorCode === "1019") {
          log.debug({ attempt, maxPolls }, "Flex report generating, polling...");
          await sleep(pollInterval);
          continue;
        }
      }
      if (status === "Fail") {
        const errorCode = text.match(/<ErrorCode>([^<]+)<\/ErrorCode>/)?.[1] ?? "unknown";
        const errorMsg = text.match(/<ErrorMessage>([^<]+)<\/ErrorMessage>/)?.[1] ?? text;
        throw new Error(`Flex GetStatement failed (${errorCode}): ${errorMsg}`);
      }
    }

    // If we get here, it's the actual report content
    const format = text.trim().startsWith("<") ? "xml" : "csv";
    log.info({ referenceCode, format, attempt, contentLength: text.length }, "Flex report downloaded");

    return { content: text, format, referenceCode };
  }

  throw new Error(`Flex report not ready after ${maxPolls} polls (${(maxPolls * pollInterval) / 1000}s)`);
}

/**
 * Convenience: request + poll + download in one call.
 */
export async function fetchFlexReport(
  queryId: string,
  token: string,
  opts?: { pollIntervalMs?: number; maxPolls?: number },
): Promise<FlexStatementResult> {
  const { referenceCode } = await sendFlexRequest(queryId, token);
  return getFlexStatement(referenceCode, token, opts);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
