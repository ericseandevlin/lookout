import "server-only";
import { desc, gt, gte, ilike, lt, or, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";

/** Server errors are kept this long, then dropped by the daily cleanup (#12). */
export const ERROR_DAYS = 30;

export type ErrorSource = "route" | "render" | "scheduler";
type Where = { path?: string | null; method?: string | null; digest?: string | null };

/** The path without its query string or fragment: those can carry sign-in tokens. */
export function pathOnly(p: string | null | undefined) {
  if (!p) return null;
  return p.split(/[?#]/)[0].slice(0, 300) || null;
}

/** Record an unexpected server error. Never throws: logging must not turn one failure into two. */
export async function recordError(source: ErrorSource, e: unknown, where: Where = {}) {
  const err = e instanceof Error ? e : new Error(typeof e === "string" ? e : "Non-error thrown");
  try {
    await db.insert(schema.serverErrors).values({
      source,
      message: (err.message || err.name || "Error").slice(0, 1000),
      stack: err.stack?.slice(0, 4000) ?? null,
      path: pathOnly(where.path),
      method: where.method?.slice(0, 10) ?? null,
      digest: where.digest?.slice(0, 100) ?? (err as { digest?: unknown }).digest?.toString().slice(0, 100) ?? null,
    });
  } catch (x) {
    console.error("[errors] not recorded", x);
  }
}

/** Admin > Errors: the newest 100 matching `q` (message, path, source or digest), and counts for the last day and week. */
export async function listErrors(q = "", now = new Date()) {
  const term = q.trim().slice(0, 200);
  const like = `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const t = schema.serverErrors;
  const rows = await db
    .select({ id: t.id, source: t.source, message: t.message, stack: t.stack, path: t.path, method: t.method, digest: t.digest, at: t.at })
    .from(t)
    .where(term ? or(ilike(t.message, like), ilike(t.path, like), ilike(t.source, like), ilike(t.digest, like)) : undefined)
    .orderBy(desc(t.at))
    .limit(100);
  const since = (days: number) => new Date(now.getTime() - days * 86_400_000);
  const [{ day, week }] = await db
    .select({
      day: sql<number>`count(*) filter (where ${t.at} >= ${since(1)})::int`,
      week: sql<number>`count(*)::int`,
    })
    .from(t)
    .where(gte(t.at, since(7)));
  return { rows, day, week };
}

/** Errors for agents (#486): newest first, optionally only those after `since`. No request data is stored, so none is returned. */
export async function listErrorsSince(since: Date | null, limit = 50) {
  const t = schema.serverErrors;
  return db
    .select({ id: t.id, source: t.source, message: t.message, stack: t.stack, path: t.path, method: t.method, digest: t.digest, at: t.at })
    .from(t)
    .where(since ? gt(t.at, since) : undefined)
    .orderBy(desc(t.at))
    .limit(limit);
}

/** Drop errors older than ERROR_DAYS. Returns how many went. */
export async function pruneErrors(now = new Date()) {
  const gone = await db
    .delete(schema.serverErrors)
    .where(lt(schema.serverErrors.at, new Date(now.getTime() - ERROR_DAYS * 86_400_000)))
    .returning({ id: schema.serverErrors.id });
  return gone.length;
}
