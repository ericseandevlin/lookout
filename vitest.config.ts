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
  test: { environment: "node" },
});
