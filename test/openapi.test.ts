import { describe, expect, it } from "vitest";
import { getActionList } from "../src/rest/agent.js";
import { getOpenApiSpec } from "../src/rest/openapi.js";

describe("getOpenApiSpec", () => {
  it("uses OpenAPI 3.1.0", () => {
    const spec = getOpenApiSpec();
    expect(spec.openapi).toBe("3.1.0");
  });

  it("includes the same number of actions as the action registry", () => {
    const spec = getOpenApiSpec();
    const actions = getActionList();
    const description = spec.paths["/api/agent"].post.description;
    const countMatch = description.match(/Available actions \((\d+)\):/);
    const listedActions = description
      .split(": ")[1]
      .split(", ")
      .filter((action) => action.length > 0);

    expect(countMatch).not.toBeNull();
    expect(Number(countMatch?.[1])).toBe(actions.length);
    expect(listedActions.length).toBe(actions.length);
  });

  it("defines POST /api/agent", () => {
    const spec = getOpenApiSpec();
    expect(spec.paths["/api/agent"]).toBeDefined();
    expect(spec.paths["/api/agent"].post).toBeDefined();
  });
});
