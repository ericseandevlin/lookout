const footLink: React.CSSProperties = { color: "#6B6358" };

/** "Terms · Privacy", for footers (#20). */
export function LegalLinks({ style }: { style?: React.CSSProperties }) {
  return (
    <nav aria-label="Legal" style={{ display: "flex", gap: 8, fontSize: 14, color: "#6B6358", ...style }}>
      <a href="/terms" style={footLink}>Terms</a>
      <span aria-hidden>·</span>
      <a href="/privacy" style={footLink}>Privacy</a>
    </nav>
  );
}
