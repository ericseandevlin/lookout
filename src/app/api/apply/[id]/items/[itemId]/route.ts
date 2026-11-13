import { z } from "zod";
import { authed, body, HttpError, json } from "@/lib/api";
import { canUseAutoApply } from "@/lib/apply";
import { analyzeItem, approveItem, assertEditable, editItem, ownApplication, reviseItem } from "@/lib/application/review";
import { LETTER_STRATEGIES } from "@/lib/application/letterStrategy";
import { redraftLetter, redraftResume } from "@/lib/application/run";
import { db, schema } from "@/lib/db";
import { and, eq } from "drizzle-orm";

type Ctx = { params: Promise<{ id: string; itemId: string }> };

const Action = z.discriminatedUnion("action", [
  z.object({ action: z.literal("edit"), content: z.string().max(40_000), note: z.string().max(500).default("") }),
  z.object({ action: z.literal("revise"), instruction: z.string().trim().min(2).max(2000) }),
  z.object({ action: z.literal("approve"), versionId: z.string().uuid().nullable() }),
  z.object({ action: z.literal("redraft"), strategy: z.enum(LETTER_STRATEGIES).optional() }),
  z.object({ action: z.literal("analyze"), versionId: z.string().uuid() }),
]);

/** Review actions on one item: save your own version, ask the AI for one, approve an exact version, or get a Recruiter Analysis. */
export const POST = authed<Ctx>(async (req, { user, params }) => {
  if (!canUseAutoApply(user)) throw new HttpError(404, "Not found");
  const { id, itemId } = await params;
  const a = await body(req, Action);
  if (a.action === "edit") return json({ status: await editItem(user.id, id, itemId, a.content, a.note) });
  if (a.action === "revise") return json(await reviseItem(user.id, id, itemId, a.instruction));
  if (a.action === "analyze") return json(await analyzeItem(user.id, id, itemId, a.versionId));
  if (a.action === "redraft") {
    const app = await ownApplication(user.id, id);
    assertEditable(app.status);
    const [it] = await db.select({ kind: schema.applicationItems.kind }).from(schema.applicationItems).where(and(eq(schema.applicationItems.id, itemId), eq(schema.applicationItems.applicationId, app.id)));
    if (it?.kind === "cover_letter") await redraftLetter(app.id, a.strategy, itemId);
    else if (it?.kind === "resume") await redraftResume(app.id, itemId);
    else throw new HttpError(400, "Only the resume and cover letter can be redrafted.");
    return json({ status: (await ownApplication(user.id, id)).status });
  }
  return json({ status: await approveItem(user.id, id, itemId, a.versionId) });
});
