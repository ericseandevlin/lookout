import type { Stage } from "@/lib/db/schema";

/**
 * Are finds any good (#31)? The beta's question is whether people act on what Lookout finds. Only
 * finds Lookout added count (not ones people added by hand). Opened = looked at in the drawer;
 * acted = pinned, or moved to Applied or any stage that comes after applying.
 */

export type FindRow = { userId: string; addedAt: Date; seenAt: Date | null; pinned: boolean; stage: string; feedback: { reason: string } | null };
export type Outcome = { added: number; opened: number; pinned: number; applied: number; notFit: number; acted: number };

/** Stages that mean the person applied. "Closed" (posting gone) and "Nope" (they passed) don't. */
export const APPLIED: readonly Stage[] = ["Applied", "Interview", "Offer", "Not selected", "Ghosted"];

export function outcome(rows: FindRow[]): Outcome {
  const o: Outcome = { added: rows.length, opened: 0, pinned: 0, applied: 0, notFit: 0, acted: 0 };
  for (const r of rows) {
    const applied = (APPLIED as readonly string[]).includes(r.stage);
    if (r.seenAt) o.opened++;
    if (r.pinned) o.pinned++;
    if (applied) o.applied++;
    if (r.feedback) o.notFit++;
    if (r.pinned || applied) o.acted++;
  }
  return o;
}

/** A share as a whole percent, or null when there's nothing to divide. */
export const pct = (n: number, of: number) => (of ? Math.round((n / of) * 100) : null);

/** Monday 00:00 UTC of the week a date falls in, as YYYY-MM-DD. */
export function weekOf(d: Date) {
  const day = (d.getUTCDay() + 6) % 7;
  const m = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day));
  return m.toISOString().slice(0, 10);
}

/** The last `weeks` weeks, oldest first, with an outcome for the finds added in each (empty weeks included). */
export function byWeek(rows: FindRow[], weeks: number, now = new Date()) {
  const keys: string[] = [];
  for (let i = weeks - 1; i >= 0; i--) keys.push(weekOf(new Date(now.getTime() - i * 7 * 864e5)));
  const groups = new Map(keys.map((k) => [k, [] as FindRow[]]));
  for (const r of rows) groups.get(weekOf(r.addedAt))?.push(r);
  return keys.map((week) => ({ week, ...outcome(groups.get(week)!) }));
}

/** Most common "Not a fit" reasons, most frequent first. */
export function topReasons(rows: FindRow[], n = 6) {
  const c = new Map<string, number>();
  for (const r of rows) if (r.feedback?.reason) c.set(r.feedback.reason, (c.get(r.feedback.reason) ?? 0) + 1);
  return [...c].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, n).map(([reason, count]) => ({ reason, count }));
}

/** Finds a search added: same person, added while it ran (a minute of slack for the final save). */
export function findsOfRun(run: { userId: string; startedAt: Date; finishedAt: Date | null }, rows: FindRow[]) {
  if (!run.finishedAt) return [];
  const from = run.startedAt.getTime();
  const to = run.finishedAt.getTime() + 60_000;
  return rows.filter((r) => r.userId === run.userId && r.addedAt.getTime() >= from && r.addedAt.getTime() <= to);
}
