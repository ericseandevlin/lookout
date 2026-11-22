import "server-only";
import { and, desc, eq, notInArray } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { featureOn } from "@/lib/features";
import { HttpError } from "@/lib/api";
import { factsBlock } from "./rules";

export type Fact = typeof schema.profileFacts.$inferSelect;

/** Every fact, newest first, for What Lookout knows. */
export const listFacts = (userId: string) =>
  db.select().from(schema.profileFacts).where(eq(schema.profileFacts.userId, userId)).orderBy(desc(schema.profileFacts.createdAt));

/**
 * The facts a drafting step may use (#1449): shareable, never pay, never a dealbreaker (it is what the person won't
 * take, not something to say). Private facts are filtered in the query, so they
 * are never even read into a draft's inputs. Off with the feature, so prod drafts stay as they were.
 */
export async function draftableFacts(userId: string) {
  if (!featureOn("INTERVIEW")) return [];
  return db
    .select({ text: schema.profileFacts.text, kind: schema.profileFacts.kind, shareable: schema.profileFacts.shareable })
    .from(schema.profileFacts)
    .where(and(eq(schema.profileFacts.userId, userId), eq(schema.profileFacts.shareable, true), notInArray(schema.profileFacts.kind, ["pay", "dealbreaker"])))
    .orderBy(schema.profileFacts.createdAt);
}

/** The block drafting prompts add after experience notes. Empty when there is nothing to share. */
export const draftFactsBlock = async (userId: string) => factsBlock(await draftableFacts(userId));

async function own(userId: string, id: string) {
  const [f] = await db.select().from(schema.profileFacts).where(and(eq(schema.profileFacts.id, id), eq(schema.profileFacts.userId, userId)));
  if (!f) throw new HttpError(404, "Not found");
  return f;
}

/**
 * Edit a fact's words or switch it between Shareable and Private. Pay can't be made shareable. Once the person
 * chooses, Lookout's own lock note goes away: the choice is theirs now.
 */
export async function updateFact(userId: string, id: string, p: { text?: string; shareable?: boolean }) {
  const f = await own(userId, id);
  if (p.shareable && f.kind === "pay") throw new HttpError(400, "Pay always stays private.");
  const [row] = await db
    .update(schema.profileFacts)
    .set({
      ...(p.text !== undefined && { text: p.text }),
      ...(p.shareable !== undefined && { shareable: p.shareable, lockReason: p.shareable ? null : f.lockReason }),
      updatedAt: new Date(),
    })
    .where(eq(schema.profileFacts.id, f.id))
    .returning();
  return row;
}

/** Gone for good: later drafts never see it. */
export async function deleteFact(userId: string, id: string) {
  const f = await own(userId, id);
  await db.delete(schema.profileFacts).where(eq(schema.profileFacts.id, f.id));
}
