import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { Login } from "@/components/Login";
import { env } from "@/lib/env";
import { getAccessConfig } from "@/lib/config";
import { turnstileSiteKey } from "@/lib/turnstile";

export const dynamic = "force-dynamic";

export default async function Home() {
  if (await getSessionUser()) redirect("/finds");
  const { signupMode } = await getAccessConfig();
  // A main landmark, so screen readers can jump to the content (#214).
  return (
    <main>
      <Login emailEnabled={!!env.smtpUrl || env.logEmails} inviteOnly={signupMode === "invite"} turnstileSiteKey={turnstileSiteKey()} />
    </main>
  );
}
