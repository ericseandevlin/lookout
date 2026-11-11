"use client";

import { useRef } from "react";
import { useFocusTrap } from "../useFocusTrap";
import { color } from "@/lib/tokens";

/** A small dialog for the review page (#738): dark header, close button, Escape or a click outside closes it. */
export function Modal({ title, kicker, close, children }: { title: string; kicker?: string; close: () => void; children: React.ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  useFocusTrap(box);
  return (
    <>
      <div onClick={close} style={{ position: "fixed", inset: 0, background: "rgba(29,26,15,.45)", zIndex: 30 }} />
      <div
        ref={box}
        role="dialog"
        aria-modal="true"
        aria-labelledby="rv-modal-title"
        onKeyDown={(e) => e.key === "Escape" && close()}
        style={{ position: "fixed", top: "50%", left: "50%", transform: "translate(-50%,-50%)", width: 560, maxWidth: "calc(100vw - 32px)", maxHeight: "calc(100vh - 64px)", display: "flex", flexDirection: "column", background: "#EFEEEC", borderRadius: 16, overflow: "hidden", zIndex: 31, boxShadow: "0 24px 60px rgba(29,26,15,.3)" }}
      >
        <div style={{ background: color.ink, color: "#fff", padding: "18px 22px", display: "flex", alignItems: "flex-start", gap: 12 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            {kicker && <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: ".14em", textTransform: "uppercase", color: color.orange }}>{kicker}</div>}
            <div id="rv-modal-title" style={{ fontSize: 19, fontWeight: 700, marginTop: kicker ? 4 : 0 }}>{title}</div>
          </div>
          <button onClick={close} aria-label="Close" style={{ border: 0, background: "rgba(255,255,255,.1)", color: "#fff", width: 30, height: 30, borderRadius: "50%", cursor: "pointer", fontSize: 16, lineHeight: 1, flex: "none" }}>×</button>
        </div>
        <div style={{ padding: "18px 22px", overflowY: "auto", fontSize: 14, lineHeight: 1.5 }}>{children}</div>
      </div>
    </>
  );
}
