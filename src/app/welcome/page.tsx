import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { Welcome } from "@/components/Welcome";

export const dynamic = "force-dynamic";
export const metadata = { title: "Welcome · Lookout" };

export default async function WelcomePage() {
  const user = await getSessionUser();
  if (!user) redirect("/");
  if (user.onboardedAt) redirect("/finds");
  return (
    <main>
      <Welcome initialName={user.name} />
    </main>
  );
}
