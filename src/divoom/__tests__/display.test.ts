import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { TimesFrameDisplay } from "../display.js";
import type { DisplayElement, TextUpdate } from "../display.js";

// Mock fetch globally
global.fetch = vi.fn();

describe("TimesFrameDisplay", () => {
  let display: TimesFrameDisplay;
  const testIp = "192.168.1.100";
  const testPort = 9000;

  beforeEach(() => {
    display = new TimesFrameDisplay(testIp, testPort);
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function mockOk(data: any = { error_code: 0 }) {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => data,
    });
  }

  function parseBody(callIndex = 0): any {
    const call = (global.fetch as any).mock.calls[callIndex];
    return JSON.parse(call[1].body);
  }

  // ─── Constructor ─────────────────────────────────────────

  it("builds correct base URL with IP and port", () => {
    const d = new TimesFrameDisplay("10.0.0.5", 8080);
    // Verify via a command that the URL is constructed correctly
    (global.fetch as any).mockResolvedValueOnce({
      ok: true, json: async () => ({}),
    });
    d.getDeviceInfo();
    expect((global.fetch as any).mock.calls[0][0]).toBe("http://10.0.0.5:8080/divoom_api");
  });

  it("defaults to port 9000", () => {
    const d = new TimesFrameDisplay("10.0.0.5");
    (global.fetch as any).mockResolvedValueOnce({
      ok: true, json: async () => ({}),
    });
    d.getDeviceInfo();
    expect((global.fetch as any).mock.calls[0][0]).toBe("http://10.0.0.5:9000/divoom_api");
  });

  // ─── getDeviceInfo ───────────────────────────────────────

  describe("getDeviceInfo", () => {
    it("sends Device/GetDeviceId command", async () => {
      const mockResponse = { DeviceId: 123456, DeviceName: "TimesFrame" };
      mockOk(mockResponse);

      const result = await display.getDeviceInfo();

      expect(global.fetch).toHaveBeenCalledWith(
        `http://${testIp}:${testPort}/divoom_api`,
        expect.objectContaining({
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ Command: "Device/GetDeviceId" }),
        })
      );
      expect(result).toEqual(mockResponse);
    });

    it("throws error on HTTP failure", async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: false, status: 500, statusText: "Internal Server Error",
      });
      await expect(display.getDeviceInfo()).rejects.toThrow("HTTP 500");
    });

    it("throws error on network timeout", async () => {
      (global.fetch as any).mockRejectedValueOnce(new Error("Network timeout"));
      await expect(display.getDeviceInfo()).rejects.toThrow("Network timeout");
    });
  });

  // ─── setBrightness ──────────────────────────────────────

  describe("setBrightness", () => {
    it("sends Channel/SetBrightness with valid level", async () => {
      mockOk();
      await display.setBrightness(75);
      const body = parseBody();
      expect(body.Command).toBe("Channel/SetBrightness");
      expect(body.Brightness).toBe(75);
    });

    it("throws for brightness < 0", async () => {
      await expect(display.setBrightness(-1)).rejects.toThrow("Brightness must be between 0 and 100");
    });

    it("throws for brightness > 100", async () => {
      await expect(display.setBrightness(101)).rejects.toThrow("Brightness must be between 0 and 100");
    });

    it("accepts boundary values 0 and 100", async () => {
      mockOk();
      await display.setBrightness(0);
      expect(parseBody().Brightness).toBe(0);

      mockOk();
      await display.setBrightness(100);
      expect(parseBody(1).Brightness).toBe(100);
    });
  });

  // ─── enterCustomMode ────────────────────────────────────

  describe("enterCustomMode", () => {
    it("sends Device/EnterCustomControlMode with elements and background", async () => {
      mockOk();

      const elements: DisplayElement[] = [
        {
          ID: 1,
          Type: "Text",
          StartX: 10,
          StartY: 20,
          Width: 780,
          Height: 40,
          Align: 1,
          FontSize: 36,
          FontID: 52,
          FontColor: "#00FFFF",
          BgColor: "#00000000",
          TextMessage: "OPEN · LIVE · 10:30 AM",
        },
      ];

      await display.enterCustomMode(elements, "http://example.com/bg.png");

      const body = parseBody();
      expect(body.Command).toBe("Device/EnterCustomControlMode");
      expect(body.BackgroudImageAddr).toBe("http://example.com/bg.png");
      expect(body.DispList).toHaveLength(1);
      expect(body.DispList[0].ID).toBe(1);
      expect(body.DispList[0].Type).toBe("Text");
      expect(body.DispList[0].TextMessage).toBe("OPEN · LIVE · 10:30 AM");
      expect(body.DispList[0].FontID).toBe(52);
    });

    it("omits background URL when empty", async () => {
      mockOk();
      await display.enterCustomMode([]);
      expect(parseBody().BackgroudImageAddr).toBeUndefined();
    });

    it("sets isInCustomMode to true after entering", async () => {
      mockOk();
      expect(display.isInCustomMode).toBe(false);
      await display.enterCustomMode([]);
      expect(display.isInCustomMode).toBe(true);
    });

    it("handles multiple elements", async () => {
      mockOk();

      const elements: DisplayElement[] = [
        { ID: 1, Type: "Text", StartX: 0, StartY: 0, Width: 800, Height: 40, Align: 1, FontSize: 36, FontID: 52, FontColor: "#FFFFFF", BgColor: "#00000000", TextMessage: "Header" },
        { ID: 10, Type: "Text", StartX: 16, StartY: 70, Width: 768, Height: 34, Align: 0, FontSize: 30, FontID: 52, FontColor: "#00FF00", BgColor: "#00000000", TextMessage: "SPY 580.25 +0.35%" },
        { ID: 11, Type: "Text", StartX: 16, StartY: 104, Width: 768, Height: 34, Align: 0, FontSize: 30, FontID: 52, FontColor: "#FF0000", BgColor: "#00000000", TextMessage: "QQQ 495.50 -0.12%" },
      ];

      await display.enterCustomMode(elements);
      expect(parseBody().DispList).toHaveLength(3);
    });
  });

  // ─── updateTexts ────────────────────────────────────────

  describe("updateTexts", () => {
    it("sends Device/UpdateDisplayItems with text updates", async () => {
      mockOk(); // for enterCustomMode
      await display.enterCustomMode([]);

      mockOk();
      const updates: TextUpdate[] = [
        { ID: 1, TextMessage: "Updated header" },
        { ID: 10, TextMessage: "SPY 581.00 +0.48%" },
      ];

      await display.updateTexts(updates);
      const body = parseBody(1);
      expect(body.Command).toBe("Device/UpdateDisplayItems");
      expect(body.DispList).toHaveLength(2);
      expect(body.DispList[0].ID).toBe(1);
      expect(body.DispList[0].TextMessage).toBe("Updated header");
    });
  });

  // ─── exitCustomMode ─────────────────────────────────────

  describe("exitCustomMode", () => {
    it("sends Device/ExitCustomControlMode", async () => {
      mockOk(); // enter
      await display.enterCustomMode([]);

      mockOk(); // exit
      await display.exitCustomMode();

      const body = parseBody(1);
      expect(body.Command).toBe("Device/ExitCustomControlMode");
    });

    it("sets isInCustomMode to false after exiting", async () => {
      mockOk();
      await display.enterCustomMode([]);
      expect(display.isInCustomMode).toBe(true);

      mockOk();
      await display.exitCustomMode();
      expect(display.isInCustomMode).toBe(false);
    });
  });

  // ─── testConnection ─────────────────────────────────────

  describe("testConnection", () => {
    it("returns true when device responds", async () => {
      mockOk({ DeviceId: 123 });
      const result = await display.testConnection();
      expect(result).toBe(true);
    });

    it("returns false when device is offline", async () => {
      (global.fetch as any).mockRejectedValueOnce(new Error("Connection refused"));
      const result = await display.testConnection();
      expect(result).toBe(false);
    });
  });
});
