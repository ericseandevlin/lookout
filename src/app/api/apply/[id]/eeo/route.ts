import { z } from "zod";
import { authed, body, HttpError, json } from "@/lib/api";
import { canUseAutoApply } from "@/lib/apply";
import { setEeoRun } from "@/lib/application/review";

type Ctx = { params: Promise<{ id: string }> };

const Run = z.object({
  on: z.boolean().optional(),
  skip: z.object({ itemId: z.string().uuid(), skip: z.boolean() }).optional(),
});

/** Share EEO answers on this application or not (off by default), and skip single questions (#122). */
export const POST = authed<Ctx>(async (req, { user, params }) => {
  if (!canUseAutoApply(user)) throw new HttpError(404, "Not found");
  const p = await body(req, Run);
  return json({ eeoRun: await setEeoRun(user.id, (await params).id, p) });
});
