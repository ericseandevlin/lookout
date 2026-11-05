"use client";

import { parseNote } from "@/lib/application/notes";
import { muted, type Version } from "./shared";

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
  return (
    <details style={{ ...muted }}>
      <summary style={{ cursor: "pointer", fontWeight: 600 }}>
        {head}: what changed and why ({points.length} note{points.length === 1 ? "" : "s"}
        {sources.length ? `, ${sources.length} source${sources.length === 1 ? "" : "s"}` : ""})
      </summary>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 6 }}>
        {points.length > 0 && <NoteList note={v.note} />}
        {sources.length > 0 && (
          <div>
            <div style={{ fontWeight: 600 }}>Sources</div>
            <ul style={{ margin: "2px 0 0", paddingLeft: 18 }}>
              {sources.map((s, i) => (
                <li key={i}>
                  {/^https?:\/\//i.test(s) ? (
                    <a href={s} target="_blank" rel="noreferrer" style={{ color: "#1D1A0F", overflowWrap: "anywhere" }}>
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
    </details>
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
