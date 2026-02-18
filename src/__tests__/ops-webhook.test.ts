import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { dispatchWebhook, _resetDedupForTest } from "../ops/webhook.js";
import type { Incident } from "../ops/metrics.js";

// Mock config to provide a webhook URL
vi.mock("../config.js", () => ({
  config: {
    ops: { webhookUrl: "https://discord.com/api/webhooks/test/fake" },
  },
}));

describe("ops webhook", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    _resetDedupForTest();
    fetchSpy = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetchSpy);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const makeIncident = (type = "ibkr_disconnect", severity: Incident["severity"] = "warning"): Incident => ({
    type,
    severity,
    timestamp: new Date().toISOString(),
    detail: "Test incident detail",
  });

  it("fires a webhook on incident", async () => {
    dispatchWebhook(makeIncident());
    // Give the fire-and-forget promise a tick to resolve
    await new Promise((r) => setTimeout(r, 50));
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchSpy.mock.calls[0];
    expect(url).toBe("https://discord.com/api/webhooks/test/fake");
    const body = JSON.parse(opts.body);
    expect(body.content).toContain("ibkr_disconnect");
    expect(body.content).toContain("WARNING");
  });

  it("deduplicates same incident type within 5 min", async () => {
    dispatchWebhook(makeIncident("ibkr_disconnect"));
    dispatchWebhook(makeIncident("ibkr_disconnect"));
    dispatchWebhook(makeIncident("ibkr_disconnect"));
    await new Promise((r) => setTimeout(r, 50));
    // Only the first should fire
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("allows different incident types through dedup", async () => {
    dispatchWebhook(makeIncident("ibkr_disconnect"));
    dispatchWebhook(makeIncident("ibkr_heartbeat_timeout"));
    await new Promise((r) => setTimeout(r, 50));
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("includes correct severity emoji", async () => {
    dispatchWebhook(makeIncident("test_critical", "critical"));
    await new Promise((r) => setTimeout(r, 50));
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.content).toContain("CRITICAL");
  });

  it("no-ops when webhook URL is empty", async () => {
    // Override config for this test
    const configModule = await import("../config.js");
    const orig = configModule.config.ops?.webhookUrl;
    (configModule.config as any).ops = { webhookUrl: "" };
    _resetDedupForTest();

    dispatchWebhook(makeIncident());
    await new Promise((r) => setTimeout(r, 50));
    expect(fetchSpy).not.toHaveBeenCalled();

    // Restore
    (configModule.config as any).ops = { webhookUrl: orig };
  });

  it("retries on fetch failure", async () => {
    fetchSpy
      .mockRejectedValueOnce(new Error("network error"))
      .mockRejectedValueOnce(new Error("network error"))
      .mockResolvedValueOnce({ ok: true, status: 200 });

    dispatchWebhook(makeIncident("retry_test"));
    // Wait for retries (1s + 2s base with backoff, but we're mocking so it's fast)
    await new Promise((r) => setTimeout(r, 5000));
    expect(fetchSpy.mock.calls.length).toBeGreaterThanOrEqual(2);
  }, 10_000);
});
