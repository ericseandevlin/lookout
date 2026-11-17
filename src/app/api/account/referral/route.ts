import { authed, json } from "@/lib/api";
import { referralLink } from "@/lib/referral";

/** Settings > Invite a friend (#527): the person's own referral link. */
export const GET = authed(async (_req, { user }) => json({ link: await referralLink(user.id) }));
