import { getActionList } from "./agent.js";

interface OpenApiSpec {
  readonly openapi: "3.1.0";
  readonly info: {
    readonly title: string;
    readonly version: string;
    readonly description: string;
  };
  readonly paths: {
    readonly "/api/agent": {
      readonly post: {
        readonly operationId: "executeAgentAction";
        readonly summary: string;
        readonly description: string;
        readonly requestBody: {
          readonly required: true;
          readonly content: {
            readonly "application/json": {
              readonly schema: {
                readonly type: "object";
                readonly required: readonly ["action", "params"];
                readonly properties: {
                  readonly action: {
                    readonly type: "string";
                    readonly description: string;
                  };
                  readonly params: {
                    readonly type: "object";
                    readonly additionalProperties: true;
                    readonly description: string;
                  };
                };
              };
            };
          };
        };
        readonly responses: {
          readonly "200": {
            readonly description: string;
            readonly content: {
              readonly "application/json": {
                readonly schema: {
                  readonly type: "object";
                  readonly required: readonly ["action", "result"];
                  readonly properties: {
                    readonly action: {
                      readonly type: "string";
                    };
                    readonly result: {
                      readonly type: "object";
                      readonly additionalProperties: true;
                    };
                  };
                };
              };
            };
          };
        };
      };
    };
  };
}

export function getOpenApiSpec(): OpenApiSpec {
  const actions: readonly string[] = getActionList();
  const actionDescription: string = actions.length > 0
    ? `Available actions (${actions.length}): ${actions.join(", ")}`
    : "No actions are currently registered.";

  return {
    openapi: "3.1.0",
    info: {
      title: "Market Data Bridge Agent API",
      version: "1.0.0",
      description: "OpenAPI spec for the single agent dispatcher endpoint.",
    },
    paths: {
      "/api/agent": {
        post: {
          operationId: "executeAgentAction",
          summary: "Execute a registered agent action",
          description: actionDescription,
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["action", "params"],
                  properties: {
                    action: {
                      type: "string",
                      description: "Name of the action to execute.",
                    },
                    params: {
                      type: "object",
                      additionalProperties: true,
                      description: "Action-specific parameters.",
                    },
                  },
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Action executed successfully.",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    required: ["action", "result"],
                    properties: {
                      action: {
                        type: "string",
                      },
                      result: {
                        type: "object",
                        additionalProperties: true,
                      },
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
}
