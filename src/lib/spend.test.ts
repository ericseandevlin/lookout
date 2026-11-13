import { describe, expect, it } from "vitest";
import { dayKey, keyAlertDue, monthKey, monthStart, perActive } from "./spend";

describe("spend rules (#990)", () => {
  it("alerts at 70% of the key limit, once a month", () => {
    const u = (usd: number) => ({ usd, limit: 20, reset: "monthly" });
    expect(keyAlertDue(u(13.99), undefined, "2026-11")).toBe(false);
    expect(keyAlertDue(u(14), undefined, "2026-11")).toBe(true);
    expect(keyAlertDue(u(19), "2026-11", "2026-11")).toBe(false);
    expect(keyAlertDue(u(19), "2026-10", "2026-11")).toBe(true);
    expect(keyAlertDue({ usd: 5, limit: 0, reset: null }, undefined, "2026-11")).toBe(false);
  });

  it("counts the month in UTC and the day in the app's time zone", () => {
    const late = new Date("2026-12-01T03:00:00Z"); // still Nov 30 in New York
    expect(monthKey(late)).toBe("2026-12");
    expect(monthStart(late).toISOString()).toBe("2026-12-01T00:00:00.000Z");
    expect(dayKey(late, "America/New_York")).toBe("2026-11-30");
  });

  it("splits spend over active people", () => {
    expect(perActive(3, 4)).toBe(0.75);
    expect(perActive(3, 0)).toBeNull();
  });
});
