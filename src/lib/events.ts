/**
 * First-party product events (#35). The server records actions it handles; the browser reports
 * only the few things the server can't see, from a fixed list. No third-party scripts.
 */

export const SERVER_EVENTS = ["sign_in", "welcome_done", "search_run", "find_added", "pin", "stage_change", "not_a_fit", "profile_edit", "material_upload", "email_click", "auto_apply_on", "auto_apply_off", "search_created", "consent_accepted", "settings_change"] as const;
/** The only types the browser may send. */
export const CLIENT_EVENTS = ["page_view", "heartbeat", "find_opened", "posting_clicked", "report_opened", "tip_clicked"] as const;
export type EventType = (typeof SERVER_EVENTS)[number] | (typeof CLIENT_EVENTS)[number];
export type ClientEvent = (typeof CLIENT_EVENTS)[number];

/** Seconds between heartbeats while a page is visible: time on page is heartbeats x this. */
export const HEARTBEAT_SECONDS = 60;

export const EVENT_LABEL: Record<EventType, string> = {
  sign_in: "Signed in",
  welcome_done: "Finished the welcome step",
  search_run: "Ran a search",
  find_added: "Added a link",
  pin: "Pinned",
  stage_change: "Moved a find",
  not_a_fit: "Not a fit",
  profile_edit: "Edited profile",
  material_upload: "Uploaded",
  email_click: "Clicked from email",
  auto_apply_on: "Turned auto-apply on",
  auto_apply_off: "Turned auto-apply off",
  search_created: "Created a search",
  consent_accepted: "Agreed to the terms",
  settings_change: "Changed a setting",
  page_view: "Opened page",
  heartbeat: "On page",
  find_opened: "Opened a find",
  posting_clicked: "Opened a posting",
  report_opened: "Opened search report",
  tip_clicked: "Clicked a tip",
};

/** Monday 00:00 UTC of a date's week, as YYYY-MM-DD. */
export function weekOf(d: Date) {
  const m = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - ((d.getUTCDay() + 6) % 7)));
  return m.toISOString().slice(0, 10);
}

/** People with any event in each of the last `weeks` weeks, oldest first. Heartbeats alone don't count. */
export function weeklyActives(rows: { userId: string; type: string; at: Date }[], weeks: number, now = new Date()) {
  const keys: string[] = [];
  for (let i = weeks - 1; i >= 0; i--) keys.push(weekOf(new Date(now.getTime() - i * 7 * 864e5)));
  const sets = new Map(keys.map((k) => [k, new Set<string>()]));
  for (const r of rows) if (r.type !== "heartbeat") sets.get(weekOf(r.at))?.add(r.userId);
  return keys.map((week) => ({ week, active: sets.get(week)!.size }));
}

/** Collapse runs of heartbeats on the same page into one "On page" row with minutes, for a readable timeline. */
export function timeline(rows: { type: string; target: string | null; at: Date }[]) {
  const out: { type: string; target: string | null; at: Date; minutes?: number }[] = [];
  for (const r of [...rows].sort((a, b) => a.at.getTime() - b.at.getTime())) {
    const last = out[out.length - 1];
    if (r.type === "heartbeat" && last?.type === "heartbeat" && last.target === r.target && r.at.getTime() - last.at.getTime() <= (last.minutes ?? 1) * 60_000 + 2 * HEARTBEAT_SECONDS * 1000) {
      last.minutes = (last.minutes ?? 1) + HEARTBEAT_SECONDS / 60;
      continue;
    }
    out.push(r.type === "heartbeat" ? { ...r, minutes: HEARTBEAT_SECONDS / 60 } : { ...r });
  }
  return out.reverse();
}

export type FunnelPerson = {
  signedIn: boolean;
  welcome: boolean;
  answered: boolean;
  material: boolean;
  searchProfile: boolean;
  searched: boolean;
  found: boolean;
  acted: boolean;
};
export type FunnelStep = keyof FunnelPerson;
export const FUNNEL_STEPS: [FunnelStep | "accounts", string][] = [
  ["accounts", "Accounts"],
  ["signedIn", "Signed in"],
  ["welcome", "Finished the welcome step"],
  ["answered", "Answered the 5 questions"],
  ["material", "Added a resume or LinkedIn PDF"],
  ["searchProfile", "Search profile built"],
  ["searched", "Had a search run"],
  ["found", "Got a first find"],
  ["acted", "Acted on a find"],
];
const STEP_KEYS = FUNNEL_STEPS.slice(1).map(([k]) => k as FunnelStep);

/** How many people reached each step. Each step counts only people who also reached the ones before it. */
export function funnel(people: FunnelPerson[]) {
  return FUNNEL_STEPS.map(([k, label], i) => ({ key: k, label, count: i === 0 ? people.length : people.filter((p) => STEP_KEYS.slice(0, i).every((s) => p[s])).length }));
}

/** The first step someone hasn't reached, as its label: where they're stuck. Null once they've done them all. */
export function nextStep(p: FunnelPerson) {
  const i = STEP_KEYS.findIndex((s) => !p[s]);
  return i < 0 ? null : FUNNEL_STEPS[i + 1][1];
}
