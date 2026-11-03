import { describe, expect, it } from "vitest";
import { byWeek, findsOfRun, outcome, pct, topReasons, weekOf, type FindRow } from "./quality";

const row = (p: Partial<FindRow>): FindRow => ({ userId: "u1", addedAt: new Date("2026-11-02T12:00:00Z"), seenAt: null, pinned: false, stage: "Not applied", feedback: null, ...p });

describe("outcome", () => {
  it("counts opened, pinned, applied, not a fit, and acted (pinned or applied, once each)", () => {
    const o = outcome([
      row({ seenAt: new Date() }),
      row({ seenAt: new Date(), pinned: true, stage: "Interview" }),
      row({ stage: "Ghosted" }),
      row({ stage: "Closed" }),
      row({ stage: "Nope", feedback: { reason: "Too junior" } }),
    ]);
    expect(o).toEqual({ added: 5, opened: 2, pinned: 1, applied: 2, notFit: 1, acted: 2 });
  });
});

it("pct is a whole percent, or null when there's nothing", () => {
  expect(pct(1, 3)).toBe(33);
  expect(pct(0, 0)).toBeNull();
});

describe("weeks", () => {
  it("weekOf is the Monday", () => {
    expect(weekOf(new Date("2026-11-08T23:00:00Z"))).toBe("2026-11-02");
    expect(weekOf(new Date("2026-11-02T00:00:00Z"))).toBe("2026-11-02");
  });
  it("byWeek keeps empty weeks and drops older finds", () => {
    const now = new Date("2026-11-04T12:00:00Z");
    const w = byWeek([row({ addedAt: new Date("2026-11-03T00:00:00Z"), pinned: true }), row({ addedAt: new Date("2026-09-01T00:00:00Z") })], 3, now);
    expect(w.map((x) => [x.week, x.added, x.acted])).toEqual([
      ["2026-10-19", 0, 0],
      ["2026-10-26", 0, 0],
      ["2026-11-02", 1, 1],
    ]);
  });
});

it("topReasons ranks reasons", () => {
  const rs = [row({ feedback: { reason: "Too junior" } }), row({ feedback: { reason: "Wrong city" } }), row({ feedback: { reason: "Too junior" } })];
  expect(topReasons(rs)).toEqual([
    { reason: "Too junior", count: 2 },
    { reason: "Wrong city", count: 1 },
  ]);
});

it("findsOfRun matches the person and the run's window", () => {
  const run = { userId: "u1", startedAt: new Date("2026-11-02T11:00:00Z"), finishedAt: new Date("2026-11-02T11:59:30Z") };
  const rs = [row({}), row({ userId: "u2" }), row({ addedAt: new Date("2026-11-02T13:00:00Z") })];
  expect(findsOfRun(run, rs)).toHaveLength(1);
  expect(findsOfRun({ ...run, finishedAt: null }, rs)).toEqual([]);
});
