"use client";

import { useState } from "react";
import { btn } from "../Settings";
import { muted, type Item } from "./shared";
import { color, font } from "@/lib/tokens";

export function QuestionRow({ item, onSave }: { item: Item; onSave: (content: string) => Promise<boolean> }) {
  const [v, setV] = useState("");
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    if (await onSave(v)) setV("");
    setBusy(false);
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <label htmlFor={`q-${item.id}`} style={{ fontSize: font.md, fontWeight: 600 }}>
        {item.question}
      </label>
      {!item.question?.toLowerCase().includes(item.prompt.toLowerCase().slice(0, 40)) && <div style={muted}>For: {item.prompt}</div>}
      {item.options?.length ? (
        <select id={`q-${item.id}`} value={v} onChange={(e) => setV(e.target.value)} style={{ height: 40, borderRadius: 10, border: `1.5px solid ${color.border}`, padding: "0 10px", fontSize: font.md, maxWidth: 420 }}>
          <option value="">Choose…</option>
          {item.options.map((o) => (
            <option key={o}>{o}</option>
          ))}
        </select>
      ) : (
        <textarea id={`q-${item.id}`} value={v} onChange={(e) => setV(e.target.value)} rows={2} style={{ borderRadius: 10, border: `1.5px solid ${color.border}`, padding: 10, fontSize: font.md, fontFamily: "inherit", resize: "vertical" }} />
      )}
      <button onClick={save} disabled={!v.trim() || busy} style={{ ...btn("outline"), alignSelf: "flex-start" }}>
        {busy ? "Saving…" : "Save answer"}
      </button>
    </div>
  );
}
