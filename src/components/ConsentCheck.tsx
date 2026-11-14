"use client";

import { color, font } from "@/lib/tokens";

const link: React.CSSProperties = { color: color.brick };

/** The clickwrap box (#21): Terms (#20) and Privacy. */
export function ConsentCheck({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label style={{ display: "flex", alignItems: "flex-start", gap: 10, fontSize: font.base, lineHeight: 1.5, color: "#3B362C", cursor: "pointer" }}>
      <input type="checkbox" required checked={checked} onChange={(e) => onChange(e.target.checked)} style={{ width: 18, height: 18, marginTop: 2, accentColor: color.brick, flexShrink: 0 }} />
      <span>
        I agree to the <a href="/terms" target="_blank" rel="noopener" style={link}>Terms</a> and{" "}
        <a href="/privacy" target="_blank" rel="noopener" style={link}>Privacy Policy</a>
      </span>
    </label>
  );
}
