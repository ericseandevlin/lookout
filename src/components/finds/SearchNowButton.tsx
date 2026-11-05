"use client";

import { useState } from "react";
import { useStore } from "../store";

export function SearchNowButton() {
  const { searchNow, fail, state } = useStore();
  const [busy, setBusy] = useState(false);
  const running = !!state.running;
  const go = async () => {
    setBusy(true);
    try {
      await searchNow();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <button
      onClick={go}
      disabled={running || busy}
      data-tip={running ? "A search is running" : "Look for new roles now"}
      aria-label="Search now"
      className="board-search"
      style={{ width: "auto", flex: "none", display: "flex", alignItems: "center", gap: 6, padding: "0 14px", borderRadius: 999, border: "1.5px solid #1D1A0F", background: "#fff", color: "#1D1A0F", fontSize: 14, fontWeight: 600, cursor: running || busy ? "default" : "pointer", opacity: running || busy ? 0.5 : 1 }}
    >
      <span aria-hidden style={{ fontSize: 15, lineHeight: 1 }}>↻</span>
      <span className="desk-only">{running ? "Searching…" : "Search now"}</span>
    </button>
  );
}
