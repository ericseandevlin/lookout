import { describe, expect, it } from "vitest";
import config from "../next.config";

describe("redirects (2026-11-27 walkthrough)", () => {
  it("sends the sign-in addresses people guess to /signin", async () => {
    const r = (await config.redirects?.()) ?? [];
    for (const source of ["/login", "/log-in", "/sign-in"]) {
      expect(r).toContainEqual({ source, destination: "/signin", permanent: true });
    }
  });
});
