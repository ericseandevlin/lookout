import { z } from "zod";
import { authed, body, HttpError, json } from "@/lib/api";
import { canUseAutoApply } from "@/lib/apply";
import { approveItem, editItem, reviseItem } from "@/lib/application/review";

type Ctx = { params: Promise<{ id: string; itemId: string }> };

const Action = z.discriminatedUnion("action", [
  z.object({ action: z.literal("edit"), content: z.string().max(40_000), note: z.string().max(500).default("") }),
  z.object({ action: z.literal("revise"), instruction: z.string().trim().min(2).max(2000) }),
  z.object({ action: z.literal("approve"), versionId: z.string().uuid().nullable() }),
]);

/** Review actions on one item: save your own version, ask the AI for one, or approve an exact version. */
export const POST = authed<Ctx>(async (req, { user, params }) => {
  if (!canUseAutoApply(user)) throw new HttpError(404, "Not found");
  const { id, itemId } = await params;
  const a = await body(req, Action);
  if (a.action === "edit") return json({ status: await editItem(user.id, id, itemId, a.content, a.note) });
  if (a.action === "revise") return json(await reviseItem(user.id, id, itemId, a.instruction));
  return json({ status: await approveItem(user.id, id, itemId, a.versionId) });
});
