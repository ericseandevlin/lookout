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
      // Floor: CI baseline when coverage was added (#291), rounded down. Raise it as tests grow; never lower it.
      thresholds: { lines: 28, statements: 30, functions: 27, branches: 25 },
    },
  },
});
