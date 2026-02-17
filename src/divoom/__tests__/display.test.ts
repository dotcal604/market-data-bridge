import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { DivoomDisplay } from "../display.js";
import type { DashboardData } from "../display.js";

// Mock fetch globally
global.fetch = vi.fn();

describe("DivoomDisplay", () => {
  let display: DivoomDisplay;
  const testIp = "192.168.1.100";

  beforeEach(() => {
    display = new DivoomDisplay(testIp);
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("getDeviceInfo", () => {
    it("sends Device/GetDeviceId command", async () => {
      const mockResponse = { DeviceId: 123456, DeviceName: "Times Gate" };
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await display.getDeviceInfo();

      expect(global.fetch).toHaveBeenCalledWith(
        `http://${testIp}/post`,
        expect.objectContaining({
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ Command: "Device/GetDeviceId" }),
        })
      );
      expect(result).toEqual(mockResponse);
    });

    it("throws error on fetch failure", async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
      });

      await expect(display.getDeviceInfo()).rejects.toThrow("HTTP 500");
    });

    it("throws error on network timeout", async () => {
      (global.fetch as any).mockRejectedValueOnce(new Error("Network timeout"));

      await expect(display.getDeviceInfo()).rejects.toThrow("Network timeout");
    });
  });

  describe("setBrightness", () => {
    it("sends Channel/SetBrightness command with valid level", async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ error_code: 0 }),
      });

      await display.setBrightness(75);

      expect(global.fetch).toHaveBeenCalledWith(
        `http://${testIp}/post`,
        expect.objectContaining({
          body: JSON.stringify({
            Command: "Channel/SetBrightness",
            Brightness: 75,
          }),
        })
      );
    });

    it("throws error for brightness < 0", async () => {
      await expect(display.setBrightness(-1)).rejects.toThrow("Brightness must be between 0 and 100");
    });

    it("throws error for brightness > 100", async () => {
      await expect(display.setBrightness(101)).rejects.toThrow("Brightness must be between 0 and 100");
    });

    it("accepts brightness 0", async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ error_code: 0 }),
      });

      await display.setBrightness(0);
      expect(global.fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: expect.stringContaining('"Brightness":0'),
        })
      );
    });

    it("accepts brightness 100", async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ error_code: 0 }),
      });

      await display.setBrightness(100);
      expect(global.fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: expect.stringContaining('"Brightness":100'),
        })
      );
    });
  });

  describe("sendText", () => {
    it("sends Draw/SendHttpText command with text and default options", async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ error_code: 0 }),
      });

      await display.sendText("Hello World");

      const call = (global.fetch as any).mock.calls[0];
      const body = JSON.parse(call[1].body);

      expect(body.Command).toBe("Draw/SendHttpText");
      expect(body.TextString).toBe("Hello World");
      expect(body.TextId).toBe(1);
      expect(body.x).toBe(0);
      expect(body.y).toBe(0);
      expect(body.color).toBe("#FFFFFF");
      expect(body.font).toBe(2);
      expect(body.speed).toBe(50);
    });

    it("sends Draw/SendHttpText with custom options", async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ error_code: 0 }),
      });

      await display.sendText("Custom", {
        x: 10,
        y: 20,
        color: "#FF0000",
        font: 5,
        scrollSpeed: 80,
        align: 2,
      });

      const call = (global.fetch as any).mock.calls[0];
      const body = JSON.parse(call[1].body);

      expect(body.x).toBe(10);
      expect(body.y).toBe(20);
      expect(body.color).toBe("#FF0000");
      expect(body.font).toBe(5);
      expect(body.speed).toBe(80);
      expect(body.align).toBe(2);
    });
  });

  describe("sendScrollingText", () => {
    it("sends Led/SetText command with RGB color conversion", async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ error_code: 0 }),
      });

      await display.sendScrollingText("Scrolling Text", "#00FF00");

      const call = (global.fetch as any).mock.calls[0];
      const body = JSON.parse(call[1].body);

      expect(body.Command).toBe("Led/SetText");
      expect(body.TextString).toBe("Scrolling Text");
      expect(body.r).toBe(0);
      expect(body.g).toBe(255);
      expect(body.b).toBe(0);
    });

    it("converts hex color #FF0000 to RGB (255,0,0)", async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ error_code: 0 }),
      });

      await display.sendScrollingText("Red", "#FF0000");

      const call = (global.fetch as any).mock.calls[0];
      const body = JSON.parse(call[1].body);

      expect(body.r).toBe(255);
      expect(body.g).toBe(0);
      expect(body.b).toBe(0);
    });
  });

  describe("clear", () => {
    it("sends blank text to clear display", async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ error_code: 0 }),
      });

      await display.clear();

      const call = (global.fetch as any).mock.calls[0];
      const body = JSON.parse(call[1].body);

      expect(body.Command).toBe("Draw/SendHttpText");
      expect(body.TextString).toBe(" ");
      expect(body.x).toBe(0);
      expect(body.y).toBe(0);
    });
  });

  describe("sendDashboard", () => {
    it("sends multi-line dashboard with color-coded P&L", async () => {
      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => ({ error_code: 0 }),
      });

      const data: DashboardData = {
        pnl: 250.75,
        winRate: 0.65,
        tradeCount: 10,
        positions: [
          { symbol: "AAPL", quantity: 100, avgPrice: 150, currentPrice: 155 },
        ],
        spy: 525.50,
        qqq: 480.25,
      };

      await display.sendDashboard(data);

      // Should have made 4 fetch calls (4 lines minimum)
      expect((global.fetch as any).mock.calls.length).toBeGreaterThanOrEqual(4);

      // Check P&L line (green for positive)
      const pnlCall = (global.fetch as any).mock.calls[0];
      const pnlBody = JSON.parse(pnlCall[1].body);
      expect(pnlBody.TextString).toContain("PnL: +$250.75");
      expect(pnlBody.color).toBe("#00FF00");
      expect(pnlBody.y).toBe(0);

      // Check win rate line
      const wrCall = (global.fetch as any).mock.calls[1];
      const wrBody = JSON.parse(wrCall[1].body);
      expect(wrBody.TextString).toContain("WR: 65.0% (10)");
      expect(wrBody.y).toBe(16);

      // Check positions line
      const posCall = (global.fetch as any).mock.calls[2];
      const posBody = JSON.parse(posCall[1].body);
      expect(posBody.TextString).toContain("Positions: 1");
      expect(posBody.y).toBe(32);

      // Check market line
      const mktCall = (global.fetch as any).mock.calls[3];
      const mktBody = JSON.parse(mktCall[1].body);
      expect(mktBody.TextString).toContain("SPY: 525.50");
      expect(mktBody.TextString).toContain("QQQ: 480.25");
      expect(mktBody.y).toBe(48);
    });

    it("uses red color for negative P&L", async () => {
      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => ({ error_code: 0 }),
      });

      const data: DashboardData = {
        pnl: -150.25,
        winRate: 0.4,
        tradeCount: 5,
        positions: [],
        spy: 525.50,
        qqq: 480.25,
      };

      await display.sendDashboard(data);

      const pnlCall = (global.fetch as any).mock.calls[0];
      const pnlBody = JSON.parse(pnlCall[1].body);
      expect(pnlBody.TextString).toContain("PnL: -$150.25");
      expect(pnlBody.color).toBe("#FF0000");
    });

    it("displays Holly alert when present", async () => {
      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => ({ error_code: 0 }),
      });

      const data: DashboardData = {
        pnl: 0,
        winRate: 0,
        tradeCount: 0,
        positions: [],
        hollyAlert: {
          symbol: "AAPL",
          strategy: "Holly Grail",
          entryPrice: 150.50,
        },
        spy: 525.50,
        qqq: 480.25,
      };

      await display.sendDashboard(data);

      // Should have 5 lines (4 default + 1 Holly)
      expect((global.fetch as any).mock.calls.length).toBe(5);

      const hollyCall = (global.fetch as any).mock.calls[4];
      const hollyBody = JSON.parse(hollyCall[1].body);
      expect(hollyBody.TextString).toContain("Holly: AAPL");
      expect(hollyBody.TextString).toContain("@150.50");
      expect(hollyBody.color).toBe("#FF00FF");
      expect(hollyBody.y).toBe(64);
    });

    it("shows gray positions color when no positions", async () => {
      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => ({ error_code: 0 }),
      });

      const data: DashboardData = {
        pnl: 0,
        winRate: 0,
        tradeCount: 0,
        positions: [],
        spy: 525.50,
        qqq: 480.25,
      };

      await display.sendDashboard(data);

      const posCall = (global.fetch as any).mock.calls[2];
      const posBody = JSON.parse(posCall[1].body);
      expect(posBody.color).toBe("#808080");
    });

    it("shows cyan positions color when positions exist", async () => {
      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => ({ error_code: 0 }),
      });

      const data: DashboardData = {
        pnl: 0,
        winRate: 0,
        tradeCount: 0,
        positions: [
          { symbol: "AAPL", quantity: 100, avgPrice: 150, currentPrice: 155 },
        ],
        spy: 525.50,
        qqq: 480.25,
      };

      await display.sendDashboard(data);

      const posCall = (global.fetch as any).mock.calls[2];
      const posBody = JSON.parse(posCall[1].body);
      expect(posBody.color).toBe("#00FFFF");
    });
  });

  describe("testConnection", () => {
    it("returns true when device responds", async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ DeviceId: 123 }),
      });

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
