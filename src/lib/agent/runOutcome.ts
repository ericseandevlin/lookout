import type { RunTally } from "@/lib/db/schema";

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * Why a search's postings didn't make the board, from its tally (#862). Only postings already there are called
 * "already on your board"; ones left off as dealbreakers or under the pay floor say so.
 */
export function whyNoneAdded(t: Pick<RunTally, "known" | "dealbreaker" | "belowFloor" | "unscored">): string[] {
  return [
    t.known > 0 && `${t.known} already on your board`,
    t.dealbreaker > 0 && `${t.dealbreaker} hit a dealbreaker`,
    t.belowFloor > 0 && `${t.belowFloor} under your pay floor`,
    // Read but never scored (#1456): a failed scoring call, not "already on your board".
    !!t.unscored && `${t.unscored} couldn't be scored this time`,
  ].filter((x): x is string => !!x);
}

/**
 * True when nothing was cut, so "already on your board" is the whole story. Not known >= postings: known also counts
 * board results skipped before reading, which postings doesn't, so that hid dealbreakers and under-floor cuts (#1138).
 */
const allKnown = (t: Pick<RunTally, "dealbreaker" | "belowFloor" | "unscored">) => !t.dealbreaker && !t.belowFloor && !t.unscored;

/** The last progress step of a finished search. */
export function doneStep(t: Pick<RunTally, "postings" | "known" | "dealbreaker" | "belowFloor" | "added" | "unscored">): string {
  if (t.added) return `Added ${t.added} new ${t.added === 1 ? "find" : "finds"}`;
  // Every result already on the board is not "nothing matched" (#1125), nor is every posting left unscored (#1456).
  if (!t.postings && !t.known && !t.unscored) return "No matching open roles this time";
  const why = whyNoneAdded(t);
  if (allKnown(t) || !why.length) return "No new finds this time. Everything matching is already on your board";
  return `No new finds this time: ${why.join(", ")}`;
}

/** The search panel's line under "No new finds this time", when the search read postings but added none. */
export function noNewBody(found: number, t: Pick<RunTally, "postings" | "known" | "dealbreaker" | "belowFloor" | "unscored"> | null | undefined): string {
  // Nothing scored at all: say that, not "read 0 matching postings" (#1456).
  if (!found && t?.unscored) return `Lookout couldn't score ${plural(t.unscored, "posting")} this time${t.known ? `, and ${t.known} ${t.known === 1 ? "is" : "are"} already on your board` : ""}. It'll read them again on your schedule.`;
  // Results already on the board are skipped before reading: nothing was read, all of it is there (#1125).
  if (!found && t?.known) return "Everything the search turned up is already on your board. It'll look again on your schedule.";
  const read = `Lookout read ${plural(found, "matching posting")}`;
  const why = t ? whyNoneAdded(t) : [];
  // Runs from before the tally (or a tally that explains nothing) keep the old line.
  if (!t || allKnown(t) || !why.length) return `${read}, and ${found === 1 ? "it's" : "they're"} already on your board. It'll look again on your schedule.`;
  return `${read} and added none: ${why.join(", ")}. It'll look again on your schedule.`;
}

/**
 * Where the job posts dropped out, in one line, or "" (#1662). Under the floor is cut from the board (#740), so the
 * line no longer says pay "only marks a role down". Two or more off on location get their own tip, so only one
 * gets the "still on your board" note here.
 */
export function dropLine(t: Pick<RunTally, "known" | "dealbreaker" | "belowFloor" | "offLocation">): string {
  const outs = [
    t.known && `${t.known} already on your board`,
    t.dealbreaker && `${t.dealbreaker} hit a dealbreaker`,
    t.belowFloor && `${t.belowFloor} under your pay floor`,
    t.offLocation && `${t.offLocation} off on location${t.offLocation === 1 ? ", on your board marked down" : ""}`,
  ].filter(Boolean) as string[];
  return outs.length ? `Of the job posts: ${outs.join(" · ")}.` : "";
}
