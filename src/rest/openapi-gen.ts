/**
 * OpenAPI spec generator from agent action catalog.
 * Generates OpenAPI 3.0 JSON with component schemas for each action.
 */
import { actionsMeta, getActionList } from "./agent.js";

interface OpenApiProperty {
  type: string;
  description?: string;
  additionalProperties?: boolean;
}

interface OpenApiSchema {
  type: string;
  properties?: Record<string, OpenApiProperty>;
  required?: string[];
  additionalProperties?: boolean;
  description?: string;
  oneOf?: Array<{ $ref: string }>;
  discriminator?: {
    propertyName: string;
    mapping?: Record<string, string>;
  };
}

interface OpenApiResponse {
  description: string;
  content: {
    "application/json": {
      schema: OpenApiSchema;
    };
  };
}

interface OpenApiOperation {
  operationId: string;
  summary: string;
  description: string;
  requestBody: {
    required: boolean;
    content: {
      "application/json": {
        schema: OpenApiSchema;
      };
    };
  };
  responses: Record<string, OpenApiResponse>;
  security?: Array<Record<string, string[]>>;
}

interface OpenApiSpec {
  openapi: string;
  info: {
    title: string;
    version: string;
    description: string;
  };
  servers?: Array<{
    url: string;
    description: string;
  }>;
  paths: Record<string, Record<string, OpenApiOperation>>;
  components: {
    schemas: Record<string, OpenApiSchema>;
    securitySchemes?: Record<string, unknown>;
  };
}

/**
 * Generate OpenAPI component schema for an action's parameters
 */
function generateActionParamsSchema(actionName: string): OpenApiSchema {
  const meta = actionsMeta[actionName];
  if (!meta) {
    return { type: "object", additionalProperties: true };
  }

  const schema: OpenApiSchema = {
    type: "object",
    properties: {},
    additionalProperties: false,
  };

  if (!meta.params || meta.params.length === 0) {
    // No params defined - allow any properties
    schema.additionalProperties = true;
    return schema;
  }

  const required: string[] = [];
  
  for (const param of meta.params) {
    // Parse param format: "paramName" or "paramName?" (optional)
    const isOptional = param.endsWith("?");
    const paramName = isOptional ? param.slice(0, -1) : param;
    
    if (!isOptional) {
      required.push(paramName);
    }

    // Add property to schema
    schema.properties![paramName] = {
      type: "string", // Default to string; could be enhanced with type inference
      description: `Parameter: ${paramName}`,
    };
  }

  if (required.length > 0) {
    schema.required = required;
  }

  return schema;
}

/**
 * Generate OpenAPI spec from agent action catalog
 */
export function generateOpenApiSpec(): OpenApiSpec {
  const actions = getActionList();
  
  // Build component schemas for each action
  const schemas: Record<string, OpenApiSchema> = {};
  const discriminatorMapping: Record<string, string> = {};

  for (const actionName of actions) {
    const meta = actionsMeta[actionName];
    const paramsSchema = generateActionParamsSchema(actionName);
    
    // Create a schema for this action's request
    schemas[`${actionName}_request`] = {
      type: "object",
      required: ["action", "params"],
      properties: {
        action: {
          type: "string",
          description: `Action type: ${actionName}`,
        },
        params: paramsSchema,
      },
      description: meta?.description || `Request schema for ${actionName} action`,
    };

    discriminatorMapping[actionName] = `#/components/schemas/${actionName}_request`;
  }

  // Build the main request schema with discriminator
  const requestSchema: OpenApiSchema = {
    type: "object",
    required: ["action", "params"],
    properties: {
      action: {
        type: "string",
        description: `Name of the action to execute. Available actions (${actions.length}): ${actions.join(", ")}`,
      },
      params: {
        type: "object",
        additionalProperties: true,
        description: "Action-specific parameters",
      },
    },
    discriminator: {
      propertyName: "action",
      mapping: discriminatorMapping,
    },
    oneOf: actions.map(action => ({
      $ref: `#/components/schemas/${action}_request`,
    })),
  };

  const spec: OpenApiSpec = {
    openapi: "3.0.0",
    info: {
      title: "Market Data Bridge Agent API",
      version: "1.0.0",
      description: "OpenAPI spec for the agent dispatcher endpoint with discriminator-based action routing.",
    },
    servers: [
      {
        url: "http://localhost:3000",
        description: "Local development server",
      },
    ],
    paths: {
      "/api/agent": {
        post: {
          operationId: "executeAgentAction",
          summary: "Execute a registered agent action",
          description: `Dispatch an action to the agent. Available actions (${actions.length}): ${actions.join(", ")}`,
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: requestSchema,
              },
            },
          },
          responses: {
            "200": {
              description: "Action executed successfully",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    required: ["action", "result"],
                    properties: {
                      action: {
                        type: "string",
                        description: "The action that was executed",
                      },
                      result: {
                        type: "object",
                        additionalProperties: true,
                        description: "Action-specific result data",
                      },
                    },
                  },
                },
              },
            },
            "500": {
              description: "Action execution failed",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    required: ["action", "error"],
                    properties: {
                      action: {
                        type: "string",
                        description: "The action that was attempted",
                      },
                      error: {
                        type: "string",
                        description: "Error message",
                      },
                    },
                  },
                },
              },
            },
          },
          security: [{ apiKey: [] }],
        },
      },
    },
    components: {
      schemas,
      securitySchemes: {
        apiKey: {
          type: "apiKey",
          in: "header",
          name: "X-API-Key",
        },
      },
    },
  };

  return spec;
}
