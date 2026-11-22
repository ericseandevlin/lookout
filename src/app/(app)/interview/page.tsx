import { notFound } from "next/navigation";
import { Interview } from "@/components/Interview";
import { featureOn } from "@/lib/features";

export const metadata = { title: "Interview · Lookout" };

/** The interview (#1449), behind FEATURE_INTERVIEW. */
export default async function Page({ searchParams }: { searchParams: Promise<{ app?: string }> }) {
  if (!featureOn("INTERVIEW")) notFound();
  const { app } = await searchParams;
  return <Interview app={app && /^[0-9a-f-]{36}$/i.test(app) ? app : undefined} />;
}
