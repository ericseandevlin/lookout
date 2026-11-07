import { z } from "zod";
import { authed, body, HttpError, json } from "@/lib/api";
import { renameSearch } from "@/lib/searches";

const Input = z.object({ name: z.string().trim().min(1).max(80) });

type Ctx = { params: Promise<{ id: string }> };

/** Rename one of the account's searches (#8). */
export const PATCH = authed<Ctx>(async (req, { user, params }) => {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) throw new HttpError(404, "No such search.");
  const { name } = await body(req, Input);
  if (!(await renameSearch(user.id, id, name))) throw new HttpError(404, "No such search.");
  return json({ ok: true });
});