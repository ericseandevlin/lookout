import { z } from "zod";

/**
 * Networking events (#7): meetups, panels, industry nights, conferences and talks that match the
 * person's field and interests, on their own list. Pure helpers here; the search lives in
 * src/lib/agent/networking.ts.
 */

export type EventReach = "nearby" | "online" | "both";
export const EVENT_REACH: EventReach[] = ["nearby", "online", "both"];
export const MILES = [10, 25, 50, 100] as const;
export type EventFreq = "weekly" | "monthly";
export const EVENT_FREQS: EventFreq[] = ["weekly", "monthly"];
const FREQ_DAYS: Record<EventFreq, number> = { weekly: 7, monthly: 30 };

/** Whether an event search is due (#265): never searched, or a week or a month has passed. A little slack so a weekly job search on the same day still counts. */
export function eventsDue(freq: EventFreq, lastAt: Date | null, now = new Date()) {
  if (!lastAt) return true;
  return now.getTime() - lastAt.getTime() >= FREQ_DAYS[freq] * 864e5 - 6 * 3600_000;
}

export type NetworkingEvent = {
  id: string;
  title: string;
  host: string;
  startsOn: string;
  endsOn: string | null;
  time: string;
  place: string;
  online: boolean;
  cost: string;
  why: string;
  url: string;
  /** Board fields (#265). */
  pinned?: boolean;
  archived?: boolean;
  fit?: number | null;
  miles?: number | null;
};

export const EventsDraft = z.object({
  events: z
    .array(
      z.object({
        title: z.string(),
        host: z.string().describe("Who runs it; empty if not stated"),
        startsOn: z.string().describe("YYYY-MM-DD, as stated on the page. Skip the event if no date is given"),
        endsOn: z.string().describe("YYYY-MM-DD for multi-day events, else empty"),
        time: z.string().describe("As stated, e.g. '6:30 pm'; empty if not stated"),
        place: z.string().describe("Venue and city, or 'Online'"),
        online: z.boolean(),
        cost: z.string().describe("As stated: 'Free', '$25'; empty if not stated"),
        why: z.string().describe("One sentence: why it fits this person's field and interests"),
        url: z.string().describe("The page the event is on, copied from the <page url>"),
        fit: z.number().describe("1 to 5: how well it fits their field and interests (5 = a must-go)"),
        miles: z.number().nullable().describe("Rough miles from where they live; null if online or you can't tell"),
      }),
    )
    .describe("Only real, upcoming, dated events that fit. An empty list is fine"),
});

const ISO = /^\d{4}-\d{2}-\d{2}$/;

const fitOf = (n: unknown) => (typeof n === "number" && Number.isFinite(n) ? Math.min(5, Math.max(1, Math.round(n))) : null);
const milesOf = (n: unknown) => (typeof n === "number" && Number.isFinite(n) && n >= 0 && n < 5000 ? Math.round(n) : null);

/** Same event listed twice (two sites, same title and day) is one event. */
export function eventFingerprint(title: string, startsOn: string) {
  return `${startsOn}:${title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()}`;
}

/** An event is past once its last day is before today. */
export const isPast = (e: { startsOn: string; endsOn: string | null }, today: string) => (e.endsOn && ISO.test(e.endsOn) ? e.endsOn : e.startsOn) < today;

/** The saved interests string as a list: split on commas, semicolons or lines, trimmed, no repeats. */
export function splitInterests(interests: string) {
  const seen = new Set<string>();
  return interests
    .split(/[,;\n]/)
    .map((t) => t.trim())
    .filter((t) => t && !seen.has(t.toLowerCase()) && seen.add(t.toLowerCase()));
}

/** Back to the one string event search reads (#264), so saved prefs stay compatible. */
export const joinInterests = (list: string[]) => splitInterests(list.join(", ")).join(", ");

// "VP of UX Engineering" -> "UX Engineering", "Senior Product Designer" -> "Product Designer".
const LEVEL = /^(?:(?:senior|sr\.?|junior|jr\.?|lead|principal|staff|chief|head|director|vp|svp|evp|avp|vice president|associate|executive|managing|group)\b[\s,]*(?:of\b|for\b)?[\s,]*)+/i;
const role = (title: string) => title.replace(LEVEL, "").replace(/\s*\(.*\)$/, "").trim();

/**
 * Interest chips for the Events page (#264), from the search profile: their role, industries,
 * skills and search terms, in that order. No model call, so they follow the profile whenever it's
 * rebuilt and fill in as it does. Commas would split a chip, so those are dropped.
 */
export function suggestInterests(p: { targetTitles: string[]; industries: string[]; strengths: string[]; searchTerms: string[] } | null | undefined, max = 12) {
  if (!p) return [];
  const pool = [...p.targetTitles.slice(0, 2).map(role), ...p.industries, ...p.strengths, ...p.searchTerms];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of pool) {
    const t = raw.trim();
    const k = t.toLowerCase();
    if (!t || t.length > 40 || /[,;\n]/.test(t) || k === "open" || seen.has(k)) continue;
    seen.add(k);
    out.push(t);
    if (out.length >= max) break;
  }
  return out;
}

/** Up to three search queries from the person's interests, place and reach. No model call. */
export function eventQueries(interests: string, where: string, reach: EventReach, now = new Date()) {
  const topics = splitInterests(interests).slice(0, 3);
  if (!topics.length) return [];
  const month = now.toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
  const city = where.split(/[;(]/)[0].replace(/\b(remote|hybrid|onsite|on-site)\b/gi, "").replace(/[,\s]+$/, "").trim();
  const out: string[] = [];
  for (const t of topics) {
    if (reach !== "online" && city) out.push(`${t} meetup OR panel OR conference ${city} ${month}`);
    if (reach !== "nearby") out.push(`${t} online event OR webinar OR virtual conference ${month}`);
  }
  return [...new Set(out)].slice(0, 3);
}

/**
 * Keep what the model found only if it's well formed: a real date on or after today, a link to a
 * page that was actually read, online-ness that matches the person's reach, and not a duplicate.
 */
export function cleanEvents(drafts: z.infer<typeof EventsDraft>["events"], opts: { today: string; readUrls: string[]; known: Set<string>; reach: EventReach }) {
  const read = new Set(opts.readUrls);
  const seen = new Set(opts.known);
  const out: (Omit<NetworkingEvent, "id"> & { fingerprint: string })[] = [];
  for (const d of drafts) {
    const title = d.title.trim();
    if (!title || !ISO.test(d.startsOn) || !read.has(d.url)) continue;
    const endsOn = ISO.test(d.endsOn) && d.endsOn >= d.startsOn ? d.endsOn : null;
    if (isPast({ startsOn: d.startsOn, endsOn }, opts.today)) continue;
    if ((opts.reach === "online" && !d.online) || (opts.reach === "nearby" && d.online)) continue;
    const fingerprint = eventFingerprint(title, d.startsOn);
    if (seen.has(fingerprint)) continue;
    seen.add(fingerprint);
    out.push({ title: title.slice(0, 200), host: d.host.trim().slice(0, 120), startsOn: d.startsOn, endsOn, time: d.time.trim().slice(0, 40), place: (d.online ? d.place || "Online" : d.place).trim().slice(0, 160), online: d.online, cost: d.cost.trim().slice(0, 60), why: d.why.trim().slice(0, 300), url: d.url, fit: fitOf(d.fit), miles: d.online ? null : milesOf(d.miles), fingerprint });
  }
  return out;
}
