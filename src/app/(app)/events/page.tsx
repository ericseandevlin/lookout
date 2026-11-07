import { notFound } from "next/navigation";
import { Events } from "@/components/Events";
import { featureOn } from "@/lib/features";

export const metadata = { title: "Events · Lookout" };

export default function Page() {
  if (!featureOn("EVENTS")) notFound();
  return <Events />;
}
