import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      // server-only throws outside Next's server build; tests import server modules directly.
      "server-only": path.resolve(import.meta.dirname, "test/server-only.ts"),
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
      // Floor: CI baseline, rounded down (#291; raised in #386). Raise it as tests grow; never lower it.
      thresholds: { lines: 45, statements: 46, functions: 39, branches: 38 },
    },
  },
});
