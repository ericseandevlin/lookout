import { notFound } from "next/navigation";
import { pageTitle } from "@/lib/brand";
import { getAccessConfig } from "@/lib/config";
import { featureOn } from "@/lib/features";
import { channelOf } from "@/lib/metrics";
import { KindsPage } from "@/components/landing/KindsPage";

export const dynamic = "force-dynamic";
export const metadata = {
  title: pageTitle("What it finds"),
  description: "Jobs first, then contract opportunities, events, grants, speaking slots and rentals: anything you'd search for twice.",
  openGraph: { images: ["/landing/product.jpg"] },
};

/** /what-it-finds (#9). 404 unless FEATURE_WAITLIST=on. Public to everyone, signed in or not. */
export default async function Page({ searchParams }: { searchParams: Promise<{ ref?: string; utm_source?: string }> }) {
  if (!featureOn("WAITLIST")) notFound();
  const { ref, utm_source } = await searchParams;
  const { signupMode } = await getAccessConfig();
  return <KindsPage inviteOnly={signupMode === "invite"} channel={channelOf(ref ?? utm_source)} />;
}
