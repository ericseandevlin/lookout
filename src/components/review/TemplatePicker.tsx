"use client";

import { useState } from "react";
import { ACCENTS, readable, styleFor, TEMPLATE_STYLE, TEMPLATES, type Template } from "@/lib/application/resumeLayout";
import { color, font } from "@/lib/tokens";

/** Classic, Modern or Cool, saved for the person; the .docx Lookout uploads uses the same one (#129). Cool takes a highlight color (#137). */
export function TemplatePicker({ value, accent, onPick, onAccent }: { value: Template; accent?: string | null; onPick: (t: Template) => void; onAccent: (hex: string) => void }) {
  const cur = styleFor(value, accent).accent;
  const [custom, setCustom] = useState<string | null>(null);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div role="radiogroup" aria-label="Resume design" style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ fontSize: font.base, color: color.t2, marginRight: 4 }}>Design</span>
        {TEMPLATES.map((t) => (
          <button key={t} role="radio" aria-checked={value === t} onClick={() => onPick(t)} style={{ height: 32, padding: "0 12px", borderRadius: 999, border: `1.5px solid ${value === t ? color.ink : color.border}`, background: value === t ? color.ink : "#fff", color: value === t ? "#fff" : color.ink, fontSize: font.base, fontWeight: 600, cursor: "pointer" }}>
            {TEMPLATE_STYLE[t].label}
          </button>
        ))}
      </div>
      {value === "cool" && (
        <div role="radiogroup" aria-label="Highlight color" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontSize: font.base, color: color.t2, marginRight: 4 }}>Highlight</span>
          {ACCENTS.map(([name, hex]) => (
            <button key={hex} role="radio" aria-checked={cur === hex} aria-label={name} title={name} onClick={() => onAccent(hex)} style={{ width: 26, height: 26, borderRadius: "50%", border: cur === hex ? "2px solid #1D1A0F" : "2px solid #fff", outline: `1px solid ${color.border}`, background: `#${hex}`, cursor: "pointer" }} />
          ))}
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: font.base, color: color.t2, cursor: "pointer" }}>
            <input
              type="color"
              aria-label="Custom highlight color"
              value={`#${cur}`}
              onChange={(e) => setCustom(e.target.value.slice(1).toUpperCase())}
              onBlur={() => custom && onAccent(custom)}
              style={{ width: 30, height: 26, border: 0, padding: 0, background: "none", cursor: "pointer" }}
            />
            Custom
          </label>
          {custom && readable(custom) !== custom && <span style={{ fontSize: font.base, color: color.t2 }}>Darkened a little so text stays readable.</span>}
        </div>
      )}
    </div>
  );
}
