import Link from "next/link";
import { getSessionUser } from "@/lib/auth/session";
import { blocked, getGroupInvite } from "@/lib/groupInvite";
import { env } from "@/lib/env";
import { JoinForm } from "./JoinForm";
import { color } from "@/lib/tokens";

export const dynamic = "force-dynamic";
export const metadata = { title: "You're invited · Lookout", robots: { index: false, follow: false } };

/** /join/<code> (#601): a group invite link. Anyone with the link makes an account until it expires or fills up. */
export default async function JoinPage({ params }: { params: Promise<{ code: string }> }) {
  // A signed-in person sees the page too, so the person who shares the link can check it (#999).
  const signedIn = !!(await getSessionUser());
  const { code } = await params;
  const g = await getGroupInvite(code.toLowerCase());
  const why = blocked(g, null);
  return (
    <main>
      {signedIn && (
        <p style={{ margin: 0, padding: "10px 16px", textAlign: "center", fontSize: 14, color: color.t2, borderBottom: `1px solid ${color.border}` }}>
          You are signed in. This is the page your group sees. <Link href="/finds" style={{ color: color.brick, fontWeight: 600 }}>Go to your board</Link>
        </p>
      )}
      <JoinForm code={code.toLowerCase()} label={g?.label ?? ""} closed={why} emailEnabled={!!env.smtpUrl || env.logEmails} />
    </main>
  );
}
