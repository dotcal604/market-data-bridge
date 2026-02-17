import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../../db/database.js";
import { applyTrailingStopToOrder, trailingStopRecommendation } from "../trailing-stop-executor.js";

vi.mock("../../ibkr/orders.js", () => ({
  modifyOrder: vi.fn(async () => ({ status: "Submitted" })),
}));

function resetTables(): void {
  db.exec("DELETE FROM holly_alerts");
  db.exec("DROP TABLE IF EXISTS trailing_stop_per_strategy");
}

describe("trailing-stop-executor", () => {
  beforeEach(() => {
    resetTables();
  });

  it("returns recommendation from trailing_stop_per_strategy table", () => {
    db.exec(`
      CREATE TABLE trailing_stop_per_strategy (
        strategy TEXT PRIMARY KEY,
        params_json TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
    db.prepare(`
      INSERT INTO trailing_stop_per_strategy(strategy, params_json)
      VALUES(?, ?)
    `).run(
      "Holly Momentum",
      JSON.stringify({ name: "tight", type: "fixed_pct", trail_pct: 0.015 }),
    );

    const recommendation = trailingStopRecommendation("AAPL", "Holly Momentum");
    expect(recommendation).toEqual({
      symbol: "AAPL",
      strategy: "Holly Momentum",
      source: "table",
      params: {
        name: "tight",
        type: "fixed_pct",
        trail_pct: 0.015,
      },
    });
  });

  it("resolves strategy from latest Holly alert when strategy param is omitted", () => {
    db.exec(`
      CREATE TABLE trailing_stop_per_strategy (
        strategy TEXT PRIMARY KEY,
        params_json TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
    db.prepare(`
      INSERT INTO holly_alerts(symbol, alert_time, strategy)
      VALUES(?, ?, ?)
    `).run("MSFT", "2026-01-01 09:31:00", "Holly Neo");
    db.prepare(`
      INSERT INTO trailing_stop_per_strategy(strategy, params_json)
      VALUES(?, ?)
    `).run(
      "Holly Neo",
      JSON.stringify({ name: "neo", type: "fixed_pct", trail_pct: 0.02 }),
    );

    const recommendation = trailingStopRecommendation("MSFT");
    expect(recommendation?.strategy).toBe("Holly Neo");
    expect(recommendation?.params.trail_pct).toBe(0.02);
  });

  it("applies trailing stop by converting recommendation to trailingPercent", async () => {
    db.exec(`
      CREATE TABLE trailing_stop_per_strategy (
        strategy TEXT PRIMARY KEY,
        params_json TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
    db.prepare(`
      INSERT INTO trailing_stop_per_strategy(strategy, params_json)
      VALUES(?, ?)
    `).run(
      "Holly Grail",
      JSON.stringify({ name: "grail", type: "fixed_pct", trail_pct: 0.01 }),
    );

    const applied = await applyTrailingStopToOrder({
      symbol: "TSLA",
      strategy: "Holly Grail",
      orderId: 12345,
    });

    expect(applied).toEqual({
      applied: true,
      symbol: "TSLA",
      strategy: "Holly Grail",
      trailingPercent: 1,
      orderId: 12345,
    });
  });
});
