"use client";

import { useRef } from "react";
import { createPortal } from "react-dom";
import { useFocusTrap } from "../useFocusTrap";
import { color, font } from "@/lib/tokens";

/**
 * A small dialog for the review page (#738): dark header, close button, Escape or a click outside closes it. A chat
 * dialog (#1485) is taller and leaves the scrolling and the padding to its children.
 */
export function Modal({ title, kicker, close, children, chat }: { title: string; kicker?: string; close: () => void; children: React.ReactNode; chat?: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  useFocusTrap(box);
  // On document.body: a page with a CSS transform (the fade-in) would otherwise move a fixed dialog off screen.
  return createPortal(
    <>
      <div onClick={close} style={{ position: "fixed", inset: 0, background: "rgba(29,26,15,.45)", zIndex: 30 }} />
      <div
        ref={box}
        role="dialog"
        aria-modal="true"
        aria-labelledby="rv-modal-title"
        onKeyDown={(e) => e.key === "Escape" && close()}
        style={{ position: "fixed", top: "50%", left: "50%", transform: "translate(-50%,-50%)", width: chat ? 640 : 560, maxWidth: "calc(100vw - 32px)", maxHeight: "calc(100vh - 64px)", ...(chat && { height: 720 }), display: "flex", flexDirection: "column", background: "#EFEEEC", borderRadius: 16, overflow: "hidden", zIndex: 31, boxShadow: "0 24px 60px rgba(29,26,15,.3)" }}
      >
        <div style={{ background: color.ink, color: "#fff", padding: "18px 22px", display: "flex", alignItems: "flex-start", gap: 12 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            {kicker && <div style={{ fontSize: font.sm, fontWeight: 700, letterSpacing: ".14em", textTransform: "uppercase", color: color.orange }}>{kicker}</div>}
            <div id="rv-modal-title" style={{ fontSize: font["2xl"], fontWeight: 700, marginTop: kicker ? 4 : 0 }}>{title}</div>
          </div>
          <button onClick={close} aria-label="Close" style={{ border: 0, background: "rgba(255,255,255,.1)", color: "#fff", width: chat ? 44 : 30, height: chat ? 44 : 30, borderRadius: "50%", cursor: "pointer", fontSize: font.lg, lineHeight: 1, flex: "none" }}>×</button>
        </div>
        {chat ? <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", background: "#fff" }}>{children}</div> : <div style={{ padding: "18px 22px", overflowY: "auto", fontSize: font.base, lineHeight: 1.5 }}>{children}</div>}
      </div>
    </>,
    document.body,
  );
}
