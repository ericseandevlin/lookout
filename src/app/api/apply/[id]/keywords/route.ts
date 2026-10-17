import { eq } from "drizzle-orm";
import { z } from "zod";
import { authed, body, HttpError, json } from "@/lib/api";
import { canUseAutoApply } from "@/lib/apply";
import { ownApplication } from "@/lib/application/review";
import { choose, upsertNote } from "@/lib/application/skills";
import { db, schema } from "@/lib/db";

type Ctx = { params: Promise<{ id: string }> };

const Pick = z.object({
  term: z.string().trim().min(1).max(80),
  action: z.enum(["include", "exclude", "reset"]),
  /** What backs a skill the person says they have; saved to their experience notes for every later draft. */
  story: z.string().max(1500).optional(),
});

/** Keyword picks for this resume (#121). Takes effect on the next resume redraft. */
export const POST = authed<Ctx>(async (req, { user, params }) => {
  if (!canUseAutoApply(user)) throw new HttpError(404, "Not found");
  const a = await ownApplication(user.id, (await params).id);
  if (a.status === "submitted" || a.status === "submitting") throw new HttpError(409, "This application was already sent.");
  const p = await body(req, Pick);
  const keywordChoices = choose(a.report.keywordChoices, p.term, p.action);
  await db.update(schema.applications).set({ report: { ...a.report, keywordChoices }, updatedAt: new Date() }).where(eq(schema.applications.id, a.id));
  if (p.action === "include" && p.story !== undefined) {
    const [prof] = await db.select({ notes: schema.profiles.skillNotes }).from(schema.profiles).where(eq(schema.profiles.userId, user.id));
    if (prof) await db.update(schema.profiles).set({ skillNotes: upsertNote(prof.notes, p.term, p.story) }).where(eq(schema.profiles.userId, user.id));
  }
  return json({ keywordChoices });
});
