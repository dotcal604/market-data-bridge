/**
 * OpenAPI spec wrapper - delegates to the generator.
 * This file maintains backward compatibility with existing imports.
 */
import { generateOpenApiSpec } from "./openapi-gen.js";

export function getOpenApiSpec() {
  return generateOpenApiSpec();
}
