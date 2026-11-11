"use client";

import { useState } from "react";
import { parseNote } from "@/lib/application/notes";
import { btn } from "../Settings";
import { Modal } from "./Modal";
import { muted, type Version } from "./shared";
import { color } from "@/lib/tokens";

/**
 * What changed in a version and where its facts came from (#738): a link beside the version picker
 * that opens a modal, since reading it is optional. `label` shows the version when there's no picker.
 */
export function VersionNotes({ v, label }: { v: Version; label?: boolean }) {
  const [open, setOpen] = useState(false);
  const head = `v${v.version} by ${v.author === "ai" ? "Lookout" : "you"}`;
  const points = parseNote(v.note);
  const sources = v.sources.filter((s) => s !== "you");
  if (!points.length && !sources.length) return label ? <span style={muted}>{head}</span> : null;
  return (
    <>
      {label && <span style={muted}>{head}</span>}
      <button type="button" onClick={() => setOpen(true)} style={{ ...btn("text"), height: 32, fontSize: 14, fontWeight: 500, color: color.t2 }}>
        What changed and why
      </button>
      {open && (
        <Modal kicker={head} title="What changed and why" close={() => setOpen(false)}>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {points.length > 0 && <NoteList note={v.note} />}
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
          </div>
        </Modal>
      )}
    </>
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
