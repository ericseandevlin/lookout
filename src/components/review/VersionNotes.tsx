"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { parseNote } from "@/lib/application/notes";
import { useFocusTrap } from "../useFocusTrap";
import { muted, type Version } from "./shared";
import { color } from "@/lib/tokens";

/**
 * What changed in a version and where its facts came from. Reading it is optional, so anything
 * longer than a line sits in a collapsed section.
 */
export function VersionNotes({ v }: { v: Version }) {
  const head = `v${v.version} by ${v.author === "ai" ? "Lookout" : "you"}`;
  const points = parseNote(v.note);
  const sources = v.sources.filter((s) => s !== "you");
  if (points.length <= 1 && sources.length <= 1)
    return (
      <div style={muted}>
        {head}
        {points[0] ? `: ${points[0].text}` : ""}
        {sources[0] ? ` · Source: ${sources[0]}` : ""}
      </div>
    );
  return <NotesLink head={head} v={v} sources={sources} count={points.length} />;
}

/** The notes sit behind a link, in a dialog (#738): reading them is optional, so they take no room on the page. */
function NotesLink({ head, v, sources, count }: { head: string; v: Version; sources: string[]; count: number }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  return (
    <>
      <button onClick={() => setOpen(true)} aria-haspopup="dialog" data-tip={`${count} note${count === 1 ? "" : "s"}${sources.length ? `, ${sources.length} source${sources.length === 1 ? "" : "s"}` : ""}`} style={{ border: 0, background: "none", padding: 0, fontSize: 14, color: color.t2, textDecoration: "underline", cursor: "pointer", fontFamily: "inherit" }}>
        What changed in v{v.version}
      </button>
      {open && (
        <NotesDialog box={box} title={`${head}: what changed and why`} close={() => setOpen(false)}>
          {count > 0 && <NoteList note={v.note} />}
          {sources.length > 0 && (
            <div>
              <div style={{ fontWeight: 600 }}>Sources</div>
              <ul style={{ margin: "2px 0 0", paddingLeft: 18 }}>
                {sources.map((s, i) => (
                  <li key={i}>
                    {/^https?:\/\//i.test(s) ? (
                      <a href={s} target="_blank" rel="noreferrer" style={{ color: color.ink, overflowWrap: "anywhere" }}>
                        {s} ↗
                      </a>
                    ) : (
                      s
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </NotesDialog>
      )}
    </>
  );
}

function NotesDialog({ box, title, close, children }: { box: React.RefObject<HTMLDivElement | null>; title: string; close: () => void; children: React.ReactNode }) {
  useFocusTrap(box);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);
  // On the body, not in place: the page's entry animation leaves a transform on its sections, and a fixed box inside one is placed against that section, off screen.
  return createPortal(
    <>
      <div onClick={close} style={{ position: "fixed", inset: 0, background: "rgba(29,26,15,.45)", zIndex: 40 }} />
      <div ref={box} role="dialog" aria-modal="true" aria-labelledby="notes-title" style={{ position: "fixed", top: "50%", left: "50%", transform: "translate(-50%,-50%)", width: 560, maxWidth: "calc(100vw - 32px)", maxHeight: "calc(100vh - 64px)", display: "flex", flexDirection: "column", background: "#fff", borderRadius: 16, overflow: "hidden", zIndex: 41, boxShadow: "0 24px 60px rgba(29,26,15,.3)" }}>
        <div style={{ background: color.ink, color: "#fff", padding: "16px 20px", display: "flex", alignItems: "center", gap: 12 }}>
          <div id="notes-title" style={{ flex: 1, fontSize: 17, fontWeight: 700 }}>{title}</div>
          <button onClick={close} aria-label="Close" style={{ border: 0, background: "rgba(255,255,255,.1)", color: "#fff", width: 30, height: 30, borderRadius: "50%", cursor: "pointer", fontSize: 16, lineHeight: 1, flex: "none" }}>×</button>
        </div>
        <div style={{ padding: "16px 20px 20px", overflowY: "auto", fontSize: 14, lineHeight: 1.5, color: color.t2, display: "flex", flexDirection: "column", gap: 10 }}>{children}</div>
      </div>
    </>,
    document.body,
  );
}

/** A version note as a list: one point per change, sub-points for what was added where. */
function NoteList({ note }: { note: string }) {
  const points = parseNote(note);
  return (
    <div>
      <ul style={{ margin: "2px 0 0", paddingLeft: 18, display: "flex", flexDirection: "column", gap: 2 }}>
        {points.map((p, i) => (
          <li key={i}>
            {p.text}
            {p.sub.length > 0 && (
              <ul style={{ margin: "2px 0 0", paddingLeft: 18 }}>
                {p.sub.map((s, j) => (
                  <li key={j}>{s}</li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
