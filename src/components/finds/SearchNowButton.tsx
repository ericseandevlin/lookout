"use client";

import { useState } from "react";
import { searchBlocker } from "@/lib/ready";
import { useCounts } from "../Shell";
import { useStore } from "../store";
import { color, font } from "@/lib/tokens";

export function SearchNowButton() {
  const { searchNow, fail, state } = useStore();
  const [busy, setBusy] = useState(false);
  const running = !!state.running;
  // No search until the profile is complete (#255). aria-disabled keeps the tip on hover;
  // a tap says what's missing, which is the only way to learn it on a phone.
  const missing = searchBlocker(useCounts(state).answered, state.materials.resume?.status);
  const off = running || busy || !!missing;
  const go = async () => {
    if (missing) return fail(new Error(`${missing.text}.`));
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
      aria-disabled={off || undefined}
      data-tip={running ? "A search is running" : missing?.text ?? "Look for new roles now"}
      aria-label={missing ? `Search now. ${missing.text}` : "Search now"}
      className="board-search"
      style={{ width: "auto", flex: "none", display: "flex", alignItems: "center", gap: 6, padding: "0 14px", borderRadius: 999, border: "1.5px solid #1D1A0F", background: "#fff", color: color.ink, fontSize: font.base, fontWeight: 600, cursor: off ? "default" : "pointer", opacity: off ? 0.5 : 1 }}
    >
      <span aria-hidden style={{ fontSize: font.md, lineHeight: 1 }}>↻</span>
      <span className="desk-only">{running ? "Searching…" : "Search now"}</span>
    </button>
  );
}
