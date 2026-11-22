import { notFound } from "next/navigation";
import { Interview } from "@/components/Interview";
import { featureOn } from "@/lib/features";

export const metadata = { title: "Interview · Lookout" };

/** The interview (#1449), behind FEATURE_INTERVIEW. */
export default function Page() {
  if (!featureOn("INTERVIEW")) notFound();
  return <Interview />;
}
