"use client";

import { useId, useState } from "react";

/** An (i) icon with an explanation: shows on hover, keyboard focus or tap; Escape closes it. */
export function InfoTip({ label, text }: { label: string; text: string }) {
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const id = useId();
  const show = open || pinned;
  return (
    <span style={{ position: "relative", display: "inline-flex" }} onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button
        type="button"
        aria-label={label}
        aria-describedby={show ? id : undefined}
        aria-expanded={show}
        onClick={() => setPinned((x) => !x)}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          setOpen(false);
          setPinned(false);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            setOpen(false);
            setPinned(false);
          }
        }}
        style={{ width: 22, height: 22, borderRadius: "50%", border: "1.5px solid #6B6358", background: "#fff", color: "#3B362C", fontSize: 13, fontWeight: 700, fontStyle: "italic", fontFamily: "Georgia, serif", lineHeight: 1, cursor: "pointer", padding: 0 }}
      >
        i
      </button>
      {show && (
        <span role="tooltip" id={id} style={{ position: "absolute", top: "calc(100% + 8px)", left: -12, zIndex: 20, width: "min(340px, 80vw)", padding: "10px 12px", borderRadius: 10, background: "#1D1A0F", color: "#fff", fontSize: 14, lineHeight: 1.5, whiteSpace: "pre-line", boxShadow: "0 6px 20px rgba(0,0,0,.2)" }}>
          {text}
        </span>
      )}
    </span>
  );
}
