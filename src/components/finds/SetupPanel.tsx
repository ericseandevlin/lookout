"use client";

import Link from "next/link";
import { DAYS } from "@/lib/board";
import { CheckIcon } from "../icons";
import { useStore } from "../store";

export function SetupPanel({ answered, sources }: { answered: number; sources: number }) {
  const { state } = useStore();
  const st = state.settings;
  const d1 = answered === 5;
  const d2 = state.materials.resume?.status === "done";
  const ready = d1 && d2;
  if (st.setup === "Never" || (st.setup === "Until complete" && ready)) return null;
  const s3 = !ready
    ? "Starts once 1 and 2 are done"
    : st.freq === "Weekly" ? `Next run ${DAYS[st.day]}` : st.freq === "Twice a week" ? `Runs ${st.days.join(" & ")}` : "Runs daily";

  const now = !d1 ? 1 : !d2 ? 2 : 0;
  const tiles = [
    { n: 1, done: d1, status: d1 ? "Done" : `${answered} of 5 answered`, title: "Answer five questions", body: "What you want next, the comp you need, and what’s off the table.", href: "/profile", btn: d1 ? "Review answers" : answered > 0 ? "Continue" : "Start profile" },
    { n: 2, done: d2, status: d2 ? `${sources} of 3 added` : "Resume needed", title: "Add your materials", body: "Your resume, LinkedIn and any links. Lookout reads these to fill in gaps and to write in your voice.", href: "/profile/materials", btn: d2 ? "Review materials" : "Add materials" },
    { n: 3, done: false, status: s3, title: "Lookout gets to work", body: "New matches land here each week with a green dot. Pin, archive and move them through stages as you go." },
  ];
  return (
    <div className="setup board-sec lk-in" style={{ background: "#1D1A0F", color: "#fff", display: "flex", flexDirection: "column" }}>
      <div>
        <div style={{ fontSize: 14, fontWeight: 700, letterSpacing: ".14em", textTransform: "uppercase", color: "#F8A865" }}>Getting started</div>
        <div className="setup-title" style={{ fontWeight: 700, letterSpacing: "-0.01em", marginTop: 6, textWrap: "pretty" }}>Tell Lookout what you&apos;re looking for</div>
        <div style={{ fontSize: 14, lineHeight: 1.5, color: "#C9C1B5", marginTop: 6, maxWidth: 620, textWrap: "pretty" }}>
          Lookout searches for new roles every week and scores each one against your profile. The more it knows about you, the better the matches on this board.
        </div>
      </div>
      <div className="setup-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))" }}>
        {tiles.map((t) => (
          // The step you're on gets a thin outline; step 3 is what happens next, so it sits on the card as plain text (#255).
          <div key={t.n} className={`setup-tile${t.n === now ? " now" : ""}${t.n === 3 ? " plain" : ""}`} aria-current={t.n === now ? "step" : undefined} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
                <div style={{ fontSize: 30, fontWeight: 700, lineHeight: 1, letterSpacing: "-0.02em", color: "#F8A865" }}>{t.n}</div>
                {t.done && <span style={{ fontSize: 14, fontWeight: 700, letterSpacing: ".12em", color: "#F8A865" }}>COMPLETE</span>}
              </div>
              {t.done ? <CheckIcon stroke="#F8A865" /> : <div style={{ fontSize: 14, fontWeight: 600, color: "#A89F92" }}>{t.status}</div>}
            </div>
            <div style={{ fontSize: 15.5, fontWeight: 600 }}>{t.title}</div>
            <div style={{ fontSize: 14, lineHeight: 1.5, color: "#C9C1B5", textWrap: "pretty", flex: 1 }}>{t.body}</div>
            {t.href && (
              <Link href={t.href} style={{ alignSelf: "flex-start", height: 34, padding: "0 14px", borderRadius: 999, background: t.done ? "rgba(255,255,255,.1)" : "#F8A865", color: t.done ? "#fff" : "#1D1A0F", fontSize: 14, fontWeight: 600, marginTop: 4, display: "inline-flex", alignItems: "center", textDecoration: "none" }}>
                {t.btn}
              </Link>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
