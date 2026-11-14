import type { RunTally } from "@/lib/db/schema";

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * Why a search's postings didn't make the board, from its tally (#862). Only postings already there are called
 * "already on your board"; ones left off as dealbreakers or under the pay floor say so.
 */
export function whyNoneAdded(t: Pick<RunTally, "known" | "dealbreaker" | "belowFloor">): string[] {
  return [
    t.known > 0 && `${t.known} already on your board`,
    t.dealbreaker > 0 && `${t.dealbreaker} hit a dealbreaker`,
    t.belowFloor > 0 && `${t.belowFloor} under your pay floor`,
  ].filter((x): x is string => !!x);
}

/** True when every posting the search read is already on the board, so "already on your board" is the whole story. */
const allKnown = (t: Pick<RunTally, "postings" | "known">) => t.known >= t.postings;

/** The last progress step of a finished search. */
export function doneStep(t: Pick<RunTally, "postings" | "known" | "dealbreaker" | "belowFloor" | "added">): string {
  if (t.added) return `Added ${t.added} new ${t.added === 1 ? "find" : "finds"}`;
  // Every result already on the board is not "nothing matched" (#1125).
  if (!t.postings && !t.known) return "No matching open roles this time";
  const why = whyNoneAdded(t);
  if (allKnown(t) || !why.length) return "No new finds this time. Everything matching is already on your board";
  return `No new finds this time: ${why.join(", ")}`;
}

/** The search panel's line under "No new finds this time", when the search read postings but added none. */
export function noNewBody(found: number, t: Pick<RunTally, "postings" | "known" | "dealbreaker" | "belowFloor"> | null | undefined): string {
  // Results already on the board are skipped before reading: nothing was read, all of it is there (#1125).
  if (!found && t?.known) return "Everything the search turned up is already on your board. It'll look again on your schedule.";
  const read = `Lookout read ${plural(found, "matching posting")}`;
  const why = t ? whyNoneAdded(t) : [];
  // Runs from before the tally (or a tally that explains nothing) keep the old line.
  if (!t || allKnown(t) || !why.length) return `${read}, and ${found === 1 ? "it's" : "they're"} already on your board. It'll look again on your schedule.`;
  return `${read} and added none: ${why.join(", ")}. It'll look again on your schedule.`;
}
