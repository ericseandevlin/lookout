import { adminRoute, HttpError, json } from "@/lib/api";
import { closeGroupInvite } from "@/lib/groupInvite";

type Ctx = { params: Promise<{ code: string }> };

/** Close a group link (#993). People who already made accounts with it keep them. */
export const DELETE = adminRoute<Ctx>(async (_req, { params }) => {
  if (!(await closeGroupInvite((await params).code))) throw new HttpError(404, "No group link with that code.");
  return json({ ok: true });
});
