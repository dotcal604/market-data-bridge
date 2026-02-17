import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "events";
import { EventName } from "@stoqey/ib";

// ── Mock setup ──────────────────────────────────────────────────────────────

let mockServerVersion = 178;

class MockIBApi extends EventEmitter {
  connect = vi.fn();
  disconnect = vi.fn();
  get serverVersion() {
    return mockServerVersion;
  }
}

let mockIBInstance: MockIBApi;

vi.mock("@stoqey/ib", async () => {
  const actual = await vi.importActual<typeof import("@stoqey/ib")>("@stoqey/ib");
  return {
    ...actual,
    IBApi: class extends EventEmitter {
      connect = vi.fn();
      disconnect = vi.fn();
      get serverVersion() {
        return mockServerVersion;
      }
      constructor(_opts?: any) {
        super();
        // Store reference so tests can emit events on this instance
        mockIBInstance = this as any;
      }
    },
  };
});

vi.mock("../../config.js", () => ({
  config: {
    ibkr: {
      host: "127.0.0.1",
      port: 7497,
      clientId: 0,
      maxClientIdRetries: 3,
    },
  },
}));

// ── Tests ────────────────────────────────────────────────────────────────────

describe("connection — TWS version check", () => {
  beforeEach(() => {
    vi.resetModules();
    mockServerVersion = 178;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("getTwsVersion returns null before connection", async () => {
    const mod = await import("../connection.js");
    expect(mod.getTwsVersion()).toBeNull();
  });

  it("captures serverVersion on connect", async () => {
    const mod = await import("../connection.js");
    mod.getIB(); // creates the IBApi instance + registers handlers
    mockIBInstance.emit(EventName.connected);
    expect(mod.getTwsVersion()).toBe(178);
  });

  it("includes twsVersion in getConnectionStatus", async () => {
    const mod = await import("../connection.js");
    mod.getIB();
    mockIBInstance.emit(EventName.connected);

    const status = mod.getConnectionStatus();
    expect(status.twsVersion).toBe(178);
    expect(status.connected).toBe(true);
  });

  it("resets twsVersion to null on disconnect", async () => {
    const mod = await import("../connection.js");
    mod.getIB();

    mockIBInstance.emit(EventName.connected);
    expect(mod.getTwsVersion()).toBe(178);

    mockIBInstance.emit(EventName.disconnected);
    expect(mod.getTwsVersion()).toBeNull();
  });

  it("logs warning when serverVersion is below minimum", async () => {
    mockServerVersion = 150; // below MIN_TWS_VERSION (163)
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    const mod = await import("../connection.js");
    mod.getIB();
    mockIBInstance.emit(EventName.connected);

    const warningCall = spy.mock.calls.find(
      (args) => typeof args[0] === "string" && args[0].includes("WARNING: TWS server version")
    );
    expect(warningCall).toBeDefined();
    expect(warningCall![0]).toContain("150");
    expect(warningCall![0]).toContain("below minimum");

    spy.mockRestore();
  });

  it("does NOT log warning when serverVersion meets minimum", async () => {
    mockServerVersion = 178; // above MIN_TWS_VERSION (163)
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    const mod = await import("../connection.js");
    mod.getIB();
    mockIBInstance.emit(EventName.connected);

    const warningCall = spy.mock.calls.find(
      (args) => typeof args[0] === "string" && args[0].includes("WARNING: TWS server version")
    );
    expect(warningCall).toBeUndefined();

    spy.mockRestore();
  });

  it("includes serverVersion in connect log message", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    const mod = await import("../connection.js");
    mod.getIB();
    mockIBInstance.emit(EventName.connected);

    const connectLog = spy.mock.calls.find(
      (args) => typeof args[0] === "string" && args[0].includes("Connected to TWS/Gateway")
    );
    expect(connectLog).toBeDefined();
    expect(connectLog![0]).toContain("serverVersion=178");

    spy.mockRestore();
  });
});
