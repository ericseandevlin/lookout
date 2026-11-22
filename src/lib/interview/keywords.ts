import "server-only";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { stripHtml } from "@/lib/ai/entities";
import { HttpError } from "@/lib/api";
import { keywordPicks, type KeywordRow } from "@/lib/application/evidence";
import { patchReport } from "@/lib/application/reportStore";
import { assertEditable, keywordState, ownApplication } from "@/lib/application/review";
import { choose, upsertNote } from "@/lib/application/skills";
import { topicKey } from "./rules";

/**
 * The keywords an application's resume is missing, for the one interview (#1485). "Interview me" on the review page
 * opens the interview with these first. A keyword an answer shows the person did gets their facts as its experience
 * note, which is what backs a keyword (supportFor), so it moves to "In your resume". A bare no marks it not relevant.
 */

const lower = (s: string) => s.trim().toLowerCase();

/** The missing keywords, starred first: not removed and not backed. */
export function missingTerms(rows: KeywordRow[], picks: string[]) {
  const missing = rows.filter((r) => !r.removed && !r.support).map((r) => r.term);
  const starred = picks.filter((p) => missing.some((m) => lower(m) === lower(p)));
  return [...starred, ...missing.filter((m) => !starred.some((p) => lower(p) === lower(m)))];
}

/** The missing keywords for one of the person's applications. Empty when it can't change or isn't theirs. */
export async function missingKeywords(userId: string, appId: string): Promise<string[]> {
  try {
    const a = await ownApplication(userId, appId);
    assertEditable(a.status);
    const [o] = await db.select({ title: schema.opportunities.title, description: schema.opportunities.description }).from(schema.opportunities).where(eq(schema.opportunities.id, a.opportunityId));
    const posting = stripHtml(a.report.postingText || o?.description || "");
    const title = o?.title ?? "";
    const { rows } = await keywordState(userId, a, posting, title);
    return missingTerms(rows, keywordPicks(rows, posting, title));
  } catch (e) {
    if (e instanceof HttpError) return [];
    throw e;
  }
}

/** A plain story question for one keyword, when the model asks none. */
export const keywordQuestion = (term: string) => `Tell me about a time you worked on ${term}: where it was, your part, and how big it was.`;

/** The keywords a topic covers: the interviewer names a keyword topic after its keywords. */
export const termsOf = (topic: string, terms: string[]) => {
  const k = topicKey(topic);
  return terms.filter((t) => k.includes(topicKey(t)));
};

/** The answer's shareable facts back these keywords: each gets them as its experience note. */
export async function backKeywords(userId: string, terms: string[], facts: string[]) {
  if (!terms.length || !facts.length) return;
  const [prof] = await db.select({ notes: schema.profiles.skillNotes }).from(schema.profiles).where(eq(schema.profiles.userId, userId));
  let notes = prof?.notes ?? [];
  for (const t of terms) notes = upsertNote(notes, t, facts.join(" ").slice(0, 1500));
  if (prof) await db.update(schema.profiles).set({ skillNotes: notes }).where(eq(schema.profiles.userId, userId));
  else await db.insert(schema.profiles).values({ userId, skillNotes: notes });
}

/** They haven't done it: those keywords leave Missing on that application. */
export async function declineKeywords(appId: string, terms: string[]) {
  if (!terms.length) return;
  await patchReport(appId, (r) => ({ ...r, keywordChoices: terms.reduce((c, t) => choose(c, t, "exclude"), r.keywordChoices), keywordsApproved: undefined }));
}
