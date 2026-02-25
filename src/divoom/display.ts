/**
 * TimesFrame Display Controller
 *
 * HTTP client for Divoom TimesFrame (1080P IPS transparent display).
 * Protocol: POST to http://<device-ip>:<port>/divoom_api
 *
 * Key commands:
 * - Device/EnterCustomControlMode — define full layout with positioned elements
 * - Device/UpdateDisplayItems     — update Text elements by ID (text only)
 * - Device/ExitCustomControlMode  — leave custom display mode
 *
 * Canvas: 800x1280 (portrait orientation)
 * Fonts:  Real TTF via FontID (52 = clean sans-serif)
 */

import { logger } from "../logging.js";

const log = logger.child({ module: "divoom" });

// ─── Types ──────────────────────────────────────────────────

export type ElementType =
  | "Text" | "Image" | "NetData" | "Time" | "Date"
  | "Weather" | "Temperature" | "MonYear" | "Mday"
  | "Year" | "Month" | "Week";

export interface DisplayElement {
  ID: number;
  Type: ElementType;
  StartX: number;
  StartY: number;
  Width: number;
  Height: number;
  Align: 0 | 1 | 2; // 0=left, 1=center, 2=right
  FontSize: number;
  FontID: number;
  FontColor: string;
  BgColor: string;
  TextMessage?: string;
  // NetData-specific
  Url?: string;
  RuleInfo?: string;
  RequestTime?: number;
  // Image-specific
  ImgLocalFlag?: 0 | 1;
}

export interface TextUpdate {
  ID: number;
  TextMessage: string;
}

// ─── TimesFrame Display Client ──────────────────────────────

export class TimesFrameDisplay {
  private readonly deviceIp: string;
  private readonly port: number;
  private readonly baseUrl: string;
  private customMode = false;

  constructor(deviceIp: string, port = 9000) {
    this.deviceIp = deviceIp;
    this.port = port;
    this.baseUrl = `http://${deviceIp}:${port}/divoom_api`;
  }

  // ─── Low-level command ──────────────────────────────────

  private async sendCommand(command: string, payload: Record<string, unknown> = {}): Promise<any> {
    const body = { Command: command, ...payload };

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
      log.error({ err: err.message, command, deviceIp: this.deviceIp }, "TimesFrame command failed");
      throw err;
    }
  }

  // ─── Custom Control Mode ────────────────────────────────

  /**
   * Enter custom control mode with a full layout definition.
   * All elements (Text, Image, Time, etc.) are positioned on the 800x1280 canvas.
   */
  async enterCustomMode(elements: DisplayElement[], backgroundUrl = ""): Promise<void> {
    // Log element summary for diagnostics
    const summary = elements.map((e) => ({
      id: e.ID,
      type: e.Type,
      y: e.StartY,
      h: e.Height,
      ...(e.Type === "Image" ? { url: e.Url?.split("/").pop() } : {}),
      ...(e.Type === "Text" ? { text: e.TextMessage?.slice(0, 30) } : {}),
    }));
    log.info({ elementCount: elements.length, elements: summary }, "Sending DispList to device");

    const response = await this.sendCommand("Device/EnterCustomControlMode", {
      BackgroudImageAddr: backgroundUrl,
      DispList: elements,
    });

    // Log device response (may contain error_code)
    if (response) {
      log.info({ response }, "Device response to EnterCustomControlMode");
    }

    this.customMode = true;
  }

  /**
   * Update text content of elements by ID (text-only, no color/position changes).
   * Must be in custom mode first.
   */
  async updateTexts(updates: TextUpdate[]): Promise<void> {
    await this.sendCommand("Device/UpdateDisplayItems", {
      DispList: updates,
    });
    log.debug({ updateCount: updates.length }, "Display items updated");
  }

  /**
   * Exit custom control mode (returns to normal display).
   */
  async exitCustomMode(): Promise<void> {
    await this.sendCommand("Device/ExitCustomControlMode", {});
    this.customMode = false;
    log.debug("Exited custom control mode");
  }

  // ─── Device Control ─────────────────────────────────────

  async getDeviceInfo(): Promise<any> {
    return this.sendCommand("Device/GetDeviceId");
  }

  async setBrightness(level: number): Promise<void> {
    if (level < 0 || level > 100) {
      throw new Error("Brightness must be between 0 and 100");
    }
    await this.sendCommand("Channel/SetBrightness", { Brightness: level });
    log.info({ brightness: level }, "Brightness set");
  }

  async testConnection(): Promise<boolean> {
    try {
      await this.getDeviceInfo();
      return true;
    } catch {
      return false;
    }
  }

  get isInCustomMode(): boolean {
    return this.customMode;
  }
}
