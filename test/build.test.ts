import { describe, expect, it } from "vitest";
import { createRestApp } from "../src/rest/server.js";

describe("build integration wiring", () => {
  it("registers static frontend serving and SPA fallback", () => {
    const app = createRestApp();
    const stack = (app as unknown as { _router?: { stack?: Array<{ name: string; route?: { path: string } }> } })._router?.stack ?? [];

    const hasStaticMiddleware = stack.some((layer) => layer.name === "serveStatic");
    const hasCatchAllRoute = stack.some((layer) => layer.route?.path === "*");

    expect(hasStaticMiddleware).toBe(true);
    expect(hasCatchAllRoute).toBe(true);
  });
});
