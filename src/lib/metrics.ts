/**
 * Admin > Metrics (#36): the beta goals from ROADMAP > Goals, computed from product events and
 * the board. Pure functions here; the queries are in metricsStore.ts.
 */
import { weekOf } from "./events";

export type MetricEvent = { userId: string; type: string; target: string | null; meta: Record<string, unknown> | null; at: Date };

const WEEK = 7 * 864e5;
const APPLIED = new Set(["Applied", "Interview", "Offer", "Not selected", "Ghosted"]);

/** Beta goals, through January 10, 2027 (ROADMAP > Goals). */
export const GOALS = { weeklyActives: 5, actedPerActive: 1, interviews: 1, week4Retention: 0.6, costPerActiveMonth: 1 };

/**
 * The find an event acted on, or null. Acting on a find: opened the posting, pinned it, moved it to
 * Applied or later, or clicked it from email (the email's board link isn't a find).
 */
export function actedOn(e: MetricEvent): string | null {
  if (!e.target) return null;
  if (e.type === "posting_clicked") return e.target;
  if (e.type === "pin") return e.meta?.on === false ? null : e.target;
  if (e.type === "email_click") return e.target === "board" ? null : e.target;
  if (e.type === "stage_change") return APPLIED.has(String(e.meta?.stage)) ? e.target : null;
  return null;
}

/** Per week, oldest first: active people and distinct finds acted on per active person. Heartbeats don't count. */
export function weekly(events: MetricEvent[], weeks: number, now = new Date()) {
  const keys: string[] = [];
  for (let i = weeks - 1; i >= 0; i--) keys.push(weekOf(new Date(now.getTime() - i * WEEK)));
  const active = new Map(keys.map((k) => [k, new Set<string>()]));
  const acted = new Map(keys.map((k) => [k, new Set<string>()]));
  for (const e of events) {
    if (e.type === "heartbeat") continue;
    const w = weekOf(e.at);
    active.get(w)?.add(e.userId);
    const find = actedOn(e);
    if (find) acted.get(w)?.add(`${e.userId}:${find}`);
  }
  return keys.map((week) => {
    const people = active.get(week)!.size;
    const finds = acted.get(week)!.size;
    return { week, active: people, acted: finds, actedPerActive: people ? finds / people : 0 };
  });
}

/**
 * Week-n retention: of people whose nth week (counting the week of their first event as week 1)
 * is over, the share who did anything in that week.
 */
export function retention(events: MetricEvent[], n: number, now = new Date()) {
  const first = new Map<string, number>();
  const weeksOf = new Map<string, Set<string>>();
  for (const e of events) {
    if (e.type === "heartbeat") continue;
    const t = new Date(`${weekOf(e.at)}T00:00:00Z`).getTime();
    if (!first.has(e.userId) || t < first.get(e.userId)!) first.set(e.userId, t);
    if (!weeksOf.has(e.userId)) weeksOf.set(e.userId, new Set());
    weeksOf.get(e.userId)!.add(weekOf(e.at));
  }
  const thisWeek = new Date(`${weekOf(now)}T00:00:00Z`).getTime();
  let eligible = 0;
  let retained = 0;
  for (const [user, start] of first) {
    const wn = start + (n - 1) * WEEK;
    if (wn >= thisWeek) continue;
    eligible++;
    if (weeksOf.get(user)!.has(new Date(wn).toISOString().slice(0, 10))) retained++;
  }
  return { eligible, retained, rate: eligible ? retained / eligible : null };
}

export const week4Retention = (events: MetricEvent[], now = new Date()) => retention(events, 4, now);

export type Joiner = { createdAt: Date; profileSaved: boolean; resume: boolean; firstSearchAt: Date | null };

/**
 * Activation: of people who joined at least 7 days ago, the share with a saved profile and a resume
 * whose first search finished within 7 days of joining. Profile and resume are checked as they are now
 * (they keep only the latest save), the search by its date.
 */
export function activation(people: Joiner[], now = new Date()) {
  let eligible = 0;
  let activated = 0;
  for (const p of people) {
    const by = p.createdAt.getTime() + 7 * 864e5;
    if (by > now.getTime()) continue;
    eligible++;
    if (p.profileSaved && p.resume && p.firstSearchAt && p.firstSearchAt.getTime() <= by) activated++;
  }
  return { eligible, activated, rate: eligible ? activated / eligible : null };
}

/** Average match score of finds people acted on and of the rest, or null when a side is empty. */
export function scoreSplit(finds: { score: number; acted: boolean }[]) {
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  return { acted: avg(finds.filter((f) => f.acted).map((f) => f.score)), ignored: avg(finds.filter((f) => !f.acted).map((f) => f.score)) };
}

/** Searches that read at least one page, of the ones that finished (done or failed). */
export function searchSuccess(runs: { status: string; read: number | null }[]) {
  const ended = runs.filter((r) => r.status === "done" || r.status === "failed");
  const ok = ended.filter((r) => r.status === "done" && (r.read ?? 0) > 0).length;
  return { searches: ended.length, succeeded: ok, rate: ended.length ? ok / ended.length : null };
}

/** Distinct people with any event (not heartbeats) since a date. */
export function activeSince(events: MetricEvent[], since: Date) {
  return new Set(events.filter((e) => e.type !== "heartbeat" && e.at >= since).map((e) => e.userId)).size;
}

export type OutcomeReport = { userId: string; outcome: "interview" | "offer"; boardInterview: boolean; boardOffer: boolean };

/**
 * Interviews and offers (#526): finds at Interview or Offer on the board, plus one for each person who said
 * yes in the survey and has none on their board, so nobody counts twice. An offer means an interview too.
 */
export function outcomes(board: { interviews: number; offers: number }, reports: OutcomeReport[]) {
  const interviewed = new Set<string>();
  const offered = new Set<string>();
  for (const r of reports) {
    if (!r.boardInterview) interviewed.add(r.userId);
    if (r.outcome === "offer" && !r.boardOffer) offered.add(r.userId);
  }
  return { interviews: board.interviews + interviewed.size, offers: board.offers + offered.size, survey: { interviews: interviewed.size, offers: offered.size } };
}

/**
 * A waitlist channel (#527) as a short lowercase slug, or null. Tag each channel test's link with
 * ?ref=<channel> (or ?utm_source=); spaces and other characters become dashes.
 */
export function channelOf(raw: string | string[] | null | undefined): string | null {
  const s = (Array.isArray(raw) ? raw[0] : raw) ?? "";
  const slug = s.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^[-._]+|[-._]+$/g, "").slice(0, 40);
  return slug || null;
}

export type Signup = { channel: string | null; joined: boolean; active: boolean };

/**
 * Growth (#527): waitlist requests per channel, how many joined, and how many of those were active
 * in the last full week. No channel counts as "direct". Most signups first.
 */
export function byChannel(signups: Signup[]) {
  const per = new Map<string, { channel: string; signups: number; joined: number; active: number }>();
  for (const s of signups) {
    const channel = s.channel ?? "direct";
    const c = per.get(channel) ?? { channel, signups: 0, joined: 0, active: 0 };
    c.signups++;
    if (s.joined) c.joined++;
    if (s.joined && s.active) c.active++;
    per.set(channel, c);
  }
  return [...per.values()].sort((a, b) => b.signups - a.signups || a.channel.localeCompare(b.channel));
}
