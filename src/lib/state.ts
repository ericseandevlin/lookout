import "server-only";
import { and, asc, desc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import type { SessionUser } from "@/lib/auth/session";
import type { AppState, Find, Resume } from "@/lib/types";

export function toFind(
  o: typeof schema.opportunities.$inferSelect,
  u: typeof schema.userOpportunities.$inferSelect,
): Find {
  return {
    id: o.id,
    company: o.company,
    role: o.title,
    location: o.location,
    comp: o.compMin || o.compMax ? [o.compMin ?? o.compMax!, o.compMax ?? o.compMin!] : null,
    postedAt: o.postedAt,
    url: o.sourceUrl,
    score: u.score,
    reasonsMatch: u.reasonsMatch,
    reasonsGap: u.reasonsGap,
    stage: u.stage,
    pinned: u.pinned,
    archived: u.archived,
    notes: u.notes,
    seen: !!u.seenAt,
    addedAt: u.addedAt.toISOString(),
  };
}

export async function getFinds(userId: string) {
  const rows = await db
    .select()
    .from(schema.userOpportunities)
    .innerJoin(schema.opportunities, eq(schema.opportunities.id, schema.userOpportunities.opportunityId))
    .where(eq(schema.userOpportunities.userId, userId))
    .orderBy(desc(schema.userOpportunities.addedAt));
  return rows.map((r) => toFind(r.opportunities, r.user_opportunities));
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

export async function getMaterials(userId: string) {
  const rows = await db
    .select()
    .from(schema.materials)
    .where(eq(schema.materials.userId, userId))
    .orderBy(asc(schema.materials.position), asc(schema.materials.createdAt));
  const li = rows.find((m) => m.kind === "linkedin");
  return {
    resume: toResume(rows.find((m) => m.kind === "resume")),
    linkedin: { handle: li?.url ?? "", linked: !!li?.scannedAt },
    links: rows.filter((m) => m.kind === "link").map((m) => ({ id: m.id, url: m.url ?? "", kind: m.linkKind })),
  };
}

export async function getState(user: SessionUser): Promise<AppState> {
  const [settingsRow] = await db.select().from(schema.settings).where(eq(schema.settings.userId, user.id));
  const [profileRow] = await db.select().from(schema.profiles).where(eq(schema.profiles.userId, user.id));
  const [lastRun] = await db
    .select()
    .from(schema.runs)
    .where(and(eq(schema.runs.userId, user.id), eq(schema.runs.status, "done")))
    .orderBy(desc(schema.runs.finishedAt))
    .limit(1);
  const [running] = await db
    .select({ id: schema.runs.id, trigger: schema.runs.trigger })
    .from(schema.runs)
    .where(and(eq(schema.runs.userId, user.id), eq(schema.runs.status, "running")))
    .limit(1);
  const s = settingsRow;
  return {
    user: { name: user.name, email: user.email },
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
    profile: {
      answers: profileRow?.answers ?? {},
      auto: profileRow?.autofilled ?? {},
      savedAt: profileRow?.savedAt?.toISOString() ?? null,
    },
    materials: await getMaterials(user.id),
    finds: await getFinds(user.id),
    lastRunAt: lastRun?.finishedAt?.toISOString() ?? null,
    running: running ? running.trigger : null,
  };
}
