import { notFound } from "next/navigation";
import { Knows } from "@/components/Knows";
import { featureOn } from "@/lib/features";

export const metadata = { title: "What Lookout knows · Lookout" };

/** What Lookout knows (#1449), behind FEATURE_INTERVIEW. */
export default function Page() {
  if (!featureOn("INTERVIEW")) notFound();
  return <Knows />;
}
