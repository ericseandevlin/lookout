"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { cellQuiet, cellText, slugOf, stageStyle } from "@/lib/board";
import { kindOf } from "@/lib/kinds";
import type { Find } from "@/lib/types";
import { applicationLabel } from "@/lib/applyLabels";
import { CompCompare } from "../CurrentComp";
import { ArrowUpRight, CheckIcon, LinkIcon, PinIcon, XIcon } from "../icons";
import { api, useStore } from "../store";
import { SubmitModeNote } from "../SubmitModeNote";
import { trackClient } from "../track";
import { useFocusTrap } from "../useFocusTrap";

const Label = ({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) => (
  <div style={{ fontSize: 14, letterSpacing: ".1em", textTransform: "uppercase", color: "#1D1A0F", fontWeight: 700, ...style }}>{children}</div>
);

const NOTES_IDLE_MS = 6000;
const DRAWER_MS = 220;

const NOT_A_FIT = ["Wrong level", "Wrong kind of role", "Wrong industry", "Location", "Pay", "Not that company", "Just not interested"];

type DrawerNav = { index: number; total: number; prev?: () => void; next?: () => void };

export function Drawer({ f, currentComp, close, toggle, setStage, enter, nav }: { f: Find; currentComp: number | null; close: () => void; toggle: (f: Find, k: "pinned" | "archived") => void; setStage: (f: Find, s: string) => void; enter: boolean; nav: DrawerNav }) {
  const { patchFind, state, refresh, readOnly } = useStore();
  const [applyMsg, setApplyMsg] = useState<string | null>(null);
  const applyWithLookout = async () => {
    setApplyMsg("Queuing…");
    try {
      await api("/api/apply", { method: "POST", json: { findId: f.id } });
      await refresh();
      setApplyMsg(null);
    } catch (e) {
      setApplyMsg(e instanceof Error ? e.message : "Couldn't queue it");
    }
  };
  const [notes, setNotes] = useState(f.notes);
  const [noteState, setNoteState] = useState<"idle" | "saving" | "saved">("idle");
  const [copied, setCopied] = useState(false);
  const [asking, setAsking] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const timers = useRef<{ save?: ReturnType<typeof setTimeout>; hide?: ReturnType<typeof setTimeout>; copy?: ReturnType<typeof setTimeout> }>({});
  const closeBtn = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLElement>(null);
  useFocusTrap(panel);
  // Notes stay local while typing; they save after a long pause or when the drawer closes, so typing never stalls.
  const pending = useRef<string | null>(null);
  const navRef = useRef(nav);
  useEffect(() => {
    navRef.current = nav;
  });

  const flushNotes = useCallback(async () => {
    clearTimeout(timers.current.save);
    const v = pending.current;
    if (v === null) return;
    pending.current = null;
    setNoteState("saving");
    await patchFind(f.id, { notes: v });
    setNoteState("saved");
    clearTimeout(timers.current.hide);
    timers.current.hide = setTimeout(() => setNoteState("idle"), 2000);
  }, [f.id, patchFind]);

  const animatedClose = useCallback(() => {
    flushNotes();
    setLeaving(true);
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    setTimeout(close, reduce ? 0 : DRAWER_MS);
  }, [close, flushNotes]);

  useEffect(() => {
    closeBtn.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") return animatedClose();
      const typing = (e.target as HTMLElement | null)?.closest("input, textarea, select, [contenteditable]");
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "ArrowLeft" || e.key === "k") navRef.current.prev?.();
      if (e.key === "ArrowRight" || e.key === "j") navRef.current.next?.();
    };
    // Leaving the page with unsaved notes: send them with keepalive so the request outlives the tab.
    const onHide = () => {
      if (pending.current === null) return;
      fetch(`/api/finds/${f.id}`, { method: "PATCH", keepalive: true, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ notes: pending.current }) });
      pending.current = null;
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pagehide", onHide);
    const t = timers.current;
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pagehide", onHide);
      clearTimeout(t.hide);
      clearTimeout(t.copy);
      if (pending.current !== null) {
        clearTimeout(t.save);
        patchFind(f.id, { notes: pending.current });
        pending.current = null;
      }
    };
  }, [animatedClose, f.id, patchFind]);

  const onNotes = (v: string) => {
    setNotes(v);
    pending.current = v;
    clearTimeout(timers.current.save);
    timers.current.save = setTimeout(flushNotes, NOTES_IDLE_MS);
  };
  const copy = () => {
    const url = location.href.split("#")[0] + "#" + slugOf(f);
    (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject())
      .catch(() => {})
      .finally(() => {
        setCopied(true);
        clearTimeout(timers.current.copy);
        timers.current.copy = setTimeout(() => setCopied(false), 1800);
      });
  };
  const posting = f.url || "https://www.google.com/search?q=" + encodeURIComponent(f.company + " " + f.role + " job");
  // Labels, cells and stages come from the find's kind config (#8).
  const cfg = kindOf(f.type);
  const cells = [
    { label: cfg.board.columns[2].label, text: cellText(f, cfg.board.columns[2].key), quiet: cellQuiet(f, cfg.board.columns[2].key) },
    { label: cfg.board.preStage.label, text: cellText(f, cfg.board.preStage.key), quiet: cellQuiet(f, cfg.board.preStage.key) },
    { label: cfg.board.tail.label, text: cellText(f, cfg.board.tail.key), quiet: cellQuiet(f, cfg.board.tail.key) },
  ];

  return (
    <>
      <div onClick={animatedClose} className={leaving ? "drawer-scrim out" : enter ? "drawer-scrim" : undefined} style={{ position: "fixed", inset: 0, background: "rgba(29,26,15,.28)", zIndex: 20 }} />
      <aside ref={panel} role="dialog" aria-modal="true" aria-label={`${f.role} at ${f.company}`} className={leaving ? "drawer-panel out" : enter ? "drawer-panel" : undefined} style={{ position: "fixed", top: 0, right: 0, bottom: 0, width: 440, maxWidth: "100vw", background: "#fff", zIndex: 21, display: "flex", flexDirection: "column", boxShadow: "-12px 0 40px rgba(29,26,15,.18)" }}>
        {nav.index >= 0 && nav.total > 1 && (
          <div className="drawer-nav" role="group" aria-label="Move between finds">
            <button onClick={nav.prev} disabled={!nav.prev} aria-label="Previous find" data-tip="Previous (←)" className="drawer-nav-btn">‹</button>
            <span aria-live="polite" className="drawer-nav-count">{nav.index + 1}/{nav.total}</span>
            <button onClick={nav.next} disabled={!nav.next} aria-label="Next find" data-tip="Next (→)" className="drawer-nav-btn">›</button>
          </div>
        )}
        <div style={{ background: "#1D1A0F", color: "#fff", padding: "24px 26px 22px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
            <div style={{ fontSize: 14, color: "#F8A865", fontWeight: 600 }}>{f.company}</div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <button ref={closeBtn} onClick={animatedClose} aria-label="Close" style={{ border: 0, background: "rgba(255,255,255,.1)", color: "#fff", width: 30, height: 30, borderRadius: "50%", cursor: "pointer", fontSize: 16, lineHeight: 1 }}>×</button>
            </div>
          </div>
          <div style={{ fontSize: 23, fontWeight: 700, letterSpacing: "-0.01em", marginTop: 6, textWrap: "pretty" }}>{f.role}</div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
            <span style={{ padding: "4px 10px", borderRadius: 6, fontSize: 14, fontWeight: 600, background: "#F8A865", color: "#1D1A0F" }}>Match {f.score}/5</span>
            <div style={{ marginLeft: "auto", display: "flex", gap: 6, alignItems: "center" }}>
              <button onClick={() => toggle(f, "pinned")} data-tip={f.pinned ? "Unpin" : "Pin"} aria-label={f.pinned ? "Unpin" : "Pin"} style={{ width: 30, height: 30, border: 0, borderRadius: "50%", background: f.pinned ? "#F8A865" : "rgba(255,255,255,.1)", color: f.pinned ? "#1D1A0F" : "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", padding: 0 }}>
                <PinIcon size={14} sw={2} />
              </button>
              <button onClick={copy} style={{ height: 30, padding: "0 12px", border: 0, borderRadius: 999, background: "rgba(255,255,255,.1)", color: "#fff", fontSize: 14, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}>
                <LinkIcon />
                {copied ? "Copied" : "Copy link"}
              </button>
            </div>
          </div>
        </div>
        <div style={{ padding: "22px 26px", display: "flex", flexDirection: "column", gap: 22, overflowY: "auto", flex: 1 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px 18px" }}>
            <div><Label>{cells[0].label}</Label><div style={{ fontSize: 14.5, marginTop: 4, fontWeight: 600, color: cells[0].quiet ? "#6B6358" : "#99220F" }}>{cells[0].text}</div>{cfg.board.columns[2].key === "comp" && <CompCompare f={f} current={currentComp} style={{ marginTop: 2 }} />}</div>
            <div><Label>{cells[1].label}</Label><div style={{ fontSize: 14.5, marginTop: 4 }}>{cells[1].text}</div></div>
            <div style={{ gridColumn: "1 / -1" }}><Label>{cells[2].label}</Label><div style={{ fontSize: 14.5, marginTop: 4 }}>{cells[2].text || "Not stated"}</div></div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {f.reasonsMatch.length > 0 && (
              <div>
                <Label style={{ marginBottom: 8 }}>Why it’s a match</Label>
                <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                  {f.reasonsMatch.map((m) => (
                    <div key={m} style={{ display: "flex", gap: 10, alignItems: "flex-start", fontSize: 14, lineHeight: 1.45 }}>
                      <CheckIcon size={14} stroke="#427D33" style={{ flex: "none", marginTop: 3 }} />
                      <span style={{ textWrap: "pretty" }}>{m}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {f.reasonsGap.length > 0 && (
              <div>
                <Label style={{ marginBottom: 8 }}>Not a match</Label>
                <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                  {f.reasonsGap.map((m) => (
                    <div key={m} style={{ display: "flex", gap: 10, alignItems: "flex-start", fontSize: 14, lineHeight: 1.45 }}>
                      <XIcon stroke="#99220F" style={{ flex: "none", marginTop: 3 }} />
                      <span style={{ textWrap: "pretty" }}>{m}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
          <div>
            <Label style={{ marginBottom: 8 }}>Stage</Label>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 6 }}>
              {cfg.stages.map((s) => {
                const on = f.stage === s, ss = stageStyle(s);
                return (
                  <button key={s} onClick={() => setStage(f, s)} aria-pressed={on} data-tip={cfg.endedStages.includes(s) ? "Archives it" : undefined} style={{ height: 36, borderRadius: 9, border: `1.5px solid ${on ? ss.bg : "#E6E0D8"}`, background: on ? ss.bg : "#fff", color: on ? ss.ink : "#6B6358", fontSize: 14, fontWeight: 600, cursor: "pointer", padding: "0 4px" }}>
                    {s}
                  </button>
                );
              })}
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, marginBottom: 8 }}>
              <Label>Notes</Label>
              <div style={{ fontSize: 14, color: "#6B6358" }}>{readOnly ? "View only" : "Saves when you pause or close"}</div>
            </div>
            <div style={{ position: "relative", flex: 1, display: "flex" }}>
              <textarea value={notes} readOnly={readOnly} onChange={(e) => onNotes(e.target.value)} onBlur={flushNotes} placeholder="Contacts, follow-ups, interview prep..." aria-label="Notes" className="f-brick" style={{ flex: 1, minHeight: 160, resize: "vertical", border: "1.5px solid #E6E0D8", borderRadius: 10, padding: "12px 14px 34px", fontSize: 14, lineHeight: 1.5, outline: "none", color: "#1D1A0F", cursor: noteState === "saving" ? "progress" : undefined }} />
              <div aria-live="polite" style={{ position: "absolute", right: 10, bottom: 10, padding: "3px 10px", borderRadius: 999, fontSize: 14, fontWeight: 600, background: noteState === "saved" ? "#E8F1E6" : "#F4F1EC", color: noteState === "saved" ? "#2F5A2A" : "#3B362C", opacity: noteState === "idle" ? 0 : 1, transition: "opacity .25s", pointerEvents: "none" }}>
                {noteState === "saving" ? "Saving…" : noteState === "saved" ? "Saved" : ""}
              </div>
            </div>
          </div>
        </div>
        {state.user.autoApply && !f.archived && (
          <div style={{ padding: "14px 26px 0", borderTop: "1px solid #EEEAE4", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            {f.application ? (
              (() => {
                const st = applicationLabel(f.application.status, f.application.queuedBy);
                return (
                  <>
                    <span style={{ padding: "5px 11px", borderRadius: 999, fontSize: 14, fontWeight: 600, background: st.bg, color: st.ink }}>{st.label}</span>
                    <Link href={`/apply#app-${f.application.id}`} style={{ fontSize: 14, fontWeight: 600 }}>View application →</Link>
                    {f.application.status !== "submitted" && f.application.status !== "canceled" && <SubmitModeNote submit={f.submit} compact />}
                  </>
                );
              })()
            ) : (
              <>
                <button onClick={applyWithLookout} disabled={applyMsg === "Queuing…"} style={{ height: 38, padding: "0 14px", borderRadius: 10, border: "1.5px solid #1D1A0F", background: "#fff", fontSize: 14, fontWeight: 600, color: "#1D1A0F", cursor: "pointer" }}>
                  {applyMsg === "Queuing…" ? "Queuing…" : "Apply with Lookout"}
                </button>
                <span style={{ fontSize: 14, color: applyMsg ? "#99220F" : "#6B6358" }}>{applyMsg ?? "Beta. Drafts everything for your review first."}</span>
                {!applyMsg && <SubmitModeNote submit={f.submit} />}
              </>
            )}
          </div>
        )}
        {asking && !f.archived && (
          <div style={{ padding: "14px 26px 0", borderTop: "1px solid #EEEAE4", display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ fontSize: 14, fontWeight: 600 }}>What&apos;s off about it? Lookout uses this on your next searches.</div>
            <div role="group" aria-label="Why it's not a fit" style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {NOT_A_FIT.map((r) => (
                <button key={r} onClick={() => { patchFind(f.id, { archived: true, feedback: r === "Just not interested" ? null : r }); setAsking(false); }} style={{ height: 32, padding: "0 12px", borderRadius: 999, border: "1.5px solid #E0D9CF", background: "#fff", color: "#1D1A0F", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>{r}</button>
              ))}
            </div>
          </div>
        )}
        <div style={{ padding: "16px 26px", borderTop: asking && !f.archived ? 0 : "1px solid #EEEAE4", display: "flex", gap: 8 }}>
          <button
            onClick={() => (f.archived ? patchFind(f.id, { archived: false, feedback: null }) : setAsking((v) => !v))}
            aria-expanded={f.archived ? undefined : asking}
            style={{ flex: 1, height: 42, borderRadius: 10, border: "1.5px solid #1D1A0F", background: asking ? "#F4F1EC" : "#fff", fontSize: 14, fontWeight: 600, color: "#1D1A0F", cursor: "pointer" }}
          >
            {f.archived ? (f.feedback ? `Restore · was “${f.feedback}”` : "Restore") : asking ? "Cancel" : "Not a fit"}
          </button>
          <a href={posting} target="_blank" rel="noopener noreferrer" onClick={() => trackClient("posting_clicked", f.id)} style={{ flex: 1, height: 42, borderRadius: 10, background: "#99220F", fontSize: 14, fontWeight: 600, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", gap: 7, textDecoration: "none" }}>
            View posting
            <ArrowUpRight />
          </a>
        </div>
      </aside>
    </>
  );
}
