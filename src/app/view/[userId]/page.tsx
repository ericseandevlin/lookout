import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { getSessionUser } from "@/lib/auth/session";
import { isAdmin } from "@/lib/users";
import { getState } from "@/lib/state";
import { Finds } from "@/components/Finds";
import { StoreProvider } from "@/components/store";

import { font } from "@/lib/tokens";
export const dynamic = "force-dynamic";
export const metadata = { title: "View board · Lookout" };

/** Admins only: someone's board exactly as they see it, read only. Nothing on this page can write. */
export default async function Page({ params }: { params: Promise<{ userId: string }> }) {
  const viewer = await getSessionUser();
  if (!viewer || !isAdmin(viewer)) notFound();
  const { userId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(userId)) notFound();
  const [person] = await db.select().from(schema.users).where(eq(schema.users.id, userId));
  if (!person) notFound();
  const state = await getState(person);
  // Strip anything that would make the client poll or offer actions on the viewer's own account.
  const viewState = { ...state, user: { ...state.user, isAdmin: false, autoApply: false, events: false, searches: false }, running: null, run: null };
  console.info(`admin view: ${viewer.id} viewed board of ${person.id}`);
  const who = person.name || person.email;
  return (
    <StoreProvider initial={viewState} readOnly>
      <div role="status" style={{ position: "sticky", top: 0, zIndex: 19, display: "flex", alignItems: "center", gap: 12, padding: "10px 20px", background: "#1D1A0F", color: "#fff", fontSize: font.base }}>
        <span style={{ padding: "2px 8px", borderRadius: 6, background: "#F8A865", color: "#1D1A0F", fontWeight: 700 }}>View only</span>
        <span>
          You&apos;re looking at <b>{who}</b>&apos;s board as they see it. Nothing you do here changes it.
        </span>
        <Link href="/admin" style={{ marginLeft: "auto", color: "#F8A865", fontWeight: 600 }}>Exit</Link>
      </div>
      <main>
        <Finds />
      </main>
    </StoreProvider>
  );
}
