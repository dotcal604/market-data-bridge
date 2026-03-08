/**
 * Sentry instrumentation — must be imported BEFORE any other application code.
 *
 * In index.ts the import order is:
 *   1. suppress-stdout.js  (redirects console.log → stderr for MCP)
 *   2. ./instrument.js      (this file — initializes Sentry)
 *   3. everything else
 *
 * Sentry auto-captures:
 *   - unhandled promise rejections
 *   - uncaught exceptions
 *   - Express request traces (via setupExpressErrorHandler)
 *   - HTTP client spans
 *
 * Set SENTRY_DSN in your .env to enable. Without a DSN, Sentry is a no-op.
 */
import * as Sentry from "@sentry/node";

const dsn = process.env.SENTRY_DSN ?? "";

Sentry.init({
  dsn: dsn || undefined, // undefined = disabled (no-op SDK)
  environment: process.env.NODE_ENV ?? "development",
  release: process.env.npm_package_version ?? "unknown",

  // Sample 100% of errors, 20% of traces (tune down if volume grows)
  tracesSampleRate: parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE ?? "0.2"),

  // Attach server name for multi-machine disambiguation
  serverName: process.env.COMPUTERNAME ?? process.env.HOSTNAME ?? undefined,

  // Don't send PII (IP addresses, user agent strings)
  sendDefaultPii: false,

  // Filter noisy errors that aren't actionable
  beforeSend(event) {
    const msg = event.exception?.values?.[0]?.value ?? "";

    // IBKR transient disconnects — these are expected during market close / TWS restarts
    if (msg.includes("ECONNREFUSED") && msg.includes("4002")) return null;
    if (msg.includes("ECONNREFUSED") && msg.includes("7497")) return null;
    if (msg.includes("ECONNREFUSED") && msg.includes("7496")) return null;

    // Yahoo Finance rate limit / scraper errors — expected, handled by fallback
    if (msg.includes("yahoo-finance2")) return null;

    return event;
  },

  integrations: [
    // HTTP integration is auto-added in v8+
    // Express integration is added via setupExpressErrorHandler()
  ],
});

if (dsn) {
  // stderr because stdout is reserved for MCP stdio transport
  process.stderr.write(`[SENTRY] Initialized — DSN=${dsn.replace(/\/\/.*@/, "//***@")}\n`);
} else {
  process.stderr.write("[SENTRY] Disabled — no SENTRY_DSN set\n");
}

export { Sentry };
