"use client";

import { useState } from "react";
import { btn } from "../Settings";
import { card, muted, type Detail } from "./shared";
import { color, font } from "@/lib/tokens";

export function SendForMe({ d, busy, onFill }: { d: Detail; busy: boolean; onFill: (mode: "test" | "submit") => void }) {
  const f = d.report.fill;
  const [stamp] = useState(() => Date.now());
  return (
    <section aria-labelledby="sfm" style={{ ...card, borderColor: color.ink, display: "flex", flexDirection: "column", gap: 12 }}>
      <h2 id="sfm" style={{ margin: 0, fontSize: font.xl, fontWeight: 700 }}>Send it for you</h2>
      <p style={{ ...muted, margin: 0 }}>Lookout fills the real form with the versions you approved. Test fill stops before Submit, so you can check the screenshot first.</p>
      {d.status === "approved" && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button onClick={() => onFill("test")} disabled={busy} style={btn("outline")}>
            {busy ? "Working…" : "Test fill (doesn't submit)"}
          </button>
          <button onClick={() => onFill("submit")} disabled={busy} style={btn("solid")}>
            Submit for me
          </button>
        </div>
      )}
      {d.status === "submitting" && <div style={muted}>Sending now…</div>}
      {f && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ fontSize: font.md, fontWeight: 600 }}>
            Last {f.mode === "test" ? "test fill" : "send"}: {new Date(f.at).toLocaleString()}
          </div>
          {f.stopped && <div role="alert" style={{ fontSize: font.base, color: color.brick }}>{f.stopped}</div>}
          {f.confirmation && <div style={{ fontSize: font.base, color: color.greenText }}>Confirmation: {f.confirmation}</div>}
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: font.base, color: "#3B362C" }}>
            {f.log.map((l) => (
              <li key={l.prompt}>
                {l.ok ? "✓" : "✗"} {l.prompt} <span style={{ color: color.t2 }}>({l.how})</span>
              </li>
            ))}
          </ul>
          <a href={`/api/apply/${d.id}/screenshot?which=${f.mode === "submit" ? "after-submit" : "filled"}&t=${stamp}`} target="_blank" rel="noreferrer" style={{ fontSize: font.base, color: color.ink }}>
            See the screenshot ↗
          </a>
        </div>
      )}
    </section>
  );
}
