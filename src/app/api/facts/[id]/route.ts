import { z } from "zod";
import { authed, body, HttpError, json } from "@/lib/api";
import { featureOn } from "@/lib/features";
import { deleteFact, updateFact } from "@/lib/interview/facts";

type Ctx = { params: Promise<{ id: string }> };

async function factId(params: Ctx["params"]) {
  if (!featureOn("INTERVIEW")) throw new HttpError(404, "Not found");
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) throw new HttpError(404, "Not found");
  return id;
}

const Patch = z.object({ text: z.string().trim().min(1).max(1000).optional(), shareable: z.boolean().optional() });

/** Edit a fact's words, or switch it between Shareable and Private (#1449). */
export const PATCH = authed<Ctx>(async (req, { user, params }) => {
  const id = await factId(params);
  const f = await updateFact(user.id, id, await body(req, Patch));
  return json({ fact: { id: f.id, text: f.text, shareable: f.shareable, lockReason: f.lockReason } });
});

/** Delete a fact for good. Later drafts never see it (#1449). */
export const DELETE = authed<Ctx>(async (_req, { user, params }) => {
  const id = await factId(params);
  await deleteFact(user.id, id);
  return json({ ok: true });
});
