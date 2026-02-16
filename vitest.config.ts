import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts", "test/**/*.test.ts", "tests/**/*.test.ts"],
    setupFiles: ["src/ibkr/__tests__/risk-gate.setup.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      exclude: [
        "node_modules/",
        "build/",
        "frontend/",
        "**/*.test.ts",
        "**/__tests__/**",
      ],
    },
  },
});
