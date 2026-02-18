/**
 * Ops webhook dispatcher — sends incident notifications to Discord/Slack.
 *
 * Deduplicates by incident type within a 5-minute window.
 * Retries with exponential backoff (3 attempts).
 * No-ops silently when OPS_WEBHOOK_URL is not configured.
 */
import { config } from "../config.js";
import type { Incident } from "./metrics.js";

const DEDUP_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
const MAX_RETRIES = 3;
const RETRY_BASE_MS = 1000;

// Dedup map: incident type → last dispatch timestamp
const lastDispatched = new Map<string, number>();

const SEVERITY_EMOJI: Record<string, string> = {
  critical: "\u{1F534}", // red circle
  warning: "\u{1F7E1}",  // yellow circle
  info: "\u{1F535}",      // blue circle
};

function formatMessage(incident: Incident): string {
  const emoji = SEVERITY_EMOJI[incident.severity] ?? "\u{2139}\u{FE0F}";
  const sev = incident.severity.toUpperCase();
  return `${emoji} **${sev}**: \`${incident.type}\` — ${incident.detail}`;
}

async function postWithRetry(url: string, body: object): Promise<boolean> {
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10_000),
      });
      if (res.ok || res.status === 204) return true;
      // Discord rate limit
      if (res.status === 429) {
        const retryAfter = parseInt(res.headers.get("retry-after") ?? "2", 10);
        await new Promise((r) => setTimeout(r, retryAfter * 1000));
        continue;
      }
    } catch {
      // network error — retry
    }
    if (attempt < MAX_RETRIES - 1) {
      await new Promise((r) => setTimeout(r, RETRY_BASE_MS * Math.pow(2, attempt)));
    }
  }
  return false;
}

/**
 * Dispatch a webhook notification for an incident.
 * Fire-and-forget — don't await in the hot path.
 */
export function dispatchWebhook(incident: Incident): void {
  const url = config.ops?.webhookUrl;
  if (!url) return; // no-op if not configured

  // Dedup: skip if same type dispatched within 5 min
  const lastTime = lastDispatched.get(incident.type);
  if (lastTime && Date.now() - lastTime < DEDUP_WINDOW_MS) return;

  lastDispatched.set(incident.type, Date.now());

  // Clean up old dedup entries
  for (const [type, ts] of lastDispatched) {
    if (Date.now() - ts > DEDUP_WINDOW_MS * 2) lastDispatched.delete(type);
  }

  // Discord webhook format: { content: string }
  const message = formatMessage(incident);
  postWithRetry(url, { content: message }).catch(() => {
    // Swallow — webhook failures should not affect the bridge
  });
}

/** Exposed for testing */
export function _resetDedupForTest(): void {
  lastDispatched.clear();
}
