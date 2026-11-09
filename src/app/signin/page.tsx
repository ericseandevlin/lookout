import { redirect } from "next/navigation";
import { featureOn } from "@/lib/features";
import { getSessionUser } from "@/lib/auth/session";
import { Login } from "@/components/Login";
import { env } from "@/lib/env";
import { getAccessConfig } from "@/lib/config";
import { channelOf } from "@/lib/metrics";
import { turnstileSiteKey } from "@/lib/turnstile";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sign in · Lookout" };

/** /signin (#517): the sign-in screen at its own address. Sign-out lands here with ?out=1; ?ref= tags a channel test (#527). */
export default async function SignInPage({ searchParams }: { searchParams: Promise<{ out?: string; ref?: string; utm_source?: string }> }) {
  if (await getSessionUser()) redirect("/finds");
  const { signupMode } = await getAccessConfig();
  const { out, ref, utm_source } = await searchParams;
  return (
    <main>
      <Login emailEnabled={!!env.smtpUrl || env.logEmails} inviteOnly={signupMode === "invite"} turnstileSiteKey={turnstileSiteKey()} kinds={featureOn("SEARCHES")} signedOut={out === "1"} channel={channelOf(ref ?? utm_source)} />
    </main>
  );
}
