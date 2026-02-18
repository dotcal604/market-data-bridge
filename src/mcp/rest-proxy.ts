/**
 * REST Proxy for MCP-only mode.
 *
 * When the MCP server runs in `--mode mcp`, it does NOT connect to TWS directly
 * (to avoid clientId collisions with the REST bridge). Instead, IBKR-requiring
 * actions are forwarded to the already-running REST bridge at localhost:PORT.
 *
 * This proxy is only activated when `isConnected()` returns false — if MCP
 * happens to be running in `--mode both` (with a direct TWS connection),
 * the direct path is used and this module is never called.
 */

import { config } from "../config.js";
import { isConnected } from "../ibkr/connection.js";

const BASE_URL = `http://127.0.0.1:${config.rest.port}`;
const API_KEY = config.rest.apiKey;
const TIMEOUT_MS = 30_000;

type McpResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

/**
 * Proxy an agent action through the REST bridge.
 * Returns the parsed `result` field from the REST response.
 */
export async function proxyToRest(action: string, params?: Record<string, unknown>): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const body: Record<string, unknown> = { action };
    if (params && Object.keys(params).length > 0) {
      body.params = params;
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (API_KEY) {
      headers["x-api-key"] = API_KEY;
    }

    const res = await fetch(`${BASE_URL}/api/agent`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`REST bridge returned ${res.status}: ${text.slice(0, 200)}`);
    }

    const json = (await res.json()) as { action: string; result?: unknown; error?: string };
    if (json.error) {
      throw new Error(json.error);
    }
    return json.result;
  } catch (e: any) {
    if (e.name === "AbortError") {
      throw new Error(`REST proxy timeout after ${TIMEOUT_MS}ms for action=${action}`);
    }
    // Connection refused = REST bridge not running
    if (e.cause?.code === "ECONNREFUSED" || e.message?.includes("ECONNREFUSED")) {
      throw new Error(
        `REST bridge not reachable at ${BASE_URL}. ` +
        `Ensure 'pm2 start market-bridge' is running (--mode rest or --mode both).`
      );
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * MCP tool handler for IBKR-requiring actions.
 *
 * If TWS is connected locally (--mode both), runs `localFn()` directly.
 * If not (--mode mcp), proxies through the REST bridge's /api/agent endpoint.
 *
 * Returns properly formatted MCP tool results in both paths.
 *
 * Usage:
 * ```
 * async (params) => ibkrTool(
 *   "get_account_summary",
 *   () => getAccountSummary(),
 *   params,   // optional — forwarded to REST proxy
 * )
 * ```
 */
export async function ibkrTool(
  action: string,
  localFn: () => Promise<unknown>,
  params?: Record<string, unknown>,
): Promise<McpResult> {
  try {
    if (isConnected()) {
      // Direct path — TWS available locally
      const result = await localFn();
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
    // Proxy path — forward to REST bridge
    const result = await proxyToRest(action, params);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  } catch (e: any) {
    return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
  }
}
