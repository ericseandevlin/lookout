"use client";

import { useState } from "react";
import { PlusIcon } from "../icons";
import { useStore } from "../store";
import { color } from "@/lib/tokens";

export function AddLink({ open, setOpen }: { open: boolean; setOpen: (v: boolean) => void }) {
  const { addFindByUrl, state } = useStore();
  const [url, setUrl] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!url.trim()) return;
    setBusy(true);
    setMsg(null);
    try {
      await addFindByUrl(url.trim());
      setUrl("");
      setOpen(false);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Couldn't add that link");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div style={{ position: "relative", flex: "none" }}>
      <button
        onClick={() => setOpen(!open)}
        disabled={!!state.running}
        data-tip="Add a posting by link"
        aria-label="Add a posting by link"
        className="board-search"
        style={{ width: "auto", display: "flex", alignItems: "center", gap: 6, padding: "0 14px", borderRadius: 999, border: 0, background: color.ink, color: "#fff", fontSize: 14, fontWeight: 600, cursor: state.running ? "default" : "pointer", opacity: state.running ? 0.5 : 1 }}
      >
        <PlusIcon />
        <span className="desk-only">Add</span>
      </button>
      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 5 }} />
          <div style={{ position: "absolute", right: 0, top: 46, zIndex: 6, width: 340, maxWidth: "calc(100vw - 32px)", background: "#fff", borderRadius: 12, boxShadow: "0 8px 28px rgba(29,26,15,.18)", padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ fontSize: 14.5, fontWeight: 600 }}>Add a posting</div>
            <div style={{ fontSize: 14, color: color.t2, lineHeight: 1.45 }}>Paste a link. Lookout reads it, scores it against your profile and adds it to the board.</div>
            <div style={{ display: "flex", gap: 6 }}>
              <input
                autoFocus
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") submit(); if (e.key === "Escape") setOpen(false); }}
                placeholder="https://..."
                aria-label="Posting link"
                className="f-brick"
                style={{ flex: 1, minWidth: 0, height: 40, borderRadius: 10, border: `1.5px solid ${color.border}`, padding: "0 12px", fontSize: 14, outline: "none" }}
              />
              <button onClick={submit} disabled={busy} style={{ height: 40, padding: "0 14px", borderRadius: 10, border: 0, background: color.brick, color: "#fff", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>
                {busy ? "Adding…" : "Add"}
              </button>
            </div>
            {msg && <div style={{ fontSize: 14, color: color.brick }}>{msg}</div>}
          </div>
        </>
      )}
    </div>
  );
}
