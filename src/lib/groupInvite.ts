import "server-only";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";

/**
 * Group invite links (#601): one link a whole group can use to make accounts, for a demo or a meetup.
 * Stored in app_settings under "group_invites" so it needs no migration. Created and closed with
 * scripts/group-invite.mjs. Each use adds an invite for that email, so the normal sign-in flow lets them in.
 */
export const KEY = "group_invites";
export type GroupInvite = { label: string; expiresAt: string; max: number; used: string[]; createdAt: string; closedAt?: string };
type Store = Record<string, GroupInvite>;

export const CODE_RE = /^[a-z0-9-]{4,40}$/;

/** Why a code can't be used, or null when it can. Pure, for tests. */
export function blocked(g: GroupInvite | undefined, email: string | null, now = new Date()): null | "unknown" | "closed" | "expired" | "full" {
  if (!g) return "unknown";
  if (g.closedAt) return "closed";
  if (new Date(g.expiresAt) <= now) return "expired";
  if (email && g.used.includes(email)) return null; // the same person asking again doesn't use a second seat
  if (g.used.length >= g.max) return "full";
  return null;
}

export async function getGroupInvite(code: string): Promise<GroupInvite | undefined> {
  if (!CODE_RE.test(code)) return undefined;
  const [row] = await db.select().from(schema.appSettings).where(eq(schema.appSettings.key, KEY));
  return (row?.value as Store | undefined)?.[code];
}

/** Use a seat for this email and invite it. Locks the row so two people can't take the last seat. */
export async function redeemGroupInvite(code: string, email: string) {
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(schema.appSettings).where(eq(schema.appSettings.key, KEY)).for("update");
    const store = (row?.value ?? {}) as Store;
    const g = store[code];
    const why = blocked(g, email);
    if (why) return { ok: false as const, why };
    if (!g.used.includes(email)) {
      g.used.push(email);
      await tx.update(schema.appSettings).set({ value: store, updatedAt: new Date() }).where(eq(schema.appSettings.key, KEY));
    }
    await tx.insert(schema.invites).values({ email }).onConflictDoUpdate({ target: schema.invites.email, set: { revokedAt: null } });
    return { ok: true as const };
  });
}
