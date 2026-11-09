import { eq } from "drizzle-orm";
import { z } from "zod";
import { authed, body, HttpError, json } from "@/lib/api";
import { canUseAutoApply } from "@/lib/apply";
import { finalTerms } from "@/lib/application/evidence";
import { assertEditable, keywordState, ownApplication } from "@/lib/application/review";
import { redraftResume } from "@/lib/application/run";
import { choose, upsertNote } from "@/lib/application/skills";
import { db, schema } from "@/lib/db";
import { patchReport } from "@/lib/application/reportStore";

type Ctx = { params: Promise<{ id: string }> };

const Pick = z.discriminatedUnion("action", [
  /** Take a keyword off the list, put it back, or add one of the person's own. */
  z.object({ action: z.enum(["remove", "restore", "add"]), term: z.string().trim().min(1).max(80), story: z.string().trim().max(1500).optional() }),
  /** What backs a keyword; saved to their experience notes for every later draft. */
  z.object({ action: z.literal("experience"), term: z.string().trim().min(1).max(80), story: z.string().trim().min(1).max(1500) }),
  /** The one explicit go: write the resume with exactly this list. */
  z.object({ action: z.literal("approve") }),
]);

/** Keyword list for this resume (#121). Any change clears the go; only "approve" writes a draft with it. */
export const POST = authed<Ctx>(async (req, { user, params }) => {
  if (!canUseAutoApply(user)) throw new HttpError(404, "Not found");
  const a = await ownApplication(user.id, (await params).id);
  assertEditable(a.status);
  const p = await body(req, Pick);
  const posting = a.report.postingText ?? "";

  if (p.action === "approve") {
    const { rows } = await keywordState(user.id, a, posting);
    const terms = finalTerms(rows);
    if (!terms.length) throw new HttpError(409, "No keyword on the list is backed by your experience yet.");
    await patchReport(a.id, (r) => ({ ...r, keywordsApproved: { terms, at: new Date().toISOString() } }), { updatedAt: new Date() });
    await redraftResume(a.id);
    return json({ ok: true });
  }

  await patchReport(
    a.id,
    (r) => ({ ...r, keywordChoices: p.action === "experience" ? r.keywordChoices : choose(r.keywordChoices, p.term, p.action === "remove" ? "exclude" : p.action === "add" ? "include" : "reset"), keywordsApproved: undefined }),
    { updatedAt: new Date() },
  );
  if (p.story) {
    const [prof] = await db.select({ notes: schema.profiles.skillNotes }).from(schema.profiles).where(eq(schema.profiles.userId, user.id));
    if (prof) await db.update(schema.profiles).set({ skillNotes: upsertNote(prof.notes, p.term, p.story) }).where(eq(schema.profiles.userId, user.id));
  }
  return json({ ok: true });
});
