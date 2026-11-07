import { featureOn } from "@/lib/features";
import { z } from "zod";
import { authed, body, HttpError, json } from "@/lib/api";
import { setActiveSearch } from "@/lib/searches";

const Input = z.object({ id: z.string().uuid() });

/** Point the account at one of its searches; the board, profile and runs follow it (#8). */
export const PUT = authed(async (req, { user }) => {
  if (!featureOn("SEARCHES")) throw new HttpError(404, "Not found");
  const { id } = await body(req, Input);
  if (!(await setActiveSearch(user.id, id))) throw new HttpError(404, "No such search.");
  return json({ ok: true });
});