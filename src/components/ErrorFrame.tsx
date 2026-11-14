import Link from "next/link";

import { font } from "@/lib/tokens";
/**
 * The frame for the 404 and error pages (#396): the wordmark, what happened, and a way back.
 * "/" sends a signed-in person on to their board.
 */
export function ErrorFrame({ eyebrow, title, children, action }: { eyebrow: string; title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <main style={{ minHeight: "100vh", background: "#EFEEEC", padding: "32px 16px", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ width: "100%", maxWidth: 460, background: "#fff", borderRadius: 16, padding: "28px 26px 30px", boxShadow: "0 24px 60px rgba(29,26,15,.08)", color: "#3B362C", fontSize: font.md, lineHeight: 1.6 }}>
        <div className="wordmark" style={{ color: "#1D1A0F", marginBottom: 22 }}>Lookout</div>
        <div style={{ fontSize: font.base, fontWeight: 700, letterSpacing: ".14em", textTransform: "uppercase", color: "#99220F" }}>{eyebrow}</div>
        <h1 style={{ margin: "8px 0 8px", fontSize: font["4xl"], fontWeight: 700, letterSpacing: "-0.02em", color: "#1D1A0F" }}>{title}</h1>
        {children}
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", marginTop: 22 }}>
          {action}
          <Link href="/" className="h-link" style={{ color: "#99220F", fontWeight: 600, fontSize: font.base, textDecoration: "none" }}>Back to Lookout</Link>
        </div>
      </div>
    </main>
  );
}

/** The digest Next puts on a server error. People can quote it; Admin > Errors searches by it. */
export function ErrorRef({ digest }: { digest?: string }) {
  if (!digest) return null;
  return <p style={{ margin: "12px 0 0", fontSize: font.sm, color: "#6B6358" }}>Reference: <code>{digest}</code></p>;
}

export const retryStyle: React.CSSProperties = { border: 0, borderRadius: 10, padding: "9px 16px", background: "#99220F", color: "#fff", font: "inherit", fontSize: font.base, fontWeight: 700, cursor: "pointer" };
