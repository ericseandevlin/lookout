"use client";

import { useEffect, useRef } from "react";
import { useFocusTrap } from "../useFocusTrap";
import { chip, seg, SORTS, type SortKey } from "./shared";

export function FilterSheet(p: {
  close: () => void;
  fit: number; setFit: (n: number) => void; fitCount: (n: number) => number;
  compOnly: boolean; setCompOnly: (v: boolean) => void;
  sortKey: SortKey; setSortKey: (k: SortKey) => void;
  sortDir: "asc" | "desc"; setSortDir: (d: "asc" | "desc") => void;
  shown: number;
}) {
  const box = useRef<HTMLDivElement>(null);
  useFocusTrap(box);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && p.close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [p]);
  return (
    <>
      <div onClick={p.close} style={{ position: "fixed", inset: 0, background: "rgba(29,26,15,.32)", zIndex: 30 }} />
      <div ref={box} role="dialog" aria-modal="true" aria-label="Filter and sort" style={{ position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 31, background: "#fff", borderRadius: "20px 20px 0 0", boxShadow: "0 -12px 40px rgba(29,26,15,.18)", padding: "10px 16px calc(16px + env(safe-area-inset-bottom))", display: "flex", flexDirection: "column", gap: 20, maxHeight: "85vh", overflowY: "auto" }}>
        <div style={{ width: 36, height: 4, borderRadius: 999, background: "#E0D9CF", alignSelf: "center" }} />
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ fontSize: 18, fontWeight: 700 }}>Filter &amp; sort</div>
          <button onClick={() => { p.setFit(0); p.setCompOnly(false); p.setSortKey("score"); p.setSortDir("desc"); }} style={{ border: 0, background: "transparent", padding: "8px 0 8px 12px", fontSize: 14, fontWeight: 600, color: "#99220F", cursor: "pointer" }}>Reset</button>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <SheetLabel>Match</SheetLabel>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,minmax(0,1fr))", gap: 8 }}>
            {([["Any", 0], ["5", 5], ["4+", 4], ["3+", 3]] as const).map(([label, k]) => {
              const c = chip(p.fit === k);
              return (
                <button key={k} onClick={() => p.setFit(k)} style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 1, height: 52, borderRadius: 12, border: `1.5px solid ${c.border}`, background: c.bg, color: c.ink, cursor: "pointer" }}>
                  <span style={{ fontSize: 14, fontWeight: 600 }}>{label}</span>
                  <span style={{ fontSize: 14, opacity: 0.7 }}>{p.fitCount(k)}</span>
                </button>
              );
            })}
          </div>
        </div>
        <button onClick={() => p.setCompOnly(!p.compOnly)} role="switch" aria-checked={p.compOnly} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, minHeight: 48, padding: 0, border: 0, background: "transparent", cursor: "pointer", textAlign: "left" }}>
          <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <span style={{ fontSize: 14.5, fontWeight: 600, color: "#1D1A0F" }}>Only roles with comp posted</span>
            <span style={{ fontSize: 14, color: "#6B6358" }}>Hides listings with no pay range</span>
          </span>
          <span style={{ width: 44, height: 26, borderRadius: 999, background: p.compOnly ? "#99220F" : "#D8D0C4", display: "flex", justifyContent: p.compOnly ? "flex-end" : "flex-start", padding: 3, flex: "none" }}>
            <span style={{ width: 20, height: 20, borderRadius: "50%", background: "#fff", boxShadow: "0 1px 3px rgba(29,26,15,.25)" }} />
          </span>
        </button>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <SheetLabel>Sort by</SheetLabel>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {SORTS.map(([k, label]) => {
              const c = chip(k === p.sortKey);
              return (
                <button key={k} onClick={() => p.setSortKey(k)} style={{ height: 38, padding: "0 15px", borderRadius: 999, border: `1.5px solid ${c.border}`, background: c.bg, color: c.ink, fontSize: 14, fontWeight: 600, cursor: "pointer" }}>{label}</button>
              );
            })}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 4, padding: 4, background: "#F4F1EC", borderRadius: 12 }}>
            {([["desc", "↓ Descending"], ["asc", "↑ Ascending"]] as const).map(([d, label]) => {
              const s = seg(p.sortDir === d);
              return (
                <button key={d} onClick={() => p.setSortDir(d)} style={{ height: 38, border: 0, borderRadius: 9, background: s.bg, color: s.ink, boxShadow: s.shadow, fontSize: 14, fontWeight: 600, cursor: "pointer" }}>{label}</button>
              );
            })}
          </div>
        </div>
        <button onClick={p.close} style={{ height: 48, borderRadius: 12, border: 0, background: "#99220F", color: "#fff", fontSize: 15, fontWeight: 600, cursor: "pointer" }}>Show {p.shown} roles</button>
      </div>
    </>
  );
}

const SheetLabel = ({ children }: { children: React.ReactNode }) => (
  <div style={{ fontSize: 14, fontWeight: 700, letterSpacing: ".1em", textTransform: "uppercase", color: "#1D1A0F" }}>{children}</div>
);
