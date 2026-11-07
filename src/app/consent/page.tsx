import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { needsConsent } from "@/lib/legal";
import { Consent } from "@/components/Consent";

export const dynamic = "force-dynamic";
export const metadata = { title: "Terms · Lookout" };

export default async function ConsentPage() {
  const user = await getSessionUser();
  if (!user) redirect("/");
  // New accounts agree on the welcome step; this page is for everyone else (#21).
  if (!user.onboardedAt) redirect("/welcome");
  if (!needsConsent(user)) redirect("/finds");
  return (
    <main>
      <Consent updated={!!user.acceptedAt} />
    </main>
  );
}
