import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { Login } from "@/components/Login";
import { env } from "@/lib/env";
import { getAccessConfig } from "@/lib/config";
import { channelOf } from "@/lib/metrics";
import { turnstileSiteKey } from "@/lib/turnstile";

export const dynamic = "force-dynamic";
export const metadata = { title: "Request access · Lookout" };

/** /request-access (#600): the landing page's button lands here. Opens on the request form when sign-up is invite only. ?ref= tags a channel test (#527). */
export default async function RequestAccessPage({ searchParams }: { searchParams: Promise<{ ref?: string; utm_source?: string }> }) {
  if (await getSessionUser()) redirect("/finds");
  const { signupMode } = await getAccessConfig();
  const { ref, utm_source } = await searchParams;
  const inviteOnly = signupMode === "invite";
  return (
    <main>
      <Login start={inviteOnly ? "request" : "signin"} emailEnabled={!!env.smtpUrl || env.logEmails} inviteOnly={inviteOnly} turnstileSiteKey={turnstileSiteKey()} channel={channelOf(ref ?? utm_source)} />
    </main>
  );
}
