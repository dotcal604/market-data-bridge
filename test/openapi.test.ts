import { describe, expect, it } from "vitest";
import { getActionList, actionsMeta } from "../src/rest/agent.js";
import { getOpenApiSpec } from "../src/rest/openapi.js";

describe("getOpenApiSpec", () => {
  it("uses OpenAPI 3.0.0", () => {
    const spec = getOpenApiSpec();
    expect(spec.openapi).toBe("3.0.0");
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

  it("generates component schemas for every action", () => {
    const spec = getOpenApiSpec();
    const actions = getActionList();
    
    expect(spec.components).toBeDefined();
    expect(spec.components.schemas).toBeDefined();
    
    // Each action should have a corresponding request schema
    for (const action of actions) {
      const schemaName = `${action}_request`;
      expect(spec.components.schemas[schemaName]).toBeDefined();
      expect(spec.components.schemas[schemaName].type).toBe("object");
      expect(spec.components.schemas[schemaName].properties).toBeDefined();
      expect(spec.components.schemas[schemaName].properties!.action).toBeDefined();
      expect(spec.components.schemas[schemaName].properties!.params).toBeDefined();
    }
  });

  it("uses discriminator pattern for action routing", () => {
    const spec = getOpenApiSpec();
    const requestSchema = spec.paths["/api/agent"].post.requestBody.content["application/json"].schema;
    
    expect(requestSchema.discriminator).toBeDefined();
    expect(requestSchema.discriminator!.propertyName).toBe("action");
    expect(requestSchema.discriminator!.mapping).toBeDefined();
    expect(requestSchema.oneOf).toBeDefined();
    
    const actions = getActionList();
    expect(requestSchema.oneOf!.length).toBe(actions.length);
  });

  it("includes params from actionsMeta in component schemas", () => {
    const spec = getOpenApiSpec();
    
    // Test a known action with params
    const testAction = "get_quote";
    if (actionsMeta[testAction] && actionsMeta[testAction].params) {
      const schemaName = `${testAction}_request`;
      const schema = spec.components.schemas[schemaName];
      
      expect(schema).toBeDefined();
      expect(schema.properties!.params).toBeDefined();
      
      // Verify params are represented in the schema
      const paramsSchema = schema.properties!.params;
      expect(paramsSchema.type).toBe("object");
      expect(paramsSchema.properties).toBeDefined();
    }
  });

  it("includes security schemes", () => {
    const spec = getOpenApiSpec();
    
    expect(spec.components.securitySchemes).toBeDefined();
    expect(spec.components.securitySchemes!.apiKey).toBeDefined();
  });

  it("includes error responses", () => {
    const spec = getOpenApiSpec();
    const responses = spec.paths["/api/agent"].post.responses;
    
    expect(responses["200"]).toBeDefined();
    expect(responses["500"]).toBeDefined();
    expect(responses["500"].description).toContain("failed");
  });
});
