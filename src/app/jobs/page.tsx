import { notFound } from "next/navigation";
import { pageTitle } from "@/lib/brand";
import { getAccessConfig } from "@/lib/config";
import { featureOn } from "@/lib/features";
import { channelOf } from "@/lib/metrics";
import { JobsPage } from "@/components/landing/JobsPage";

export const dynamic = "force-dynamic";
export const metadata = {
  title: pageTitle("Jobs"),
  description: "It reads every posting, scores it against what you want next, and puts the roles that fit on your board.",
  openGraph: { images: ["/landing/product.jpg"] },
};

/** /jobs (#9). 404 unless FEATURE_WAITLIST=on. Public to everyone, signed in or not. */
export default async function Page({ searchParams }: { searchParams: Promise<{ ref?: string; utm_source?: string }> }) {
  if (!featureOn("WAITLIST")) notFound();
  const { ref, utm_source } = await searchParams;
  const { signupMode } = await getAccessConfig();
  return <JobsPage inviteOnly={signupMode === "invite"} channel={channelOf(ref ?? utm_source)} />;
}
