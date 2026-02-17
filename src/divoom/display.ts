/**
 * Divoom Times Gate Display Controller
 *
 * Sends live trading data to Divoom Times Gate pixel art display over HTTP API.
 * Protocol: POST to http://<device-ip>/post with JSON body.
 *
 * API Docs:
 * - Official: https://docin.divoom-gz.com/web/#/5/140
 * - Community: https://divoom.2a03.party/api/app.html
 */

import { logger } from "../logging.js";

const log = logger.child({ module: "divoom" });

export interface DivoomTextOptions {
  x?: number;
  y?: number;
  color?: string; // Hex format: "#FF0000"
  font?: number;
  textWidth?: number;
  scrollSpeed?: number; // 0-100
  scrollDirection?: 0 | 1; // 0=left, 1=right
  align?: 1 | 2 | 3; // 1=left, 2=center, 3=right
}

export interface DashboardData {
  pnl: number;
  winRate: number;
  tradeCount: number;
  positions: Array<{ symbol: string; quantity: number; avgPrice: number; currentPrice: number }>;
  hollyAlert?: { symbol: string; strategy: string; entryPrice: number };
  spy: number;
  qqq: number;
}

/**
 * DivoomDisplay - HTTP client for Divoom Times Gate API
 */
export class DivoomDisplay {
  private readonly deviceIp: string;
  private readonly baseUrl: string;

  constructor(deviceIp: string) {
    this.deviceIp = deviceIp;
    this.baseUrl = `http://${deviceIp}/post`;
  }

  /**
   * Send raw command to device
   */
  private async sendCommand(command: string, payload: Record<string, any>): Promise<any> {
    const body = {
      Command: command,
      ...payload,
    };

    try {
      const response = await fetch(this.baseUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(5000),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      return data;
    } catch (err: any) {
      log.error({ err: err.message, command, deviceIp: this.deviceIp }, "Divoom command failed");
      throw err;
    }
  }

  /**
   * Get device information
   */
  async getDeviceInfo(): Promise<any> {
    return this.sendCommand("Device/GetDeviceId", {});
  }

  /**
   * Set display brightness (0-100)
   */
  async setBrightness(level: number): Promise<void> {
    if (level < 0 || level > 100) {
      throw new Error("Brightness must be between 0 and 100");
    }
    await this.sendCommand("Channel/SetBrightness", { Brightness: level });
    log.info({ brightness: level }, "Brightness set");
  }

  /**
   * Send text to display using Draw/SendHttpText
   */
  async sendText(text: string, options: DivoomTextOptions = {}): Promise<void> {
    const payload = {
      TextId: 1,
      x: options.x ?? 0,
      y: options.y ?? 0,
      dir: options.scrollDirection ?? 0,
      font: options.font ?? 2,
      TextWidth: options.textWidth ?? 128,
      speed: options.scrollSpeed ?? 50,
      TextString: text,
      color: options.color ?? "#FFFFFF",
      align: options.align ?? 1,
    };

    await this.sendCommand("Draw/SendHttpText", payload);
    log.debug({ text, options }, "Text sent to display");
  }

  /**
   * Send scrolling text using Led/SetText
   */
  async sendScrollingText(text: string, color = "#FFFFFF"): Promise<void> {
    // Parse hex color to RGB
    const hex = color.replace("#", "");
    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);

    await this.sendCommand("Led/SetText", {
      TextString: text,
      r,
      g,
      b,
    });
    log.debug({ text, color }, "Scrolling text sent");
  }

  /**
   * Clear the display (send blank text)
   */
  async clear(): Promise<void> {
    await this.sendText(" ", { x: 0, y: 0 });
    log.info("Display cleared");
  }

  /**
   * Send multi-line dashboard data
   */
  async sendDashboard(data: DashboardData): Promise<void> {
    const lines: Array<{ text: string; y: number; color: string }> = [];

    // Line 1: P&L
    const pnlColor = data.pnl >= 0 ? "#00FF00" : "#FF0000";
    const pnlSign = data.pnl >= 0 ? "+" : "";
    const pnlText = data.pnl >= 0 ? `${pnlSign}$${data.pnl.toFixed(2)}` : `-$${Math.abs(data.pnl).toFixed(2)}`;
    lines.push({
      text: `PnL: ${pnlText}`,
      y: 0,
      color: pnlColor,
    });

    // Line 2: Win Rate
    lines.push({
      text: `WR: ${(data.winRate * 100).toFixed(1)}% (${data.tradeCount})`,
      y: 16,
      color: "#FFFF00",
    });

    // Line 3: Positions count
    const posCount = data.positions.length;
    lines.push({
      text: `Positions: ${posCount}`,
      y: 32,
      color: posCount > 0 ? "#00FFFF" : "#808080",
    });

    // Line 4: Market indices
    lines.push({
      text: `SPY: ${data.spy.toFixed(2)} QQQ: ${data.qqq.toFixed(2)}`,
      y: 48,
      color: "#FFFFFF",
    });

    // Line 5: Holly alert (if present)
    if (data.hollyAlert) {
      lines.push({
        text: `Holly: ${data.hollyAlert.symbol} @${data.hollyAlert.entryPrice.toFixed(2)}`,
        y: 64,
        color: "#FF00FF",
      });
    }

    // Send all lines sequentially
    for (const line of lines) {
      await this.sendText(line.text, {
        x: 0,
        y: line.y,
        color: line.color,
        font: 2,
        align: 1,
      });
    }

    log.info({ pnl: data.pnl, positions: posCount }, "Dashboard sent");
  }

  /**
   * Test connection to device
   */
  async testConnection(): Promise<boolean> {
    try {
      await this.getDeviceInfo();
      return true;
    } catch {
      return false;
    }
  }
}
