import { z } from "zod";
import { adminRoute, body, HttpError, json } from "@/lib/api";
import { createInvite, inviteMany, MAX_BULK } from "@/lib/invite";
import { normalizeEmail } from "@/lib/users";

const Email = z.string().trim().email().max(254);
const Input = z.union([
  z.object({ email: Email, send: z.boolean().optional() }),
  z.object({ emails: z.array(Email).min(1), send: z.boolean().optional() }),
]);

/**
 * Invite someone directly, or several at once with `emails` (#993). Returns a link per person to share;
 * emails them too when SMTP is set and `send` is true.
 */
export const POST = adminRoute(async (req, { user }) => {
  const p = await body(req, Input);
  if ("email" in p) return json(await createInvite(normalizeEmail(p.email), user, !!p.send));
  const emails = [...new Set(p.emails.map(normalizeEmail))];
  if (emails.length > MAX_BULK) throw new HttpError(400, `Up to ${MAX_BULK} people at a time.`);
  return json({ results: await inviteMany(emails, user, !!p.send) });
});
