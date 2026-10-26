import "server-only";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import type { SessionUser } from "@/lib/auth/session";
import { isAdmin } from "@/lib/users";
import { canUseAutoApply } from "@/lib/apply";
import { autoSubmitOn, submitMode } from "@/lib/application/submitMode";
import type { AppState, Find, Resume, RunInfo } from "@/lib/types";
import { pickBoardRun } from "@/lib/runState";
import { listSearches, pickActiveSearch } from "@/lib/searches";
import { searchOn } from "@/lib/sources";

function toFind(
  o: typeof schema.opportunities.$inferSelect,
  u: typeof schema.userOpportunities.$inferSelect,
  a?: typeof schema.applications.$inferSelect | null,
): Find {
  return {
    id: o.id,
    type: o.type,
    company: o.company,
    role: o.title,
    location: o.location,
    comp: o.compMin || o.compMax ? [o.compMin ?? o.compMax!, o.compMax ?? o.compMin!] : null,
    currency: o.currency,
    postedAt: o.postedAt,
    attributes: o.attributes ?? {},
    url: o.sourceUrl,
    score: u.score,
    reasonsMatch: u.reasonsMatch,
    reasonsGap: u.reasonsGap,
    stage: u.stage,
    pinned: u.pinned,
    archived: u.archived,
    notes: u.notes,
    feedback: u.feedback?.reason ?? null,
    application: a ? { id: a.id, status: a.status, queuedBy: a.queuedBy } : null,
    submit: submitMode({ ats: a?.ats, url: o.sourceUrl, autoSubmit: autoSubmitOn(), captcha: a?.report.fill?.captcha }),
    seen: !!u.seenAt,
    addedAt: u.addedAt.toISOString(),
  };
}

async function getFinds(userId: string, searchId: string) {
  const rows = await db
    .select()
    .from(schema.userOpportunities)
    .innerJoin(schema.opportunities, eq(schema.opportunities.id, schema.userOpportunities.opportunityId))
    .leftJoin(
      schema.applications,
      and(eq(schema.applications.opportunityId, schema.userOpportunities.opportunityId), eq(schema.applications.userId, userId)),
    )
    .where(eq(schema.userOpportunities.searchId, searchId))
    .orderBy(desc(schema.userOpportunities.addedAt));
  return rows.map((r) => toFind(r.opportunities, r.user_opportunities, r.applications));
}

export function toResume(m: typeof schema.materials.$inferSelect | undefined): Resume | null {
  if (!m) return null;
  return {
    id: m.id,
    name: m.fileName ?? "resume",
    status: m.status ?? "done",
    uploadedAt: m.createdAt.toISOString(),
    filled: m.filledNote ?? "",
  };
}

async function getMaterials(userId: string) {
  const rows = await db
    .select()
    .from(schema.materials)
    .where(eq(schema.materials.userId, userId))
    .orderBy(asc(schema.materials.position), asc(schema.materials.createdAt));
  const li = rows.find((m) => m.kind === "linkedin");
  return {
    resume: toResume(rows.find((m) => m.kind === "resume")),
    linkedin: { handle: li?.url ?? "", linked: !!li?.scannedAt, pdf: li?.fileKey ? { name: li.fileName ?? "LinkedIn.pdf", uploadedAt: li.extracted?.uploadedAt ?? li.createdAt.toISOString() } : null },
    links: rows.filter((m) => m.kind === "link").map((m) => ({ id: m.id, url: m.url ?? "", kind: m.linkKind, status: m.status ?? null, note: m.filledNote ?? null })),
  };
}

export async function getState(user: SessionUser): Promise<AppState> {
  const [settingsRow] = await db.select().from(schema.settings).where(eq(schema.settings.userId, user.id));
  // The board, profile and runs are about the active search (#8).
  const searches = await listSearches(user.id);
  const active = pickActiveSearch(searches, settingsRow?.activeSearchId);
  const lastRun = active
    ? (
        await db
          .select()
          .from(schema.runs)
          .where(and(eq(schema.runs.searchId, active.id), eq(schema.runs.status, "done"), inArray(schema.runs.trigger, ["scheduled", "manual"])))
          .orderBy(desc(schema.runs.finishedAt))
          .limit(1)
      )[0]
    : undefined;
  const run = active ? await getLatestRun(active.id) : null;
  const running = run && (run.status === "running" || run.status === "queued") ? run : null;
  const s = settingsRow;
  return {
    user: { name: user.name, email: user.email, isAdmin: isAdmin(user), autoApply: canUseAutoApply(user) },
    settings: {
      freq: s?.freq ?? "Weekly",
      day: s?.runDay ?? "Mon",
      days: s?.runDays ?? ["Mon", "Thu"],
      digest: s?.digest ?? true,
      density: s?.density ?? "Comfortable",
      setup: s?.setupMode ?? "Until complete",
      newDays: s?.newDays ?? 7,
      railClosed: s?.railClosed ?? false,
    },
    searches: searches.map(({ id, name, kind }) => ({ id, name, kind })),
    searchId: active?.id ?? "",
    canSearch: searchOn(active?.kind ?? "job"),
    profile: {
      kind: active?.kind ?? "job",
      answers: active?.answers ?? {},
      auto: active?.autofilled ?? {},
      savedAt: active?.savedAt?.toISOString() ?? null,
    },
    materials: await getMaterials(user.id),
    finds: active ? await getFinds(user.id, active.id) : [],
    lastRunAt: lastRun?.finishedAt?.toISOString() ?? null,
    lastReport: lastRun?.report && lastRun.finishedAt ? { at: lastRun.finishedAt.toISOString(), added: lastRun.added, report: lastRun.report } : null,
    running: running ? running.trigger : null,
    run,
  };
}

/** Most recent search or link add (resume scans included), for the live progress panel. */
/** The run the board follows (#256): an active search or link add first, else the newest one. Resume scans are left out. */
export async function getLatestRun(searchId: string): Promise<RunInfo | null> {
  const recent = await db
    .select()
    .from(schema.runs)
    .where(eq(schema.runs.searchId, searchId))
    .orderBy(desc(schema.runs.startedAt))
    .limit(10);
  const r = pickBoardRun(recent);
  if (!r) return null;
  return {
    id: r.id,
    trigger: r.trigger,
    status: r.status,
    pct: r.progress?.pct ?? 0,
    step: r.progress?.step ?? "",
    log: r.progress?.log ?? [],
    found: r.found,
    added: r.added,
    error: r.error,
    startedAt: r.startedAt.toISOString(),
    finishedAt: r.finishedAt?.toISOString() ?? null,
    report: r.report ?? null,
  };
}
