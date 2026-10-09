import { z } from "zod";
import { adminRoute, body, json } from "@/lib/api";
import { createInvite } from "@/lib/invite";
import { normalizeEmail } from "@/lib/users";

const Input = z.object({ email: z.string().trim().email().max(254), send: z.boolean().optional() });

/** Invite someone directly. Returns a link to share; emails it too when SMTP is set and `send` is true. */
export const POST = adminRoute(async (req, { user }) => {
  const p = await body(req, Input);
  return json(await createInvite(normalizeEmail(p.email), user, !!p.send));
});
