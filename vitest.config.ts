import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      // server-only throws outside Next's server build; tests import server modules directly.
      "server-only": path.resolve(__dirname, "test/server-only.ts"),
    },
  },
  test: {
    environment: "node",
    hookTimeout: 60_000,
    // Used by `npm run test:coverage` (CI). Plain `npm test` skips it.
    coverage: {
      provider: "v8",
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/**/*.test.{ts,tsx}"],
      reporter: ["text-summary", "json-summary", "html"],
      reportsDirectory: "coverage",
      // Floor at the level when coverage was added (#291). Raise it as tests grow; never lower it.
      thresholds: { lines: 0, statements: 0, functions: 0, branches: 0 },
    },
  },
});
