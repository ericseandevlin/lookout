import { authed, HttpError, json } from "@/lib/api";
import { canUseAutoApply } from "@/lib/apply";
import {
  createExtensionToken,
  extensionStatus,
  revokeExtensionToken,
} from "@/lib/extension";

/** The Firefox extension's token, managed from Auto-apply settings (#169). */
export const GET = authed(async (_req, { user }) => {
  if (!canUseAutoApply(user)) throw new HttpError(404, "Not found");
  return json(await extensionStatus(user.id));
});

/** Make a new token (replaces the old one). The plain token is returned once and never stored. */
export const POST = authed(async (_req, { user }) => {
  if (!canUseAutoApply(user)) throw new HttpError(404, "Not found");
  return json({ token: await createExtensionToken(user.id) });
});

export const DELETE = authed(async (_req, { user }) => {
  if (!canUseAutoApply(user)) throw new HttpError(404, "Not found");
  await revokeExtensionToken(user.id);
  return json({ ok: true });
});
