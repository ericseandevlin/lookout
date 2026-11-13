import { describe, expect, it } from "vitest";
import { inFirstWeek, scheduleLabel } from "./firstWeek";

const now = Date.parse("2026-11-13T12:00:00Z");

describe("inFirstWeek (#992)", () => {
  it("is true for 7 days after joining, then false", () => {
    expect(inFirstWeek("2026-11-13T11:00:00Z", now)).toBe(true);
    expect(inFirstWeek("2026-11-07T00:00:00Z", now)).toBe(true);
    expect(inFirstWeek("2026-11-06T12:00:00Z", now)).toBe(false);
  });
  it("is false for a date it can't read", () => {
    expect(inFirstWeek("", now)).toBe(false);
  });
});

describe("scheduleLabel (#992)", () => {
  it("puts the schedule in words", () => {
    expect(scheduleLabel({ freq: "Weekly", day: "Mon", days: ["Mon", "Thu"] })).toBe("every Monday");
    expect(scheduleLabel({ freq: "Twice a week", day: "Mon", days: ["Tue", "Fri"] })).toBe("Tuesday and Friday");
    expect(scheduleLabel({ freq: "Daily", day: "Mon", days: [] })).toBe("every day");
  });
});
