import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { kindOf, kinds } from "@/lib/kinds";

/**
 * An account's searches (#8). Each search has its own kind, profile answers,
 * board and runs; the active one (settings.active_search_id) is what the app
 * shows. Every account has at least one, created at sign-up or by the 0022
 * migration.
 */

/** The active search: the setting when it still exists, else the oldest. Null only for an account with no searches. */
export function pickActiveSearch<T extends { id: string }>(searches: T[], activeId: string | null | undefined): T | null {
  const found = activeId ? searches.find((s) => s.id === activeId) : undefined;
  return found ?? searches[0] ?? null;
}

export type SearchRow = typeof schema.searches.$inferSelect;

/** All of an account's searches, oldest first. */
export async function listSearches(userId: string): Promise<SearchRow[]> {
  return db.select().from(schema.searches).where(eq(schema.searches.userId, userId)).orderBy(asc(schema.searches.createdAt), asc(schema.searches.id));
}

/** The account's active search (the one the board, profile and runs are about). */
export async function getActiveSearch(userId: string): Promise<SearchRow | null> {
  const [s] = await db.select({ activeSearchId: schema.settings.activeSearchId }).from(schema.settings).where(eq(schema.settings.userId, userId));
  return pickActiveSearch(await listSearches(userId), s?.activeSearchId);
}

export const baseSearchName = (kind: string) => (kindOf(kind).id === "rfp" ? "RFP search" : "Job search");

/** "Job search", then "Job search 2", ... for a second search of the same kind. */
export function defaultSearchName(kind: string, existing: { name: string }[]): string {
  const base = baseSearchName(kind);
  if (!existing.some((s) => s.name === base)) return base;
  for (let i = 2; i < 100; i++) if (!existing.some((s) => s.name === `${base} ${i}`)) return `${base} ${i}`;
  return `${base} ${new Date().toISOString().slice(0, 10)}`;
}

/** Create a search and make it the active one. */
export async function createSearch(userId: string, kind: string, name?: string): Promise<SearchRow> {
  const k = kinds[kind] ? kind : "job";
  const existing = await listSearches(userId);
  const [search] = await db
    .insert(schema.searches)
    .values({ userId, kind: k, name: name?.trim().slice(0, 80) || defaultSearchName(k, existing) })
    .returning();
  await db.update(schema.settings).set({ activeSearchId: search.id }).where(eq(schema.settings.userId, userId));
  return search;
}

/** Point the account at one of its searches. Returns false when the search isn't theirs. */
export async function setActiveSearch(userId: string, searchId: string): Promise<boolean> {
  const [s] = await db
    .select({ id: schema.searches.id })
    .from(schema.searches)
    .where(and(eq(schema.searches.id, searchId), eq(schema.searches.userId, userId)));
  if (!s) return false;
  await db.update(schema.settings).set({ activeSearchId: s.id }).where(eq(schema.settings.userId, userId));
  return true;
}

/** Rename one of the account's searches. */
export async function renameSearch(userId: string, searchId: string, name: string): Promise<boolean> {
  const r = await db
    .update(schema.searches)
    .set({ name: name.trim().slice(0, 80), updatedAt: new Date() })
    .where(and(eq(schema.searches.id, searchId), eq(schema.searches.userId, userId)))
    .returning({ id: schema.searches.id });
  return r.length > 0;
}