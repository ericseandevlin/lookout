"use client";

import { useEffect, useState } from "react";
import type { PersonalStory, SavedAnswer, SkillNote } from "@/lib/db/schema";
import { PageHead, ProfileTabs } from "./Profile";
import { btn } from "./Settings";
import { api } from "./store";
import { EEO_CATEGORIES, EEO_CHOICES, type EeoCategory } from "@/lib/application/eeo";
import { useConfirm } from "./Confirm";
import { color } from "@/lib/tokens";
import { STORY_PROMPTS, STORY_THEMES, type StoryTheme } from "@/lib/application/stories";

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
    <div className="page-pad lk-page w-page" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <ProfileTabs />
      <PageHead
        eyebrow="Search profile"
        title="Application answers"
        intro="What Lookout reuses on every application: answers to questions most forms ask, experience notes behind your skills, and personal stories for cover letters. Change one here when it's no longer true, like a move or a new name."
      />
      <div aria-live="polite" style={{ fontSize: 14, color: color.t2, minHeight: 20 }}>{said}</div>
      {err && <div role="alert" style={{ fontSize: 14, color: color.brick }}>{err}</div>}
      {list && list.length === 0 && (
        <div style={{ padding: 20, borderRadius: 14, background: "#fff", border: `1.5px solid ${color.border}`, fontSize: 14, lineHeight: 1.55, color: "#3B362C" }}>
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
      <PersonalStories />
      <EeoAnswers />
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
      <p style={{ margin: 0, fontSize: 14, lineHeight: 1.55, color: color.t2 }}>
        Skills you told Lookout you have, and where they come from. Your resume can&apos;t hold everything; these count as facts in every resume, cover letter and answer Lookout drafts.
      </p>
      <div aria-live="polite" style={{ fontSize: 14, color: color.t2, minHeight: 20 }}>{said}</div>
      {err && <div role="alert" style={{ fontSize: 14, color: color.brick }}>{err}</div>}
      {notes && notes.length === 0 && (
        <div style={{ padding: 20, borderRadius: 14, background: "#fff", border: `1.5px solid ${color.border}`, fontSize: 14, lineHeight: 1.55, color: "#3B362C" }}>
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
    <li style={{ padding: 16, borderRadius: 14, background: "#fff", border: `1.5px solid ${color.border}`, display: "flex", flexDirection: "column", gap: 8 }}>
      <label htmlFor={id} style={{ fontSize: 15, fontWeight: 600 }}>{n.skill}</label>
      <textarea id={id} value={v} onChange={(e) => setV(e.target.value)} rows={2} maxLength={1500} placeholder="Where does this come from? A role, a project, a result." style={{ borderRadius: 10, border: `1.5px solid ${color.border}`, padding: 10, fontSize: 15, fontFamily: "inherit", resize: "vertical" }} />
      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={() => save(n.skill, v)} disabled={v === n.story} style={btn("outline")}>Save</button>
        <button onClick={() => save(n.skill, "", true)} style={btn("text")}>Forget</button>
      </div>
    </li>
  );
}

type StoryEdit = { id?: string; theme: StoryTheme; story: string; forget?: true };

/** Personal connection stories (#155): true moments a cover letter can open with. Lookout never makes one up. */
function PersonalStories() {
  const [stories, setStories] = useState<PersonalStory[] | null>(null);
  const [said, setSaid] = useState("");
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    api<{ stories: PersonalStory[] }>("/api/profile/stories")
      .then((r) => setStories(r.stories))
      .catch((e) => setErr(e instanceof Error ? e.message : "Couldn't load"));
  }, []);
  const save = async (s: StoryEdit) => {
    setErr(null);
    try {
      const r = await api<{ stories: PersonalStory[] }>("/api/profile/stories", { method: "PUT", json: s.forget ? { id: s.id, forget: true } : s });
      setStories(r.stories);
      setSaid(s.forget ? "Forgot that story." : "Saved your story.");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't save");
    }
  };
  return (
    <section aria-labelledby="stories" style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 18 }}>
      <h2 id="stories" style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>Personal stories</h2>
      <p style={{ margin: 0, fontSize: 14, lineHeight: 1.55, color: color.t2 }}>
        One true, personal line makes a cover letter stand out. When a company&apos;s work matches one of these, the letter opens with it. If none fits, Lookout asks you instead of making one up. Only add what really happened; interviewers ask about it.
      </p>
      <div style={{ fontSize: 14, lineHeight: 1.55, color: "#3B362C" }}>
        Some places to start:
        <ul style={{ margin: "4px 0 0", paddingLeft: 20 }}>
          {STORY_PROMPTS.map((q) => (
            <li key={q}>{q}</li>
          ))}
        </ul>
      </div>
      <div aria-live="polite" style={{ fontSize: 14, color: color.t2, minHeight: 20 }}>{said}</div>
      {err && <div role="alert" style={{ fontSize: 14, color: color.brick }}>{err}</div>}
      {stories && (
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 10 }}>
          {stories.map((s) => (
            <StoryRow key={s.id} s={s} save={save} />
          ))}
          <StoryRow key={`new-${stories.length}`} save={save} />
        </ul>
      )}
    </section>
  );
}

function StoryRow({ s, save }: { s?: PersonalStory; save: (s: StoryEdit) => Promise<void> }) {
  const [theme, setTheme] = useState<StoryTheme>(s?.theme ?? "other");
  const [v, setV] = useState(s?.story ?? "");
  const id = `ps-${s?.id ?? "new"}`;
  const changed = v.trim() !== (s?.story ?? "") || theme !== (s?.theme ?? "other");
  return (
    <li style={{ padding: 16, borderRadius: 14, background: "#fff", border: `1.5px solid ${color.border}`, display: "flex", flexDirection: "column", gap: 8 }}>
      <label htmlFor={id} style={{ fontSize: 15, fontWeight: 600 }}>{s ? "Your story" : "Add a story"}</label>
      <textarea id={id} value={v} onChange={(e) => setV(e.target.value)} rows={3} maxLength={1500} placeholder="What happened, in your own words. For example: my grandmother kept living alone for years because of her medical alert pendant." style={{ borderRadius: 10, border: `1.5px solid ${color.border}`, padding: 10, fontSize: 15, fontFamily: "inherit", resize: "vertical" }} />
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <label htmlFor={`${id}-theme`} style={{ fontSize: 14, color: color.t2 }}>Theme</label>
        <select id={`${id}-theme`} value={theme} onChange={(e) => setTheme(e.target.value as StoryTheme)} style={{ height: 40, borderRadius: 10, border: `1.5px solid ${color.border}`, padding: "0 10px", fontSize: 15, background: "#fff" }}>
          {STORY_THEMES.map((t) => (
            <option key={t} value={t}>{t[0].toUpperCase() + t.slice(1)}</option>
          ))}
        </select>
        <button onClick={() => save({ id: s?.id, theme, story: v })} disabled={!v.trim() || !changed} style={btn("outline")}>{s ? "Save" : "Add"}</button>
        {s && <button onClick={() => save({ id: s.id, theme, story: "", forget: true })} style={btn("text")}>Forget</button>}
      </div>
    </li>
  );
}

function Row({ s, save }: { s: SavedAnswer; save: (q: string, a: string) => Promise<void> }) {
  const [v, setV] = useState(s.answer);
  const id = `sa-${s.key.replace(/\s+/g, "-").slice(0, 60)}`;
  return (
    <li style={{ padding: 16, borderRadius: 14, background: "#fff", border: `1.5px solid ${color.border}`, display: "flex", flexDirection: "column", gap: 8 }}>
      <label htmlFor={id} style={{ fontSize: 15, fontWeight: 600 }}>{s.question}</label>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <input id={id} value={v} onChange={(e) => setV(e.target.value)} maxLength={300} style={{ flex: "1 1 260px", height: 40, borderRadius: 10, border: `1.5px solid ${color.border}`, padding: "0 12px", fontSize: 15 }} />
        <button onClick={() => save(s.question, v)} disabled={!v.trim() || v === s.answer} style={btn("outline")}>Save</button>
        <button onClick={() => save(s.question, "")} style={btn("text")}>Forget</button>
      </div>
      <div style={{ fontSize: 14, color: color.t2 }}>Last changed {new Date(s.updatedAt).toLocaleDateString()}</div>
    </li>
  );
}

type EeoState = { consent: boolean; answers: Partial<Record<EeoCategory, string>>; saved: number };

/** Voluntary self-identification (#122): opt-in, encrypted, never shared with an AI, deletable. */
function EeoAnswers() {
  const ask = useConfirm();
  const [st, setSt] = useState<EeoState | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [said, setSaid] = useState("");
  useEffect(() => {
    api<EeoState>("/api/profile/eeo")
      .then(setSt)
      .catch((e) => setErr(e instanceof Error ? e.message : "Couldn't load"));
  }, []);
  const put = async (patch: { consent?: boolean; answers?: Partial<Record<EeoCategory, string>> }, msg: string) => {
    setErr(null);
    try {
      setSt(await api<EeoState>("/api/profile/eeo", { method: "PUT", json: patch }));
      setSaid(msg);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't save");
    }
  };
  const wipe = async () => {
    const ok = await ask({ eyebrow: "EEO answers", title: "Delete all your EEO answers?", body: "Lookout forgets every answer and stops filling these questions. You can set them again any time.", confirmLabel: "Delete them", danger: true });
    if (!ok) return;
    try {
      setSt(await api<EeoState>("/api/profile/eeo", { method: "DELETE" }));
      setSaid("Deleted.");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't delete");
    }
  };
  return (
    <section aria-labelledby="eeo-h" style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 18 }}>
      <h2 id="eeo-h" style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>Voluntary self-identification (EEO)</h2>
      <p style={{ margin: 0, fontSize: 14, lineHeight: 1.55, color: color.t2 }}>
        Many applications ask optional questions about gender, race, veteran and disability status. If you want, Lookout can answer them the same way every time. Your answers are encrypted, matched to each form in code, and never shared with an AI. Leave any blank, or pick &ldquo;Decline to self-identify&rdquo;.
      </p>
      <div aria-live="polite" style={{ fontSize: 14, color: color.t2, minHeight: 20 }}>{said}</div>
      {err && <div role="alert" style={{ fontSize: 14, color: color.brick }}>{err}</div>}
      {st && (
        <div style={{ padding: 18, borderRadius: 14, background: "#fff", border: `1.5px solid ${color.border}`, display: "flex", flexDirection: "column", gap: 14 }}>
          <label style={{ display: "flex", gap: 10, alignItems: "flex-start", fontSize: 15, fontWeight: 600, cursor: "pointer" }}>
            <input type="checkbox" checked={st.consent} onChange={(e) => put({ consent: e.target.checked }, e.target.checked ? "Lookout will fill EEO questions with these answers." : "Lookout will leave EEO questions blank.")} style={{ width: 20, height: 20, marginTop: 1 }} />
            <span>
              Let Lookout fill EEO questions with these answers
              <span style={{ display: "block", fontSize: 14, fontWeight: 400, color: color.t2 }}>Off: Lookout leaves every EEO question blank for you to answer, or skip, yourself.</span>
            </span>
          </label>
          {EEO_CATEGORIES.map((c) => (
            <div key={c} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <label htmlFor={`eeo-p-${c}`} style={{ fontSize: 15, fontWeight: 600 }}>{EEO_CHOICES[c].label}</label>
              <select id={`eeo-p-${c}`} value={st.answers[c] ?? ""} onChange={(e) => put({ answers: { [c]: e.target.value } }, `Saved ${EEO_CHOICES[c].label.toLowerCase()}.`)} style={{ height: 40, borderRadius: 10, border: `1.5px solid ${color.border}`, padding: "0 10px", fontSize: 15, maxWidth: 420 }}>
                <option value="">Leave blank</option>
                {EEO_CHOICES[c].choices.map((o) => (
                  <option key={o}>{o}</option>
                ))}
              </select>
            </div>
          ))}
          {st.saved > 0 && <div style={{ fontSize: 14, color: color.t2 }}>Plus {st.saved} answer{st.saved === 1 ? "" : "s"} you picked for specific form wordings.</div>}
          <button onClick={wipe} style={{ ...btn("danger"), alignSelf: "flex-start" }}>Delete all EEO answers</button>
        </div>
      )}
    </section>
  );
}
