import Link from "next/link";
import { getSessionUser } from "@/lib/auth/session";
import { versionDate } from "@/lib/legal";
import { LegalLinks } from "./LegalLinks";

export const LEGAL_CONTACT = "privacy@lookout.ericdevlin.co";

/** The frame shared by the Privacy and Terms pages: a way back into the app, the article, and links to both. */
export async function LegalPage({ eyebrow, title, version, children }: { eyebrow: string; title: string; version: string; children: React.ReactNode }) {
  const signedIn = !!(await getSessionUser());
  return (
    <>
      {/* A way back into the app, so the page isn't a dead end (#251). */}
      <header style={{ background: "#1D1A0F", color: "#fff" }}>
        <nav aria-label="Lookout" style={{ maxWidth: 680, margin: "0 auto", padding: "16px", display: "flex", alignItems: "center", gap: 16 }}>
          <Link href="/" className="wordmark" style={{ color: "#fff", textDecoration: "none", flex: 1 }}>Lookout</Link>
          <Link href="/" style={{ color: "#D8D2C8", fontSize: 14, textDecoration: "none" }}>&larr; Back to Lookout</Link>
          <Link href={signedIn ? "/finds" : "/"} style={{ color: "#1D1A0F", background: "#fff", borderRadius: 8, padding: "7px 14px", fontSize: 14, fontWeight: 700, textDecoration: "none" }}>
            {signedIn ? "Board" : "Sign in"}
          </Link>
        </nav>
      </header>
      <main style={{ minHeight: "100vh", background: "#EFEEEC", padding: "32px 16px" }}>
        <article style={{ maxWidth: 680, margin: "0 auto", background: "#fff", borderRadius: 16, overflow: "hidden", boxShadow: "0 24px 60px rgba(29,26,15,.08)" }}>
          <div style={{ padding: "28px 26px 34px", fontSize: 15, lineHeight: 1.6, color: "#3B362C" }}>
            <div style={{ fontSize: 14, fontWeight: 700, letterSpacing: ".14em", textTransform: "uppercase", color: "#99220F" }}>{eyebrow}</div>
            <h1 style={{ margin: "8px 0 4px", fontSize: 30, fontWeight: 700, letterSpacing: "-0.02em", color: "#1D1A0F" }}>{title}</h1>
            <p style={{ color: "#6B6358", fontSize: 14, margin: 0 }}>Last updated {versionDate(version)}</p>
            {children}
          </div>
        </article>
        <LegalLinks style={{ maxWidth: 680, margin: "16px auto 0", justifyContent: "center" }} />
      </main>
    </>
  );
}

export const H = ({ children }: { children: React.ReactNode }) => (
  <h2 style={{ margin: "26px 0 6px", fontSize: 18, fontWeight: 700, color: "#1D1A0F" }}>{children}</h2>
);
