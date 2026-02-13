/**
 * Minimal OpenAPI spec for the ChatGPT Custom GPT agent endpoint.
 * Only 2 operations — bypasses the 30-op limit entirely.
 * Served at GET /openapi-agent.json (unauthenticated).
 */
export const openApiAgentSpec = {
  openapi: "3.1.0",
  info: {
    title: "Market Data Bridge — Agent",
    description:
      "Single-endpoint agent dispatcher for IBKR Market Data Bridge. Call get_gpt_instructions first, then use execute_action for all 68+ tools.",
    version: "1.0.0",
  },
  servers: [{ url: "https://api.klfh-dot-io.com" }],
  components: {
    securitySchemes: {
      ApiKeyAuth: {
        type: "apiKey",
        in: "header",
        name: "X-API-Key",
      },
    },
  },
  security: [{ ApiKeyAuth: [] as string[] }],
  paths: {
    "/api/gpt-instructions": {
      get: {
        operationId: "getGptInstructions",
        summary:
          "Get system instructions and full action catalog. Call this FIRST in every conversation.",
        responses: {
          "200": {
            description: "System instructions with complete action reference",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    role: { type: "string" },
                    instructions: { type: "string" },
                  },
                },
              },
            },
          },
        },
      },
    },
    "/api/agent": {
      post: {
        operationId: "executeAction",
        summary:
          "Execute any bridge action. Pass the action name and its params object. Call getGptInstructions first to see the full action catalog.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["action"],
                properties: {
                  action: {
                    type: "string",
                    description:
                      "Action name (e.g. get_quote, place_order, get_positions). See gpt-instructions for full list.",
                  },
                  params: {
                    type: "object",
                    description:
                      "Action-specific parameters as key-value pairs. See gpt-instructions for each action's params.",
                    additionalProperties: true,
                  },
                },
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Action result",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    action: { type: "string" },
                    result: { description: "Action-specific response data" },
                  },
                },
              },
            },
          },
          "400": {
            description: "Bad request — unknown action or missing params",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    error: { type: "string" },
                    available_actions: {
                      type: "array",
                      items: { type: "string" },
                    },
                  },
                },
              },
            },
          },
          "500": {
            description: "Action execution error",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    action: { type: "string" },
                    error: { type: "string" },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
};
