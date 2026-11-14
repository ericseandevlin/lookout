import { color, font } from "@/lib/tokens";
const footLink: React.CSSProperties = { color: color.t2 };

/** "Terms · Privacy", for footers (#20). */
export function LegalLinks({ style }: { style?: React.CSSProperties }) {
  return (
    <nav aria-label="Legal" style={{ display: "flex", gap: 8, fontSize: font.base, color: color.t2, ...style }}>
      <a href="/terms" style={footLink}>Terms</a>
      <span aria-hidden>·</span>
      <a href="/privacy" style={footLink}>Privacy</a>
    </nav>
  );
}
