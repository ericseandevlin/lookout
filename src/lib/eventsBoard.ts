import type { NetworkingEvent } from "./networking";

/**
 * Events board (#265): which events show and in what order. Pure, so the page and the tests share it.
 * Pinned events sort first, as on the Finds board.
 */

export type EventView = "all" | "pinned" | "archived";
export type EventWhere = "any" | "in-person" | "online";
export type EventSort = "date" | "distance" | "fit";
export type EventFilter = { view: EventView; where: EventWhere; from: string; to: string; q: string };

export const EMPTY_FILTER: EventFilter = { view: "all", where: "any", from: "", to: "", q: "" };

/** Counts for the All / Pinned / Archived chips. */
export function eventTally(events: NetworkingEvent[]) {
  const active = events.filter((e) => !e.archived);
  return { all: active.length, pinned: active.filter((e) => e.pinned).length, archived: events.length - active.length };
}

const lastDay = (e: NetworkingEvent) => e.endsOn ?? e.startsOn;

/** Unknown distance and fit sort last whichever way the list runs, so they never crowd the top. */
function value(e: NetworkingEvent, key: EventSort): number | null {
  if (key === "fit") return e.fit ?? null;
  if (key === "distance") return e.online ? null : (e.miles ?? null);
  return Date.parse(`${e.startsOn}T00:00:00Z`);
}

export function boardEvents(events: NetworkingEvent[], f: EventFilter, sort: EventSort, dir: "asc" | "desc") {
  let list = f.view === "archived" ? events.filter((e) => e.archived) : events.filter((e) => !e.archived);
  if (f.view === "pinned") list = list.filter((e) => e.pinned);
  if (f.where === "online") list = list.filter((e) => e.online);
  if (f.where === "in-person") list = list.filter((e) => !e.online);
  // Date range: an event shows if any of its days fall inside it.
  if (f.from) list = list.filter((e) => lastDay(e) >= f.from);
  if (f.to) list = list.filter((e) => e.startsOn <= f.to);
  const needle = f.q.trim().toLowerCase();
  if (needle) list = list.filter((e) => [e.title, e.host, e.place, e.why].join(" ").toLowerCase().includes(needle));
  const sign = dir === "asc" ? 1 : -1;
  return [...list].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    const x = value(a, sort), y = value(b, sort);
    if (x === null || y === null) return x === y ? a.startsOn.localeCompare(b.startsOn) : x === null ? 1 : -1;
    return (x - y) * sign || a.startsOn.localeCompare(b.startsOn);
  });
}

/** The direction a sort starts in: soonest, nearest, best fit first. */
export const defaultDir = (s: EventSort): "asc" | "desc" => (s === "fit" ? "desc" : "asc");
