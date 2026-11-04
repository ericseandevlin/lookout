import { describe, expect, it } from "vitest";
import { CLIENT_EVENTS, funnel, nextStep, timeline, weeklyActives, type FunnelPerson } from "./events";

describe("weeklyActives", () => {
  it("counts people per week, ignoring heartbeats", () => {
    const now = new Date("2026-11-04T12:00:00Z");
    const rows = [
      { userId: "a", type: "page_view", at: new Date("2026-11-03T10:00:00Z") },
      { userId: "a", type: "pin", at: new Date("2026-11-03T11:00:00Z") },
      { userId: "b", type: "heartbeat", at: new Date("2026-11-03T11:00:00Z") },
      { userId: "b", type: "sign_in", at: new Date("2026-10-28T11:00:00Z") },
    ];
    expect(weeklyActives(rows, 2, now)).toEqual([
      { week: "2026-10-26", active: 1 },
      { week: "2026-11-02", active: 1 },
    ]);
  });
});

describe("timeline", () => {
  it("folds back-to-back heartbeats on one page into minutes, newest first", () => {
    const t = (m: number) => new Date(Date.UTC(2026, 10, 3, 10, m));
    const out = timeline([
      { type: "page_view", target: "/finds", at: t(0) },
      { type: "heartbeat", target: "/finds", at: t(1) },
      { type: "heartbeat", target: "/finds", at: t(2) },
      { type: "heartbeat", target: "/finds", at: t(3) },
      { type: "pin", target: "f1", at: t(4) },
      { type: "heartbeat", target: "/profile", at: t(5) },
    ]);
    expect(out.map((r) => [r.type, r.target, r.minutes])).toEqual([
      ["heartbeat", "/profile", 1],
      ["pin", "f1", undefined],
      ["heartbeat", "/finds", 3],
      ["page_view", "/finds", undefined],
    ]);
  });
});

describe("funnel", () => {
  it("each step only counts people who reached the earlier ones", () => {
    const all: FunnelPerson = { signedIn: true, welcome: true, answered: true, material: true, searchProfile: true, searched: true, found: true, acted: true };
    const none: FunnelPerson = { signedIn: false, welcome: false, answered: false, material: false, searchProfile: false, searched: false, found: false, acted: false };
    const f = funnel([all, { ...all, answered: false }, none]);
    expect(f.map((s) => s.count)).toEqual([3, 2, 2, 1, 1, 1, 1, 1, 1]);
  });

  it("names the first step someone hasn't reached", () => {
    const all: FunnelPerson = { signedIn: true, welcome: true, answered: true, material: true, searchProfile: true, searched: true, found: true, acted: true };
    expect(nextStep({ ...all, searchProfile: false, found: false })).toBe("Search profile built");
    expect(nextStep({ ...all, signedIn: false })).toBe("Signed in");
    expect(nextStep(all)).toBeNull();
  });
});

it("the browser can only send its own short list", () => {
  expect(CLIENT_EVENTS).not.toContain("sign_in");
  expect(CLIENT_EVENTS).toContain("page_view");
});
