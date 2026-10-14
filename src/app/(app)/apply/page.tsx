import { notFound } from "next/navigation";
import { ApplyPage } from "@/components/Apply";
import { canUseAutoApply } from "@/lib/apply";
import { getSessionUser } from "@/lib/auth/session";

export const metadata = { title: "Apply · Lookout" };

export default async function Page() {
  const user = await getSessionUser();
  if (!user || !canUseAutoApply(user)) notFound();
  return <ApplyPage />;
}
