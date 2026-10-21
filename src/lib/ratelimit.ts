import "server-only";
import { lt, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";

// Fixed-window counters in Postgres, so deploys and restarts don't reset them.
const SWEEP_EVERY_MS = 10 * 60_000;
let lastSweep = 0;

export async function rateLimit(key: string, limit: number, windowMs: number): Promise<boolean> {
  const now = new Date();
  const t = schema.rateLimits;
  const nowParam = sql`${now.toISOString()}::timestamptz`;
  // One atomic upsert: a missing or expired row starts a new window at 1, a live one counts up.
  const [row] = await db
    .insert(t)
    .values({ key, count: 1, expiresAt: new Date(now.getTime() + windowMs) })
    .onConflictDoUpdate({
      target: t.key,
      set: {
        count: sql`CASE WHEN ${t.expiresAt} <= ${nowParam} THEN 1 ELSE ${t.count} + 1 END`,
        expiresAt: sql`CASE WHEN ${t.expiresAt} <= ${nowParam} THEN excluded.expires_at ELSE ${t.expiresAt} END`,
      },
    })
    .returning({ count: t.count });

  // Expired rows are dead weight; clear them now and then instead of on a schedule.
  if (now.getTime() - lastSweep >= SWEEP_EVERY_MS) {
    lastSweep = now.getTime();
    await db.delete(t).where(lt(t.expiresAt, now));
  }
  return row.count <= limit;
}
