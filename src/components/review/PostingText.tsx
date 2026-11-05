"use client";

import { postingBlocks } from "@/lib/application/posting";

/** The posting, readable: key facts first, then its own headings, lists and paragraphs. */
export function PostingText({ text }: { text: string }) {
  return (
    <div style={{ fontSize: 14, lineHeight: 1.55, color: "#3B362C", display: "flex", flexDirection: "column", gap: 8 }}>
      {postingBlocks(text).map((b, i) =>
        b.t === "facts" ? (
          <dl key={i} style={{ margin: 0, display: "grid", gridTemplateColumns: "auto 1fr", gap: "4px 12px", padding: 12, borderRadius: 10, background: "#FAF8F5" }}>
            {b.rows.map(([k, v]) => (
              <div key={k} style={{ display: "contents" }}>
                <dt style={{ fontWeight: 600, color: "#6B6358" }}>{k}</dt>
                <dd style={{ margin: 0 }}>{v}</dd>
              </div>
            ))}
          </dl>
        ) : b.t === "heading" ? (
          <h3 key={i} style={{ margin: "8px 0 0", fontSize: 15, fontWeight: 700, color: "#1D1A0F" }}>{b.text}</h3>
        ) : b.t === "bullets" ? (
          <ul key={i} style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 4 }}>
            {b.items.map((x, j) => (
              <li key={j}>{x}</li>
            ))}
          </ul>
        ) : (
          <p key={i} style={{ margin: 0 }}>{b.text}</p>
        ),
      )}
    </div>
  );
}
