"use client";

import Link from "next/link";
import { DAYS } from "@/lib/board";
import { kindOf } from "@/lib/kinds";
import { CheckIcon } from "../icons";
import { useStore } from "../store";
import { color, font } from "@/lib/tokens";

export function SetupPanel({ answered, sources }: { answered: number; sources: number }) {
  const { state } = useStore();
  const st = state.settings;
  const cfg = kindOf(state.profile.kind);
  const total = cfg.questions.length;
  const d1 = answered === total;
  const d2 = state.materials.resume?.status === "done";
  const ready = d1 && d2;
  if (st.setup === "Never" || (st.setup === "Until complete" && ready)) return null;
  const s3 = !ready
    ? "Starts once 1 and 2 are done"
    : st.freq === "Weekly" ? `Next run ${DAYS[st.day]}` : st.freq === "Twice a week" ? `Runs ${st.days.join(" & ")}` : "Runs daily";

  const now = !d1 ? 1 : !d2 ? 2 : 0;
  const tiles = [
    { n: 1, done: d1, status: d1 ? "Done" : `${answered} of ${total} answered`, title: cfg.id === "rfp" ? "Answer the questions" : "Answer five questions", body: cfg.id === "rfp" ? "What your business can do, the contracts you want, and where you can work." : "What you want next, the comp you need, and what’s off the table.", href: "/profile", btn: d1 ? "Review answers" : answered > 0 ? "Continue" : "Start profile" },
    { n: 2, done: d2, status: d2 ? `${sources} of 3 added` : "Resume needed", title: "Add your materials", body: "Your resume, LinkedIn and any links. Lookout reads these to fill in gaps and to write in your voice.", href: "/profile/materials", btn: d2 ? "Review materials" : "Add materials" },
    { n: 3, done: false, status: s3, title: "Lookout gets to work", body: "New matches land here each week with a green dot. Pin, archive and move them through stages as you go." },
  ];
  return (
    <div className="setup board-sec lk-in" style={{ background: color.ink, color: "#fff", display: "flex", flexDirection: "column" }}>
      <div>
        <div style={{ fontSize: font.base, fontWeight: 700, letterSpacing: ".14em", textTransform: "uppercase", color: color.orange }}>Getting started</div>
        <div className="setup-title" style={{ fontWeight: 700, letterSpacing: "-0.01em", marginTop: 6, textWrap: "pretty" }}>Tell Lookout what you&apos;re looking for</div>
        <div style={{ fontSize: font.base, lineHeight: 1.5, color: "#C9C1B5", marginTop: 6, maxWidth: 620, textWrap: "pretty" }}>
          Lookout searches for new roles every week and scores each one against your profile. The more it knows about you, the better the matches on this board.
        </div>
      </div>
      <div className="setup-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))" }}>
        {tiles.map((t) => (
          // The step you're on gets a thin outline; step 3 is what happens next, so it sits on the card as plain text (#255).
          <div key={t.n} className={`setup-tile${t.n === now ? " now" : ""}${t.n === 3 ? " plain" : ""}`} aria-current={t.n === now ? "step" : undefined} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
                <div style={{ fontSize: font["4xl"], fontWeight: 700, lineHeight: 1, letterSpacing: "-0.02em", color: color.orange }}>{t.n}</div>
                {t.done && <span style={{ fontSize: font.base, fontWeight: 700, letterSpacing: ".12em", color: color.orange }}>COMPLETE</span>}
              </div>
              {t.done ? <CheckIcon stroke={color.orange} /> : <div style={{ fontSize: font.base, fontWeight: 600, color: "#A89F92" }}>{t.status}</div>}
            </div>
            <div style={{ fontSize: font.lg, fontWeight: 600 }}>{t.title}</div>
            <div style={{ fontSize: font.base, lineHeight: 1.5, color: "#C9C1B5", textWrap: "pretty", flex: 1 }}>{t.body}</div>
            {t.href && (
              <Link href={t.href} style={{ alignSelf: "flex-start", height: 34, padding: "0 14px", borderRadius: 999, background: t.done ? "rgba(255,255,255,.1)" : color.orange, color: t.done ? "#fff" : color.ink, fontSize: font.base, fontWeight: 600, marginTop: 4, display: "inline-flex", alignItems: "center", textDecoration: "none" }}>
                {t.btn}
              </Link>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
