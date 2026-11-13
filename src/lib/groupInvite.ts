import "server-only";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";

/**
 * Group invite links (#601): one link a whole group can use to make accounts, for a demo or a meetup.
 * Stored in app_settings under "group_invites" so it needs no migration. Made, listed and closed on the
 * Admin People page (#993); scripts/group-invite.mjs still works over SSH. Each use adds an invite for that
 * email, so the normal sign-in flow lets them in.
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

export type GroupInviteRow = GroupInvite & { code: string; state: "open" | "closed" | "expired" | "full" };

/** One row per link for the Admin page, newest first, with why it can't be used anymore. Pure, for tests. */
export function rows(store: Store, now = new Date()): GroupInviteRow[] {
  return Object.entries(store)
    .map(([code, g]) => ({ ...g, code, state: (blocked(g, null, now) ?? "open") as GroupInviteRow["state"] }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** A readable code from the label, like "tuesday-spin-k3f9", so it can be read out loud. Pure, for tests. */
export function suggestCode(label: string, rand = () => Math.random()) {
  const base = label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 30).replace(/-+$/, "");
  const tail = Array.from({ length: 4 }, () => "abcdefghjkmnpqrstuvwxyz23456789"[Math.floor(rand() * 31)]).join("");
  return base ? `${base}-${tail}` : `group-${tail}`;
}

export async function listGroupInvites() {
  const [row] = await db.select().from(schema.appSettings).where(eq(schema.appSettings.key, KEY));
  return rows((row?.value ?? {}) as Store);
}

/** Make a link. Locks the row so two admins can't write over each other. */
export async function createGroupInvite(p: { code?: string; label: string; max: number; days: number }) {
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(schema.appSettings).where(eq(schema.appSettings.key, KEY)).for("update");
    const store = (row?.value ?? {}) as Store;
    let code = p.code || suggestCode(p.label);
    if (!CODE_RE.test(code)) return { ok: false as const, status: 400, error: "Codes are 4 to 40 lowercase letters, numbers or dashes." };
    if (p.code && store[code]) return { ok: false as const, status: 409, error: `${code} is taken. Pick another code.` };
    while (store[code]) code = suggestCode(p.label);
    const now = new Date();
    store[code] = { label: p.label, max: p.max, used: [], createdAt: now.toISOString(), expiresAt: new Date(now.getTime() + p.days * 864e5).toISOString() };
    await tx
      .insert(schema.appSettings)
      .values({ key: KEY, value: store })
      .onConflictDoUpdate({ target: schema.appSettings.key, set: { value: store, updatedAt: now } });
    return { ok: true as const, invite: { ...store[code], code } };
  });
}

/** Close a link. People who already made accounts keep them. */
export async function closeGroupInvite(code: string) {
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(schema.appSettings).where(eq(schema.appSettings.key, KEY)).for("update");
    const store = (row?.value ?? {}) as Store;
    if (!store[code]) return false;
    store[code].closedAt ??= new Date().toISOString();
    await tx.update(schema.appSettings).set({ value: store, updatedAt: new Date() }).where(eq(schema.appSettings.key, KEY));
    return true;
  });
}
