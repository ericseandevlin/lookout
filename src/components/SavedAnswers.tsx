"use client";

import { useEffect, useState } from "react";
import type { SavedAnswer } from "@/lib/db/schema";
import { PageHead, ProfileTabs } from "./Profile";
import { btn } from "./Settings";
import { api } from "./store";

/** /profile/application: the answers auto-apply reuses on every form (#108). */
export function SavedAnswers() {
  const [list, setList] = useState<SavedAnswer[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [said, setSaid] = useState("");
  useEffect(() => {
    api<{ answers: SavedAnswer[] }>("/api/profile/apply-answers")
      .then((r) => setList(r.answers))
      .catch((e) => setErr(e instanceof Error ? e.message : "Couldn't load"));
  }, []);
  const save = async (question: string, answer: string) => {
    setErr(null);
    try {
      const r = await api<{ answers: SavedAnswer[] }>("/api/profile/apply-answers", { method: "PUT", json: { question, answer } });
      setList(r.answers);
      setSaid(answer.trim() ? `Saved "${question}".` : `Forgot "${question}".`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't save");
    }
  };
  return (
    <div className="page-pad lk-page" style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 760 }}>
      <ProfileTabs />
      <PageHead
        eyebrow="Search profile"
        title="Application answers"
        intro="Questions most applications ask, answered once. Lookout reuses these on every form it drafts. Change one here when it's no longer true, like a move or a new name."
      />
      <div aria-live="polite" style={{ fontSize: 14, color: "#6B6358", minHeight: 20 }}>{said}</div>
      {err && <div role="alert" style={{ fontSize: 14, color: "#99220F" }}>{err}</div>}
      {list && list.length === 0 && (
        <div style={{ padding: 20, borderRadius: 14, background: "#fff", border: "1.5px solid #E6E0D8", fontSize: 14, lineHeight: 1.55, color: "#3B362C" }}>
          Nothing saved yet. When you answer a question like work authorization or ZIP code on an application, it shows up here.
        </div>
      )}
      {list && list.length > 0 && (
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 10 }}>
          {list.map((s) => (
            <Row key={s.key} s={s} save={save} />
          ))}
        </ul>
      )}
    </div>
  );
}

function Row({ s, save }: { s: SavedAnswer; save: (q: string, a: string) => Promise<void> }) {
  const [v, setV] = useState(s.answer);
  const id = `sa-${s.key.replace(/\s+/g, "-").slice(0, 60)}`;
  return (
    <li style={{ padding: 16, borderRadius: 14, background: "#fff", border: "1.5px solid #E6E0D8", display: "flex", flexDirection: "column", gap: 8 }}>
      <label htmlFor={id} style={{ fontSize: 15, fontWeight: 600 }}>{s.question}</label>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <input id={id} value={v} onChange={(e) => setV(e.target.value)} maxLength={300} style={{ flex: "1 1 260px", height: 40, borderRadius: 10, border: "1.5px solid #E0D9CF", padding: "0 12px", fontSize: 15 }} />
        <button onClick={() => save(s.question, v)} disabled={!v.trim() || v === s.answer} style={btn("outline")}>Save</button>
        <button onClick={() => save(s.question, "")} style={btn("text")}>Forget</button>
      </div>
      <div style={{ fontSize: 14, color: "#6B6358" }}>Last changed {new Date(s.updatedAt).toLocaleDateString()}</div>
    </li>
  );
}
