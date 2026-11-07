import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { getSessionUser } from "@/lib/auth/session";
import { db, schema } from "@/lib/db";
import { kindOf } from "@/lib/kinds";
import { Welcome } from "@/components/Welcome";

export const dynamic = "force-dynamic";
export const metadata = { title: "Welcome · Lookout" };

export default async function WelcomePage() {
  const user = await getSessionUser();
  if (!user) redirect("/");
  if (user.onboardedAt) redirect("/finds");
  // The kind they picked at request-access (#8) decides what the welcome step asks.
  const [profile] = await db.select({ kind: schema.profiles.kind }).from(schema.profiles).where(eq(schema.profiles.userId, user.id));
  const cfg = kindOf(profile?.kind);
  return (
    <main>
      <Welcome initialName={user.name} kind={cfg.id} />
    </main>
  );
}
