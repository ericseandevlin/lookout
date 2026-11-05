"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { useFocusTrap } from "./useFocusTrap";

type Ask = { eyebrow?: string; title: string; body?: React.ReactNode; confirmLabel: string; danger?: boolean };
type Pending = Ask & { resolve: (ok: boolean) => void };

const Ctx = createContext<(a: Ask) => Promise<boolean>>(async () => false);

/** Designed replacement for window.confirm, matching the delete-account modal. */
export const useConfirm = () => useContext(Ctx);

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null);
  const ask = useCallback((a: Ask) => new Promise<boolean>((resolve) => setPending({ ...a, resolve })), []);
  const close = (ok: boolean) => {
    pending?.resolve(ok);
    setPending(null);
  };
  return (
    <Ctx.Provider value={ask}>
      {children}
      {pending && <Dialog p={pending} close={close} />}
    </Ctx.Provider>
  );
}

function Dialog({ p, close }: { p: Pending; close: (ok: boolean) => void }) {
  const okRef = useRef<HTMLButtonElement>(null);
  const box = useRef<HTMLDivElement>(null);
  useFocusTrap(box);
  useEffect(() => {
    okRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);
  return (
    <>
      <div onClick={() => close(false)} style={{ position: "fixed", inset: 0, background: "rgba(29,26,15,.45)", zIndex: 40 }} />
      <div ref={box} role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" style={{ position: "fixed", top: "50%", left: "50%", transform: "translate(-50%,-50%)", width: 440, maxWidth: "calc(100vw - 32px)", background: "#EFEEEC", borderRadius: 16, overflow: "hidden", zIndex: 41, boxShadow: "0 24px 60px rgba(29,26,15,.3)" }}>
        <div style={{ background: "#1D1A0F", color: "#fff", padding: "22px 24px 20px", display: "flex", alignItems: "flex-start", gap: 12 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            {p.eyebrow && <div style={{ fontSize: 14, fontWeight: 700, letterSpacing: ".14em", textTransform: "uppercase", color: "#F8A865" }}>{p.eyebrow}</div>}
            <div id="confirm-title" style={{ fontSize: 21, fontWeight: 700, letterSpacing: "-0.01em", marginTop: p.eyebrow ? 6 : 0, textWrap: "pretty", overflowWrap: "anywhere" }}>{p.title}</div>
          </div>
          <button onClick={() => close(false)} aria-label="Close" style={{ border: 0, background: "rgba(255,255,255,.1)", color: "#fff", width: 30, height: 30, borderRadius: "50%", cursor: "pointer", fontSize: 16, lineHeight: 1, flex: "none" }}>×</button>
        </div>
        {p.body && <div style={{ padding: "20px 24px 4px", fontSize: 14, lineHeight: 1.5, color: "#6B6358", textWrap: "pretty" }}>{p.body}</div>}
        <div style={{ padding: "18px 24px 22px", display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button onClick={() => close(false)} style={{ height: 42, padding: "0 18px", borderRadius: 10, border: "1.5px solid #1D1A0F", background: "#fff", fontSize: 14, fontWeight: 600, color: "#1D1A0F", cursor: "pointer" }}>Cancel</button>
          <button ref={okRef} onClick={() => close(true)} style={{ height: 42, padding: "0 18px", borderRadius: 10, border: 0, background: p.danger ? "#99220F" : "#1D1A0F", fontSize: 14, fontWeight: 600, color: "#fff", cursor: "pointer" }}>{p.confirmLabel}</button>
        </div>
      </div>
    </>
  );
}
