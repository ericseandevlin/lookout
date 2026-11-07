import type { RunReport, RunTally, RunTip } from "@/lib/db/schema";
import { kindOf } from "@/lib/kinds";

export const emptyTally = (): RunTally => ({ postings: 0, notPostings: 0, known: 0, dealbreaker: 0, belowFloor: 0, offLocation: 0, added: 0 });

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

/**
 * Up to two specific, fixable reasons a search came back thin, each linked to
 * the field that would change it. Pure, so it's easy to test. Wording and links
 * follow the search's kind (#300): rfp profiles have no titles, dealbreakers or resume.
 */
export function buildTips(
  r: Pick<RunReport, "results" | "picked" | "read" | "tally">,
  p: { answers: Record<string, string | string[]>; hasResume: boolean; floor: string; kind?: string },
): RunTip[] {
  const t = r.tally;
  const kind = kindOf(p.kind);
  const job = kind.id === "job";
  const a = (k: string) => (typeof p.answers[k] === "string" ? (p.answers[k] as string).trim() : "");
  const tips: RunTip[] = [];

  if (r.picked > 0 && r.read === 0) {
    tips.push({ text: `Lookout couldn't open any of the ${job ? "job pages" : "pages"} it found, so nothing could be scored. That's on our end, not your profile, and it's been logged.` });
    return tips;
  }
  if (r.results === 0) {
    tips.push(
      job
        ? { text: "The searches came back empty. Name two or three job titles in your first answer so Lookout has more to search for.", href: "/profile#q-q1", label: "Edit your next role" }
        : { text: "SAM.gov had no open notices for your codes. Check your NAICS codes or add a close one so Lookout has more to search.", href: "/profile#q-naics", label: "Edit NAICS codes" },
    );
  }
  if (job && t.dealbreaker > 0 && a("q5")) {
    tips.push({ text: `${plural(t.dealbreaker, "role")} hit your dealbreakers and ${t.dealbreaker === 1 ? "was" : "were"} left off. If “${clip(a("q5"), 60)}” is stricter than you mean, loosen it.`, href: "/profile#q-q5", label: "Edit dealbreakers" });
  }
  if (t.belowFloor >= 2) {
    tips.push(
      job
        ? { text: `${plural(t.belowFloor, "role")} paid under your ${p.floor || "salary"} floor. They're on your board, marked down. Lower the floor if you'd take them.`, href: "/profile#q-comp", label: "Edit pay" }
        : { text: `${plural(t.belowFloor, kind.noun.one, kind.noun.many)} came in under your ${p.floor || "contract value"} floor. They're on your board, marked down. Lower the floor if you'd bid on them.`, href: "/profile#q-comp", label: "Edit contract value" },
    );
  }
  if (t.offLocation >= 2) {
    tips.push(
      job
        ? { text: `${plural(t.offLocation, "role")} didn't fit your location or work mode. They're on your board, marked down. Add areas or work modes to widen the net.`, href: "/profile#q-where", label: "Edit where you work" }
        : { text: `${plural(t.offLocation, kind.noun.one, kind.noun.many)} were outside where you can do the work. They're on your board, marked down. Add states or regions to widen the net.`, href: "/profile#q-geo", label: "Edit where you work" },
    );
  }
  if (a("q1").length < 60) {
    tips.push(
      job
        ? { text: "Your first answer is short, and Lookout writes its searches from it. Add title variants and the kind of company you want.", href: "/profile#q-q1", label: "Edit your next role" }
        : { text: "Your first answer is short, and Lookout scores each notice against it. Add the services you offer and the agencies you want to work with.", href: "/profile#q-q1", label: "Edit your work" },
    );
  }
  if (job && !p.hasResume) {
    tips.push({ text: "Add your resume. Lookout uses it to judge fit and to write better searches.", href: "/profile/materials", label: "Add resume" });
  }
  if (t.known >= Math.max(2, t.postings / 2)) {
    tips.push({ text: `Most of what matched is already on your board. New ${kind.noun.many} show up as they're posted.` });
  }
  // Dedupe by destination so two tips never point at the same field.
  const seen = new Set<string>();
  return tips.filter((x) => (x.href ? !seen.has(x.href) && !!seen.add(x.href) : true)).slice(0, 2);
}
