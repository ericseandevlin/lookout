import { featureOn } from "@/lib/features";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { Login } from "@/components/Login";
import { env } from "@/lib/env";
import { getAccessConfig } from "@/lib/config";
import { channelOf } from "@/lib/metrics";
import { turnstileSiteKey } from "@/lib/turnstile";

export const dynamic = "force-dynamic";

/** A channel test's link (#527) lands here as /?ref=<channel>; the waitlist form sends it along. */
export default async function Home({ searchParams }: { searchParams: Promise<{ ref?: string; utm_source?: string }> }) {
  if (await getSessionUser()) redirect("/finds");
  const { signupMode } = await getAccessConfig();
  const { ref, utm_source } = await searchParams;
  // A main landmark, so screen readers can jump to the content (#214).
  return (
    <main>
      <Login emailEnabled={!!env.smtpUrl || env.logEmails} inviteOnly={signupMode === "invite"} turnstileSiteKey={turnstileSiteKey()} kinds={featureOn("SEARCHES")} channel={channelOf(ref ?? utm_source)} />
    </main>
  );
}
