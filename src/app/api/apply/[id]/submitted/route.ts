import { authed, HttpError, json } from "@/lib/api";
import { canUseAutoApply } from "@/lib/apply";
import { markSubmitted } from "@/lib/application/review";

type Ctx = { params: Promise<{ id: string }> };

/** The user finished the application by hand: record what was sent and move the find to Applied. */
export const POST = authed<Ctx>(async (_req, { user, params }) => {
  if (!canUseAutoApply(user)) throw new HttpError(404, "Not found");
  return json({ status: await markSubmitted(user.id, (await params).id) });
});
