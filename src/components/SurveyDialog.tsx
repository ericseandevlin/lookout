"use client";

import { useEffect, useRef, useState } from "react";
import { MAX_TEXT, SCALE, type SurveyQuestion } from "@/lib/survey";
import { api } from "./store";

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';

/**
 * One-question beta survey (#5): a note from Eric, shown once when a question is due. Skipping
 * (the button, Escape or the backdrop) is recorded, so the same question never comes back.
 * Focus stays inside while it's open and returns where it was when it closes.
 */
export function SurveyDialog() {
  const [q, setQ] = useState<SurveyQuestion | null>(null);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [thanks, setThanks] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const back = useRef<HTMLElement | null>(null);

  useEffect(() => {
    api<{ question: SurveyQuestion | null }>("/api/survey").then((r) => setQ(r.question)).catch(() => {});
  }, []);

  const close = () => {
    setQ(null);
    back.current?.focus?.();
  };

  const send = async (answer: string | null) => {
    if (!q || busy) return;
    setBusy(true);
    setErr(null);
    try {
      await api("/api/survey", { method: "POST", json: { questionId: q.id, answer } });
      if (answer === null) return close();
      setThanks(true);
      setTimeout(close, 1400);
    } catch (e) {
      // A skip that didn't save just closes; the question comes back next time.
      if (answer === null) return close();
      setErr(e instanceof Error ? e.message : "Couldn't send that. Try again.");
    } finally {
      setBusy(false);
    }
  };
  const skip = () => send(null);

  useEffect(() => {
    if (!q) return;
    back.current = document.activeElement as HTMLElement | null;
    box.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") return skip();
      if (e.key !== "Tab" || !box.current) return;
      const all = [...box.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
      if (!all.length) return;
      const [first, last] = [all[0], all[all.length - 1]];
      const to = e.shiftKey && document.activeElement === first ? last : !e.shiftKey && document.activeElement === last ? first : null;
      if (to) {
        e.preventDefault();
        to.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q?.id]);

  if (!q) return null;
  const choices = q.kind === "choice" ? q.options : q.kind === "scale" ? [...SCALE] : null;
  const pill = (on: boolean): React.CSSProperties => ({ minWidth: 44, height: 44, padding: "0 14px", borderRadius: 10, border: `1.5px solid ${on ? "#1D1A0F" : "#E0D9CF"}`, background: on ? "#1D1A0F" : "#fff", color: on ? "#fff" : "#1D1A0F", fontSize: 15, fontWeight: 600, cursor: "pointer" });

  return (
    <>
      <div onClick={skip} style={{ position: "fixed", inset: 0, background: "rgba(29,26,15,.45)", zIndex: 50 }} />
      <div style={{ position: "fixed", inset: 0, zIndex: 51, display: "flex", alignItems: "center", justifyContent: "center", padding: 16, pointerEvents: "none" }}>
        <div ref={box} role="dialog" aria-modal="true" aria-labelledby="survey-from" aria-describedby="survey-q" className="lk-in" style={{ pointerEvents: "auto", width: 460, maxWidth: "100%", background: "#EFEEEC", borderRadius: 16, overflow: "hidden", boxShadow: "0 24px 60px rgba(29,26,15,.3)" }}>
          <div style={{ background: "#1D1A0F", color: "#fff", padding: "20px 24px 18px" }}>
            <div id="survey-from" style={{ fontSize: 14, fontWeight: 700, letterSpacing: ".14em", textTransform: "uppercase", color: "#F8A865" }}>
              Quick question from Eric
            </div>
            <div id="survey-q" style={{ fontSize: 19, fontWeight: 700, marginTop: 6, lineHeight: 1.3, textWrap: "pretty" }}>{q.prompt}</div>
          </div>
          {thanks ? (
            <div role="status" style={{ padding: "22px 24px", fontSize: 15 }}>Thanks. That helps.</div>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (value.trim()) send(value);
              }}
              style={{ padding: "18px 24px 22px", display: "flex", flexDirection: "column", gap: 14 }}
            >
              {choices ? (
                <div role="radiogroup" aria-labelledby="survey-q" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {choices.map((c) => (
                    <button key={c} type="button" role="radio" aria-checked={value === c} onClick={() => setValue(c)} style={pill(value === c)}>
                      {c}
                    </button>
                  ))}
                </div>
              ) : (
                <textarea aria-labelledby="survey-q" value={value} onChange={(e) => setValue(e.target.value)} maxLength={MAX_TEXT} rows={3} className="f-brick" style={{ borderRadius: 10, border: "1.5px solid #E6E0D8", padding: 10, fontSize: 15, fontFamily: "inherit", resize: "vertical" }} />
              )}
              {q.kind === "scale" && <div style={{ fontSize: 14, color: "#6B6358", marginTop: -6 }}>1 is not at all, 5 is very.</div>}
              {err && (
                <div role="alert" style={{ fontSize: 14, color: "#99220F" }}>
                  {err}
                </div>
              )}
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <button type="button" onClick={skip} disabled={busy} style={{ height: 42, padding: "0 18px", borderRadius: 10, border: "1.5px solid #1D1A0F", background: "#fff", fontSize: 14, fontWeight: 600, color: "#1D1A0F", cursor: "pointer" }}>
                  Skip
                </button>
                <button type="submit" disabled={busy || !value.trim()} style={{ height: 42, padding: "0 18px", borderRadius: 10, border: 0, background: "#99220F", fontSize: 14, fontWeight: 600, color: "#fff", cursor: "pointer", opacity: busy || !value.trim() ? 0.6 : 1 }}>
                  {busy ? "Sending…" : "Send"}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </>
  );
}
