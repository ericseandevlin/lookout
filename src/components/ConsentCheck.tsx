"use client";

import { TERMS_VERSION } from "@/lib/legal";

const link: React.CSSProperties = { color: "#99220F" };

/** The clickwrap box (#21). Names only the documents that exist: Terms join once #20 ships. */
export function ConsentCheck({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label style={{ display: "flex", alignItems: "flex-start", gap: 10, fontSize: 14.5, lineHeight: 1.5, color: "#3B362C", cursor: "pointer" }}>
      <input type="checkbox" required checked={checked} onChange={(e) => onChange(e.target.checked)} style={{ width: 18, height: 18, marginTop: 2, accentColor: "#99220F", flexShrink: 0 }} />
      <span>
        I agree to the{" "}
        {TERMS_VERSION !== null && (
          <>
            <a href="/terms" target="_blank" rel="noopener" style={link}>Terms</a> and{" "}
          </>
        )}
        <a href="/privacy" target="_blank" rel="noopener" style={link}>Privacy Policy</a>
      </span>
    </label>
  );
}
