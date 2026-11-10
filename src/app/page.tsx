import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { getAccessConfig } from "@/lib/config";
import { Landing } from "@/components/landing/Landing";
import { channelOf } from "@/lib/metrics";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Lookout · job search that reads the postings for you",
  description: "Answer five questions. Twice a week Lookout searches, reads every posting, and puts the roles that fit on your board, each with a score and a plain reason.",
  openGraph: { images: ["/landing/product.jpg"] },
};

/** The one-page site (#600). Signed-in people go straight to their board. A channel test's ?ref= (#527) rides along to /request-access. */
export default async function Home({ searchParams }: { searchParams: Promise<{ ref?: string; utm_source?: string }> }) {
  if (await getSessionUser()) redirect("/finds");
  const { signupMode } = await getAccessConfig();
  const { ref, utm_source } = await searchParams;
  return <Landing inviteOnly={signupMode === "invite"} channel={channelOf(ref ?? utm_source)} />;
}
