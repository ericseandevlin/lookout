import { notFound } from "next/navigation";
import { demoUser } from "@/lib/demo";
import { featureOn } from "@/lib/features";
import { getState } from "@/lib/state";
import { Finds } from "@/components/Finds";
import { StoreProvider } from "@/components/store";

import { font } from "@/lib/tokens";
export const dynamic = "force-dynamic";
export const metadata = { title: "Demo · Lookout", robots: { index: false, follow: false } };

/**
 * Public demo (#1317): the made-up Maya Ortiz board, read only, no sign-in. 404 unless FEATURE_DEMO=on.
 * No session is made, so every API stays closed to the visitor; the store refuses changes before they're sent.
 */
export default async function Page() {
  if (!featureOn("DEMO")) notFound();
  const person = await demoUser();
  if (!person) notFound();
  const state = await getState(person);
  const viewState = { ...state, user: { ...state.user, isAdmin: false, autoApply: false, events: false, searches: false }, running: null, run: null };
  return (
    <StoreProvider initial={viewState} readOnly>
      <div role="status" style={{ position: "sticky", top: 0, zIndex: 19, display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12, padding: "10px 20px", background: "#1D1A0F", color: "#fff", fontSize: font.base }}>
        <span style={{ padding: "2px 8px", borderRadius: 6, background: "#F8A865", color: "#1D1A0F", fontWeight: 700 }}>Demo</span>
        <span>
          Maya Ortiz is made up, and so are these companies. Open a find to see why it matched. Nothing you do here is saved.
        </span>
        <a href="https://github.com/ericseandevlin/lookout" style={{ marginLeft: "auto", color: "#F8A865", fontWeight: 600 }}>Code on GitHub</a>
      </div>
      {/* The detail pane sticks below the banner, not under it (#1331). */}
      <main style={{ "--pane-top": "60px" } as React.CSSProperties}>
        <Finds />
      </main>
    </StoreProvider>
  );
}
