import { describe, expect, it } from "vitest";
import { boardEvents, defaultDir, EMPTY_FILTER, eventTally } from "./eventsBoard";
import type { NetworkingEvent } from "./networking";

const ev = (id: string, over: Partial<NetworkingEvent> = {}): NetworkingEvent => ({
  id, title: `Event ${id}`, host: "", startsOn: "2026-11-20", endsOn: null, time: "", place: "Brooklyn", online: false, cost: "", why: "", url: `https://x.example/${id}`,
  pinned: false, archived: false, fit: 3, miles: 5, ...over,
});
const ids = (xs: NetworkingEvent[]) => xs.map((x) => x.id);

describe("boardEvents (#265)", () => {
  const list = [
    ev("a", { startsOn: "2026-11-25", fit: 5, miles: 20 }),
    ev("b", { startsOn: "2026-11-10", fit: 2, miles: 2 }),
    ev("c", { startsOn: "2026-11-15", online: true, place: "Online", miles: null, fit: 4 }),
    ev("d", { startsOn: "2026-11-30", archived: true }),
    ev("e", { startsOn: "2026-12-05", pinned: true, fit: null, miles: null }),
  ];

  it("hides archived from All, pins first, then by date", () => {
    expect(ids(boardEvents(list, EMPTY_FILTER, "date", "asc"))).toEqual(["e", "b", "c", "a"]);
  });
  it("sorts by fit and distance with unknowns last", () => {
    expect(ids(boardEvents(list, EMPTY_FILTER, "fit", "desc"))).toEqual(["e", "a", "c", "b"]);
    expect(ids(boardEvents(list, EMPTY_FILTER, "distance", "asc"))).toEqual(["e", "b", "a", "c"]);
  });
  it("filters by view, where, date range and text", () => {
    expect(ids(boardEvents(list, { ...EMPTY_FILTER, view: "archived" }, "date", "asc"))).toEqual(["d"]);
    expect(ids(boardEvents(list, { ...EMPTY_FILTER, view: "pinned" }, "date", "asc"))).toEqual(["e"]);
    expect(ids(boardEvents(list, { ...EMPTY_FILTER, where: "online" }, "date", "asc"))).toEqual(["c"]);
    expect(ids(boardEvents(list, { ...EMPTY_FILTER, where: "in-person" }, "date", "asc"))).toEqual(["e", "b", "a"]);
    expect(ids(boardEvents(list, { ...EMPTY_FILTER, from: "2026-11-12", to: "2026-11-26" }, "date", "asc"))).toEqual(["c", "a"]);
    expect(ids(boardEvents(list, { ...EMPTY_FILTER, q: "event b" }, "date", "asc"))).toEqual(["b"]);
  });
  it("counts a multi-day event that overlaps the range", () => {
    const multi = [ev("m", { startsOn: "2026-11-01", endsOn: "2026-11-14" })];
    expect(ids(boardEvents(multi, { ...EMPTY_FILTER, from: "2026-11-10" }, "date", "asc"))).toEqual(["m"]);
  });
  it("tallies the chips and picks a sensible starting direction", () => {
    expect(eventTally(list)).toEqual({ all: 4, pinned: 1, archived: 1 });
    expect([defaultDir("date"), defaultDir("distance"), defaultDir("fit")]).toEqual(["asc", "asc", "desc"]);
  });
});
