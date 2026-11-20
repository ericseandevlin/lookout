"use client";

import Link from "next/link";
import { useStore } from "../store";
import { trackClient } from "../track";
import { color, font } from "@/lib/tokens";

/** The Finds board's way into the interview (#1449): one question, about a minute. */
export function InterviewCard() {
  const { state, readOnly } = useStore();
  if (!state.user.interview || readOnly || !state.finds.length) return null;
  return (
    <section aria-labelledby="iv-card-title" className="board-sec lk-in" style={{ background: "#fff", padding: "16px 22px", display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
      <div style={{ flex: "1 1 260px", minWidth: 0 }}>
        <div style={{ fontSize: font.base, fontWeight: 700, letterSpacing: ".14em", textTransform: "uppercase", color: color.brick }}>Interview</div>
        <div id="iv-card-title" style={{ fontSize: font.xl, fontWeight: 700, marginTop: 4 }}>One question, about a minute</div>
        <div style={{ fontSize: font.base, color: color.t2, marginTop: 4, lineHeight: 1.45 }}>Your top finds ask for things your profile doesn&apos;t show yet. Each answer makes your drafts stronger.</div>
      </div>
      <Link
        href="/interview"
        onClick={() => trackClient("tip_clicked", "interview-card")}
        style={{ height: 38, padding: "0 16px", borderRadius: 10, background: color.brick, color: "#fff", fontSize: font.base, fontWeight: 600, textDecoration: "none", display: "flex", alignItems: "center", flex: "none" }}
      >
        Answer one
      </Link>
    </section>
  );
}
