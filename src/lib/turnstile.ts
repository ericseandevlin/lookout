import "server-only";

/**
 * Cloudflare Turnstile on the request-access form (#13). Off until both keys are set, so dev and
 * self-hosted installs work without a Cloudflare account. The site key is public; the secret stays here.
 */
export function turnstileSiteKey() {
  return process.env.TURNSTILE_SITE_KEY && process.env.TURNSTILE_SECRET_KEY ? process.env.TURNSTILE_SITE_KEY : "";
}

const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/**
 * Ask Cloudflare whether the widget's token is good. Tokens are single use and last five minutes.
 * Fails closed: no token, a bad token, or Cloudflare not answering all count as a failed check.
 */
export async function verifyTurnstile(token: string | undefined, ip: string, fetchFn: typeof fetch = fetch): Promise<boolean> {
  if (!token) return false;
  const form = new URLSearchParams({ secret: process.env.TURNSTILE_SECRET_KEY || "", response: token });
  if (ip && ip !== "unknown") form.set("remoteip", ip);
  try {
    const res = await fetchFn(VERIFY_URL, { method: "POST", body: form, signal: AbortSignal.timeout(8000) });
    if (!res.ok) return false;
    const data = (await res.json()) as { success?: boolean };
    return data.success === true;
  } catch {
    return false;
  }
}
