import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { blocked, getGroupInvite } from "@/lib/groupInvite";
import { env } from "@/lib/env";
import { JoinForm } from "./JoinForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "You're invited · Lookout", robots: { index: false, follow: false } };

/** /join/<code> (#601): a group invite link. Anyone with the link makes an account until it expires or fills up. */
export default async function JoinPage({ params }: { params: Promise<{ code: string }> }) {
  if (await getSessionUser()) redirect("/finds");
  const { code } = await params;
  const g = await getGroupInvite(code.toLowerCase());
  const why = blocked(g, null);
  return (
    <main>
      <JoinForm code={code.toLowerCase()} label={g?.label ?? ""} closed={why} emailEnabled={!!env.smtpUrl || env.logEmails} />
    </main>
  );
}
