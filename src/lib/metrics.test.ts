import { describe, expect, it } from "vitest";
import { actedOn, activation, activeSince, byChannel, channelOf, outcomes, retention, scoreSplit, searchSuccess, week4Retention, weekly, type MetricEvent } from "./metrics";

const ev = (userId: string, type: string, at: string, target: string | null = null, meta: Record<string, unknown> | null = null): MetricEvent => ({ userId, type, target, meta, at: new Date(at) });

describe("actedOn", () => {
  it("counts posting opens, pins, Applied or later, and find clicks from email", () => {
    expect(actedOn(ev("a", "posting_clicked", "2026-11-03T10:00:00Z", "f1"))).toBe("f1");
    expect(actedOn(ev("a", "pin", "2026-11-03T10:00:00Z", "f1", { on: true }))).toBe("f1");
    expect(actedOn(ev("a", "stage_change", "2026-11-03T10:00:00Z", "f1", { stage: "Interview" }))).toBe("f1");
    expect(actedOn(ev("a", "email_click", "2026-11-03T10:00:00Z", "f1"))).toBe("f1");
  });
  it("ignores unpins, early stages, the email's board link and other events", () => {
    expect(actedOn(ev("a", "pin", "2026-11-03T10:00:00Z", "f1", { on: false }))).toBeNull();
    expect(actedOn(ev("a", "stage_change", "2026-11-03T10:00:00Z", "f1", { stage: "Not applied" }))).toBeNull();
    expect(actedOn(ev("a", "email_click", "2026-11-03T10:00:00Z", "board"))).toBeNull();
    expect(actedOn(ev("a", "page_view", "2026-11-03T10:00:00Z", "/finds"))).toBeNull();
  });
});

describe("weekly", () => {
  it("counts actives and distinct finds acted on per active person", () => {
    const now = new Date("2026-11-04T12:00:00Z");
    const rows = [
      ev("a", "posting_clicked", "2026-11-03T10:00:00Z", "f1"),
      ev("a", "pin", "2026-11-03T11:00:00Z", "f1", { on: true }),
      ev("a", "posting_clicked", "2026-11-03T12:00:00Z", "f2"),
      ev("b", "page_view", "2026-11-03T10:00:00Z", "/finds"),
      ev("c", "heartbeat", "2026-11-03T10:00:00Z", "/finds"),
      ev("b", "sign_in", "2026-10-28T10:00:00Z"),
    ];
    expect(weekly(rows, 2, now)).toEqual([
      { week: "2026-10-26", active: 1, acted: 0, actedPerActive: 0 },
      { week: "2026-11-02", active: 2, acted: 2, actedPerActive: 1 },
    ]);
  });
});

describe("week4Retention", () => {
  it("counts only people whose week 4 is over, retained if active that week", () => {
    const now = new Date("2026-11-04T12:00:00Z"); // week of Nov 2
    const rows = [
      ev("a", "sign_in", "2026-10-05T10:00:00Z"), // week 1 Oct 5, week 4 Oct 26: active
      ev("a", "page_view", "2026-10-27T10:00:00Z"),
      ev("b", "sign_in", "2026-10-06T10:00:00Z"), // week 4 Oct 26: not active then
      ev("b", "page_view", "2026-11-03T10:00:00Z"),
      ev("c", "sign_in", "2026-10-13T10:00:00Z"), // week 4 is Nov 2, not over yet
      ev("d", "heartbeat", "2026-10-05T10:00:00Z"),
    ];
    expect(week4Retention(rows, now)).toEqual({ eligible: 2, retained: 1, rate: 0.5 });
  });
  it("has no rate before anyone reaches week 4", () => {
    expect(week4Retention([ev("a", "sign_in", "2026-11-03T10:00:00Z")], new Date("2026-11-04T12:00:00Z")).rate).toBeNull();
  });
});

describe("activeSince", () => {
  it("counts distinct people, not heartbeats", () => {
    const rows = [ev("a", "sign_in", "2026-11-01T10:00:00Z"), ev("a", "pin", "2026-11-02T10:00:00Z", "f"), ev("b", "heartbeat", "2026-11-02T10:00:00Z"), ev("c", "sign_in", "2026-09-01T10:00:00Z")];
    expect(activeSince(rows, new Date("2026-10-07T00:00:00Z"))).toBe(1);
  });
});

describe("retention", () => {
  it("counts week 8 from the week of the first event", () => {
    const now = new Date("2026-11-04T12:00:00Z");
    const rows = [ev("a", "sign_in", "2026-09-08T10:00:00Z"), ev("a", "sign_in", "2026-10-27T10:00:00Z"), ev("b", "sign_in", "2026-09-08T10:00:00Z"), ev("c", "sign_in", "2026-09-15T10:00:00Z")];
    expect(retention(rows, 8, now)).toEqual({ eligible: 2, retained: 1, rate: 0.5 });
  });
});

describe("activation", () => {
  const now = new Date("2026-11-20T12:00:00Z");
  const joined = new Date("2026-11-01T12:00:00Z");
  it("needs profile, resume and a first search within 7 days, and skips people who joined under 7 days ago", () => {
    expect(
      activation(
        [
          { createdAt: joined, profileSaved: true, resume: true, firstSearchAt: new Date("2026-11-03T12:00:00Z") },
          { createdAt: joined, profileSaved: true, resume: true, firstSearchAt: new Date("2026-11-12T12:00:00Z") },
          { createdAt: joined, profileSaved: false, resume: true, firstSearchAt: new Date("2026-11-03T12:00:00Z") },
          { createdAt: joined, profileSaved: true, resume: true, firstSearchAt: null },
          { createdAt: new Date("2026-11-18T12:00:00Z"), profileSaved: true, resume: true, firstSearchAt: new Date("2026-11-18T13:00:00Z") },
        ],
        now,
      ),
    ).toEqual({ eligible: 4, activated: 1, rate: 0.25 });
  });
  it("is null with nobody eligible", () => {
    expect(activation([], now).rate).toBeNull();
  });
});

describe("scoreSplit", () => {
  it("averages acted-on and ignored finds separately", () => {
    expect(scoreSplit([{ score: 5, acted: true }, { score: 4, acted: true }, { score: 3, acted: false }])).toEqual({ acted: 4.5, ignored: 3 });
    expect(scoreSplit([{ score: 3, acted: false }])).toEqual({ acted: null, ignored: 3 });
  });
});

describe("searchSuccess", () => {
  it("counts finished searches that read a page; running ones are left out", () => {
    expect(
      searchSuccess([
        { status: "done", read: 4 },
        { status: "done", read: 0 },
        { status: "failed", read: null },
        { status: "running", read: null },
      ]),
    ).toEqual({ searches: 3, succeeded: 1, rate: 1 / 3 });
    expect(searchSuccess([]).rate).toBeNull();
  });
});

describe("outcomes (#526)", () => {
  it("adds survey yeses only for people with nothing on the board, and counts an offer as an interview", () => {
    const r = (userId: string, outcome: "interview" | "offer", boardInterview = false, boardOffer = false) => ({ userId, outcome, boardInterview, boardOffer });
    expect(outcomes({ interviews: 2, offers: 1 }, [])).toEqual({ interviews: 2, offers: 1, survey: { interviews: 0, offers: 0 } });
    expect(
      outcomes({ interviews: 2, offers: 1 }, [
        r("a", "interview"),
        // Same person on both questions counts once for interviews.
        r("a", "offer"),
        // Already on the board.
        r("b", "interview", true),
        r("c", "offer", true, true),
        // Interview on the board, offer only in the survey.
        r("d", "offer", true),
      ]),
    ).toEqual({ interviews: 3, offers: 3, survey: { interviews: 1, offers: 2 } });
  });
});

describe("channelOf (#527)", () => {
  it("turns a ref into a short lowercase slug, or null", () => {
    expect(channelOf("Reddit")).toBe("reddit");
    expect(channelOf("  LinkedIn post #2 ")).toBe("linkedin-post-2");
    expect(channelOf(["hn", "x"])).toBe("hn");
    expect(channelOf("x".repeat(60))).toHaveLength(40);
    expect(channelOf("--")).toBeNull();
    expect(channelOf("")).toBeNull();
    expect(channelOf(undefined)).toBeNull();
  });
});

describe("byChannel (#527)", () => {
  it("counts signups, joins and weekly actives per channel, untagged as direct, most signups first", () => {
    expect(
      byChannel([
        { channel: "reddit", joined: true, active: true },
        { channel: "reddit", joined: true, active: false },
        { channel: "reddit", joined: false, active: false },
        { channel: null, joined: true, active: true },
        { channel: "hn", joined: false, active: true },
      ]),
    ).toEqual([
      { channel: "reddit", signups: 3, joined: 2, active: 1 },
      { channel: "direct", signups: 1, joined: 1, active: 1 },
      { channel: "hn", signups: 1, joined: 0, active: 0 },
    ]);
  });
});
