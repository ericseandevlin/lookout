import { notFound } from "next/navigation";
import { ApplicationReview } from "@/components/ApplicationReview";
import { canUseAutoApply } from "@/lib/apply";
import { getSessionUser } from "@/lib/auth/session";

export const metadata = { title: "Review application · Lookout" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user || !canUseAutoApply(user)) notFound();
  return <ApplicationReview id={(await params).id} />;
}
