import { describe, expect, it } from "vitest";
import { dueLabel, pickDueSoon } from "./digestDue";

const now = new Date("2026-11-07T09:00:00").getTime();
const row = (id: string, due?: unknown) => ({ id, attributes: due === undefined ? {} : { due } });

describe("due soon (#304)", () => {
  it("keeps dates in the next 7 days, soonest first", () => {
    const got = pickDueSoon([row("a", "2026-11-14"), row("b", "2026-11-07"), row("c", "2026-11-09")], now);
    expect(got.map((x) => [x.row.id, x.days])).toEqual([["b", 0], ["c", 2], ["a", 7]]);
  });
  it("leaves out past, far off, missing and unreadable dates", () => {
    const got = pickDueSoon([row("past", "2026-11-05"), row("far", "2026-11-20"), row("none"), row("junk", "soon"), row("num", 5)], now);
    expect(got).toEqual([]);
  });
  it("says tomorrow late at night and across the clock change (#495)", () => {
    const late = new Date("2026-11-07T23:30:00").getTime();
    expect(pickDueSoon([row("a", "2026-11-08")], late).map((x) => x.days)).toEqual([1]);
    const beforeChange = new Date("2026-10-31T12:00:00").getTime();
    expect(pickDueSoon([row("a", "2026-11-01")], beforeChange).map((x) => x.days)).toEqual([1]);
  });
  it("labels the day", () => {
    expect([0, 1, 4].map(dueLabel)).toEqual(["Due today", "Due tomorrow", "Due in 4 days"]);
  });
});
