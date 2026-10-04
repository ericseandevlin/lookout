import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { Login } from "@/components/Login";
import { env } from "@/lib/env";
import { getAccessConfig } from "@/lib/config";

export const dynamic = "force-dynamic";

export default async function Home() {
  if (await getSessionUser()) redirect("/finds");
  const { signupMode } = await getAccessConfig();
  return <Login emailEnabled={!!env.smtpUrl || env.logEmails} inviteOnly={signupMode === "invite"} />;
}
