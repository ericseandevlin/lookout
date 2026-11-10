import { featureOn } from "@/lib/features";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { Login } from "@/components/Login";
import { env } from "@/lib/env";
import { getAccessConfig } from "@/lib/config";
import { channelOf } from "@/lib/metrics";
import { turnstileSiteKey } from "@/lib/turnstile";
import { Landing } from "@/components/landing/Landing";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Lookout · job search that reads the postings for you",
  description: "Answer five questions. Twice a week Lookout searches, reads every posting, and puts the roles that fit on your board, each with a score and a plain reason.",
  openGraph: { images: ["/landing/03-board.jpg"] },
};

/** A channel test's link (#527) lands here as /?ref=<channel>; the waitlist form sends it along. */
export default async function Home({ searchParams }: { searchParams: Promise<{ ref?: string; utm_source?: string }> }) {
  if (await getSessionUser()) redirect("/finds");
  const { signupMode } = await getAccessConfig();
  const { ref, utm_source } = await searchParams;
  // The one-page site (#600): what Lookout does, with sign-in and request access in the hero card.
  const inviteOnly = signupMode === "invite";
  return (
    <Landing
      card={<Login inline start={inviteOnly ? "request" : "signin"} emailEnabled={!!env.smtpUrl || env.logEmails} inviteOnly={inviteOnly} turnstileSiteKey={turnstileSiteKey()} kinds={featureOn("SEARCHES")} channel={channelOf(ref ?? utm_source)} />}
    />
  );
}
