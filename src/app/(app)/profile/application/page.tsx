import { notFound } from "next/navigation";
import { SavedAnswers } from "@/components/SavedAnswers";
import { canUseAutoApply } from "@/lib/apply";
import { getSessionUser } from "@/lib/auth/session";

export const metadata = { title: "Application answers · Lookout" };

export default async function Page() {
  const user = await getSessionUser();
  if (!user || !canUseAutoApply(user)) notFound();
  return <SavedAnswers />;
}
