import express from "express";
import supertest from "supertest";
import { describe, expect, it } from "vitest";
import { evalRouter } from "../routes.js";

describe("eval routes edge metrics endpoint", () => {
  const app = express();
  app.use(express.json());
  app.use("/api/eval", evalRouter);
  const request = supertest(app);

  it("computes edge metrics for valid payload", async () => {
    const response = await request.post("/api/eval/edge-metrics").send({
      outcomes: [1, -0.5, 2, -1, 0.5],
    });

    expect(response.status).toBe(200);
    expect(response.body.outcomes_count).toBe(5);
    expect(response.body.alpha).toBe(0.05);
    expect(response.body.metrics.recovery_factor).toBeCloseTo(4, 6);
    expect(response.body.metrics.cvar).toBe(-1);
    expect(response.body.metrics.skewness).toBeCloseTo(0.13802317, 6);
    expect(response.body.metrics.ulcer_index).toBeCloseTo(0.3, 6);
  });

  it("returns 400 on invalid request", async () => {
    const response = await request.post("/api/eval/edge-metrics").send({
      outcomes: [1, "bad-value"],
    });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe("Invalid edge metrics request");
    expect(response.body.details).toBeInstanceOf(Array);
  });
});
