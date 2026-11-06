import { describe, expect, it } from "vitest";
import { cleanEvents, eventFingerprint, eventQueries, isPast } from "./networking";

const now = new Date("2026-11-06T12:00:00Z");

describe("eventQueries", () => {
  it("makes nearby and online queries from up to three interests, no model call", () => {
    const q = eventQueries("design systems, AI product; accessibility, extra", "Brooklyn, NY (hybrid)", "both", now);
    expect(q).toHaveLength(3);
    expect(q[0]).toBe("design systems meetup OR panel OR conference Brooklyn, NY November 2026");
    expect(q[1]).toContain("online event");
  });
  it("respects reach and needs interests", () => {
    expect(eventQueries("AI", "NYC", "online", now).every((x) => x.includes("online"))).toBe(true);
    expect(eventQueries("AI", "NYC", "nearby", now).some((x) => x.includes("online"))).toBe(false);
    expect(eventQueries("", "NYC", "both", now)).toEqual([]);
  });
  it("skips nearby queries when there's no place", () => expect(eventQueries("AI", "Remote", "nearby", now)).toEqual([]));
});

describe("cleanEvents", () => {
  const base = { title: "Design Systems NYC", host: "DS Club", startsOn: "2026-11-20", endsOn: "", time: "6:30 pm", place: "Brooklyn", online: false, cost: "Free", why: "Your field.", url: "https://meetup.example/1" };
  const opts = { today: "2026-11-06", readUrls: ["https://meetup.example/1", "https://conf.example/2"], known: new Set<string>(), reach: "both" as const };

  it("keeps a well-formed upcoming event", () => {
    const [e] = cleanEvents([base], opts);
    expect(e).toMatchObject({ title: "Design Systems NYC", startsOn: "2026-11-20", endsOn: null, fingerprint: eventFingerprint("Design Systems NYC", "2026-11-20") });
  });
  it("drops past, undated, unread-link and duplicate events", () => {
    const out = cleanEvents(
      [
        { ...base, startsOn: "2026-10-01" },
        { ...base, startsOn: "next Tuesday" },
        { ...base, url: "https://made-up.example" },
        base,
        { ...base, title: "design systems  nyc!" },
      ],
      opts,
    );
    expect(out).toHaveLength(1);
  });
  it("keeps a multi-day event that's still running, and drops an end before the start", () => {
    expect(cleanEvents([{ ...base, startsOn: "2026-11-04", endsOn: "2026-11-08" }], opts)).toHaveLength(1);
    expect(cleanEvents([{ ...base, endsOn: "2026-11-01" }], opts)[0].endsOn).toBeNull();
  });
  it("follows reach and skips what's already known", () => {
    expect(cleanEvents([base], { ...opts, reach: "online" })).toEqual([]);
    expect(cleanEvents([{ ...base, online: true, url: "https://conf.example/2" }], { ...opts, reach: "nearby" })).toEqual([]);
    expect(cleanEvents([base], { ...opts, known: new Set([eventFingerprint(base.title, base.startsOn)]) })).toEqual([]);
  });
});

it("isPast uses the last day", () => {
  expect(isPast({ startsOn: "2026-11-01", endsOn: "2026-11-07" }, "2026-11-06")).toBe(false);
  expect(isPast({ startsOn: "2026-11-05", endsOn: null }, "2026-11-06")).toBe(true);
});
