import { z } from "zod";
import { authed, body, HttpError, json } from "@/lib/api";
import { canUseAutoApply } from "@/lib/apply";
import { ownApplication } from "@/lib/application/review";
import { canAutoSubmit, startFill } from "@/lib/application/submit";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Browser fill. "test" fills the real form and takes a screenshot without submitting.
 * "submit" sends it: only for a fully approved packet, and only when the user pressed Submit for me.
 */
export const POST = authed<Ctx>(async (req, { user, params }) => {
  if (!canUseAutoApply(user) || !canAutoSubmit()) throw new HttpError(404, "Not found");
  const { mode } = await body(req, z.object({ mode: z.enum(["test", "submit"]) }));
  const a = await ownApplication(user.id, (await params).id);
  if (a.route !== "browser") throw new HttpError(409, "This site needs the manual checklist.");
  if (a.status !== "approved") throw new HttpError(409, a.status === "submitting" ? "It's already sending." : "Approve every required item first.");
  // Two presses can both read "approved"; only the one that claims it sends (#615).
  if (!(await startFill(a.id, mode))) throw new HttpError(409, "It's already sending.");
  return json({ ok: true });
});
