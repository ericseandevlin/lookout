import { z } from "zod";
import { authed, body, json } from "@/lib/api";
import { CURRENT_COMP_MAX, CURRENT_COMP_MIN } from "@/lib/currentComp";
import { loadCurrentComp, saveCurrentComp } from "@/lib/currentCompStore";

/** Current pay (#109): entered by the person, editable, deletable. Only their own board reads it. */
export const GET = authed(async (_req, { user }) => json({ amount: await loadCurrentComp(user.id) }));

const Put = z.object({ amount: z.number().int().min(CURRENT_COMP_MIN).max(CURRENT_COMP_MAX) });

export const PUT = authed(async (req, { user }) => {
  const { amount } = await body(req, Put);
  await saveCurrentComp(user.id, amount);
  return json({ amount });
});

export const DELETE = authed(async (_req, { user }) => {
  await saveCurrentComp(user.id, null);
  return json({ amount: null });
});
