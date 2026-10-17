"use client";

import { useEffect, useState } from "react";
import type { SavedAnswer, SkillNote } from "@/lib/db/schema";
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
        intro="What Lookout reuses on every application: answers to questions most forms ask, and experience notes behind your skills. Change one here when it's no longer true, like a move or a new name."
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
      <ExperienceNotes />
    </div>
  );
}

/** Skills added while reviewing keywords, with the experience behind them (#121). */
function ExperienceNotes() {
  const [notes, setNotes] = useState<SkillNote[] | null>(null);
  const [said, setSaid] = useState("");
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    api<{ notes: SkillNote[] }>("/api/profile/skill-notes")
      .then((r) => setNotes(r.notes))
      .catch((e) => setErr(e instanceof Error ? e.message : "Couldn't load"));
  }, []);
  const save = async (skill: string, story: string, forget = false) => {
    setErr(null);
    try {
      const r = await api<{ notes: SkillNote[] }>("/api/profile/skill-notes", { method: "PUT", json: { skill, story, forget } });
      setNotes(r.notes);
      setSaid(forget ? `Forgot "${skill}".` : `Saved "${skill}".`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't save");
    }
  };
  return (
    <section aria-labelledby="xp-notes" style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 18 }}>
      <h2 id="xp-notes" style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>Experience notes</h2>
      <p style={{ margin: 0, fontSize: 14, lineHeight: 1.55, color: "#6B6358" }}>
        Skills you told Lookout you have, and where they come from. Your resume can&apos;t hold everything; these count as facts in every resume, cover letter and answer Lookout drafts.
      </p>
      <div aria-live="polite" style={{ fontSize: 14, color: "#6B6358", minHeight: 20 }}>{said}</div>
      {err && <div role="alert" style={{ fontSize: 14, color: "#99220F" }}>{err}</div>}
      {notes && notes.length === 0 && (
        <div style={{ padding: 20, borderRadius: 14, background: "#fff", border: "1.5px solid #E6E0D8", fontSize: 14, lineHeight: 1.55, color: "#3B362C" }}>
          None yet. On an application&apos;s keyword list, click a struck-through keyword you do have and tell Lookout where it comes from.
        </div>
      )}
      {notes && notes.length > 0 && (
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 10 }}>
          {notes.map((n) => (
            <NoteRow key={n.skill} n={n} save={save} />
          ))}
        </ul>
      )}
    </section>
  );
}

function NoteRow({ n, save }: { n: SkillNote; save: (skill: string, story: string, forget?: boolean) => Promise<void> }) {
  const [v, setV] = useState(n.story);
  const id = `xn-${n.skill.replace(/\W+/g, "-").slice(0, 60)}`;
  return (
    <li style={{ padding: 16, borderRadius: 14, background: "#fff", border: "1.5px solid #E6E0D8", display: "flex", flexDirection: "column", gap: 8 }}>
      <label htmlFor={id} style={{ fontSize: 15, fontWeight: 600 }}>{n.skill}</label>
      <textarea id={id} value={v} onChange={(e) => setV(e.target.value)} rows={2} maxLength={1500} placeholder="Where does this come from? A role, a project, a result." style={{ borderRadius: 10, border: "1.5px solid #E0D9CF", padding: 10, fontSize: 15, fontFamily: "inherit", resize: "vertical" }} />
      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={() => save(n.skill, v)} disabled={v === n.story} style={btn("outline")}>Save</button>
        <button onClick={() => save(n.skill, "", true)} style={btn("text")}>Forget</button>
      </div>
    </li>
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
