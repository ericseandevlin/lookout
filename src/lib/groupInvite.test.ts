import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ db: {}, schema: {} }));
import { blocked, CODE_RE, rows, suggestCode, type GroupInvite } from "./groupInvite";

const g = (o: Partial<GroupInvite> = {}): GroupInvite => ({ label: "Demo", expiresAt: "2026-11-20T00:00:00Z", max: 2, used: [], createdAt: "2026-11-09T00:00:00Z", ...o });
const now = new Date("2026-11-12T00:00:00Z");

describe("group invite (#601)", () => {
  it("lets a new email in while there are seats", () => expect(blocked(g(), "a@x.co", now)).toBeNull());
  it("refuses an unknown code", () => expect(blocked(undefined, "a@x.co", now)).toBe("unknown"));
  it("refuses after it expires", () => expect(blocked(g({ expiresAt: "2026-11-11T00:00:00Z" }), "a@x.co", now)).toBe("expired"));
  it("refuses a closed code", () => expect(blocked(g({ closedAt: "2026-11-10T00:00:00Z" }), "a@x.co", now)).toBe("closed"));
  it("refuses when every seat is used", () => expect(blocked(g({ used: ["b@x.co", "c@x.co"] }), "a@x.co", now)).toBe("full"));
  it("lets someone who already used it ask again when full", () => expect(blocked(g({ used: ["a@x.co", "c@x.co"] }), "a@x.co", now)).toBeNull());
});

describe("group invites on the Admin page (#993)", () => {
  it("lists newest first with each link's state", () => {
    const r = rows({ old: g({ createdAt: "2026-11-01T00:00:00Z", closedAt: "2026-11-02T00:00:00Z" }), full: g({ used: ["a", "b"] }), gone: g({ createdAt: "2026-11-10T00:00:00Z", expiresAt: "2026-11-11T00:00:00Z" }) }, now);
    expect(r.map((x) => [x.code, x.state])).toEqual([["gone", "expired"], ["full", "full"], ["old", "closed"]]);
  });
  it("suggests a valid code from the label", () => {
    const c = suggestCode("Tuesday Spin @ 6pm!", () => 0);
    expect(c).toBe("tuesday-spin-6pm-aaaa");
    expect(CODE_RE.test(c)).toBe(true);
  });
  it("suggests a valid code when the label has no letters", () => expect(CODE_RE.test(suggestCode("!!!"))).toBe(true));
  it("keeps a long label's code under 40 characters", () => expect(CODE_RE.test(suggestCode("a very long label for a meetup in the park on sunday"))).toBe(true));
});
