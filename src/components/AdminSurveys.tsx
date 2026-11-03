"use client";

import { useCallback, useEffect, useState } from "react";
import type { SurveyKind } from "@/lib/db/schema";
import { Tabs } from "./Admin";
import { PageHead } from "./Profile";
import { btn, Row, Section, Seg } from "./Settings";
import { api } from "./store";

type Question = { id: string; kind: SurveyKind; prompt: string; options: string[]; active: boolean; createdAt: string; answers: number; skipped: number };
type State = { questions: Question[]; config: { everyDays: number } };
type Reply = { email: string; name: string; answer: string | null; at: string };

const KIND_LABEL: Record<SurveyKind, string> = { choice: "Multiple choice", scale: "1 to 5", text: "Short text" };
const card: React.CSSProperties = { background: "#fff", borderRadius: 16, padding: "16px 18px", display: "flex", flexDirection: "column", gap: 8 };
const field: React.CSSProperties = { width: "100%", maxWidth: 520, border: "1.5px solid #E6E0D8", background: "#fff", borderRadius: 10, padding: "10px 13px", fontSize: 14, color: "#1D1A0F", fontFamily: "inherit" };
const day = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

/** /admin/surveys: one-question beta surveys from Eric (#5). */
export function AdminSurveys() {
  const [s, setS] = useState<State | null>(null);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [kind, setKind] = useState<SurveyKind>("scale");
  const [prompt, setPrompt] = useState("");
  const [options, setOptions] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [replies, setReplies] = useState<Reply[] | null>(null);

  const call = useCallback(async (p: Promise<State>, ok?: string) => {
    setMsg(null);
    try {
      setS(await p);
      if (ok) setMsg({ text: ok, ok: true });
      return true;
    } catch (e) {
      setMsg({ text: e instanceof Error ? e.message : "Couldn't save", ok: false });
      return false;
    }
  }, []);
  useEffect(() => {
    api<State>("/api/admin/surveys")
      .then(setS)
      .catch((e) => setMsg({ text: e instanceof Error ? e.message : "Couldn't load", ok: false }));
  }, []);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    const ok = await call(api<State>("/api/admin/surveys", { method: "POST", json: { kind, prompt, options: options.split("\n") } }), "Added. People see it the next time a question is due for them.");
    if (ok) {
      setPrompt("");
      setOptions("");
    }
  };
  const toggle = async (q: Question) => {
    setMsg(null);
    try {
      await api(`/api/admin/surveys/${q.id}`, { method: "PATCH", json: { active: !q.active } });
      await call(api<State>("/api/admin/surveys"), q.active ? "Turned off. Nobody new is asked." : "Turned on.");
    } catch (e) {
      setMsg({ text: e instanceof Error ? e.message : "Couldn't save", ok: false });
    }
  };
  const show = async (id: string) => {
    if (open === id) return setOpen(null);
    setOpen(id);
    setReplies(null);
    setReplies(await api<{ rows: Reply[] }>(`/api/admin/surveys/${id}`).then((r) => r.rows).catch(() => []));
  };

  return (
    <div className="page-pad settings lk-page" style={{ display: "flex", flexDirection: "column", maxWidth: 900, gap: 4 }}>
      <PageHead eyebrow="Admin" title="Surveys" intro="One question at a time, signed as a note from you. Each person sees at most one every few days; skipping counts, so nobody is asked twice.">
        <Tabs />
      </PageHead>
      {msg && (
        <div aria-live="polite" style={{ fontSize: 14, color: msg.ok ? "#35662A" : "#99220F" }}>
          {msg.text}
        </div>
      )}
      {s && (
        <>
          <Section>How often</Section>
          <Row title="Ask each person at most once every" help="New accounts wait this long before their first question.">
            <Seg opts={[["3 days", 3], ["5 days", 5], ["7 days", 7], ["14 days", 14]]} cur={s.config.everyDays} pick={(v) => call(api<State>("/api/admin/surveys", { method: "PUT", json: { everyDays: v } }), `Saved: every ${v} days.`)} />
          </Row>

          <Section>New question</Section>
          <form onSubmit={create} style={{ ...card, gap: 12 }}>
            <Seg opts={(Object.keys(KIND_LABEL) as SurveyKind[]).map((k) => [KIND_LABEL[k], k])} cur={kind} pick={setKind} />
            <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 14, fontWeight: 600 }}>
              Question
              <input value={prompt} onChange={(e) => setPrompt(e.target.value)} maxLength={300} placeholder="How useful were this week's finds?" className="f-brick" style={field} />
            </label>
            {kind === "choice" && (
              <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 14, fontWeight: 600 }}>
                Choices, one per line (2 to 8)
                <textarea value={options} onChange={(e) => setOptions(e.target.value)} rows={4} className="f-brick" style={field} />
              </label>
            )}
            <div>
              <button type="submit" disabled={prompt.trim().length < 3} style={btn("solid")}>
                Add question
              </button>
            </div>
          </form>

          <Section>Questions</Section>
          {!s.questions.length && <div style={{ fontSize: 14, color: "#6B6358" }}>No questions yet.</div>}
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {s.questions.map((q) => (
              <div key={q.id} style={card}>
                <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
                  <div style={{ flex: "1 1 300px", fontSize: 15, fontWeight: 600 }}>{q.prompt}</div>
                  <span style={{ fontSize: 14, fontWeight: 600, color: q.active ? "#35662A" : "#6B6358" }}>{q.active ? "On" : "Off"}</span>
                </div>
                <div style={{ fontSize: 14, color: "#6B6358" }}>
                  {KIND_LABEL[q.kind]}
                  {q.options.length ? `: ${q.options.join(" · ")}` : ""} · added {day(q.createdAt)} · {q.answers} {q.answers === 1 ? "answer" : "answers"}, {q.skipped} skipped
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button onClick={() => toggle(q)} style={{ ...btn("outline"), height: 34 }}>
                    {q.active ? "Turn off" : "Turn on"}
                  </button>
                  <button onClick={() => show(q.id)} aria-expanded={open === q.id} style={{ ...btn("text"), height: 34 }}>
                    {open === q.id ? "Hide answers" : "See answers"}
                  </button>
                  {q.answers + q.skipped > 0 && (
                    <a href={`/api/admin/surveys/${q.id}?format=csv`} style={{ ...btn("text"), height: 34, display: "inline-flex", alignItems: "center" }}>
                      Export CSV
                    </a>
                  )}
                </div>
                {open === q.id &&
                  (replies === null ? (
                    <div style={{ fontSize: 14, color: "#6B6358" }}>Loading…</div>
                  ) : !replies.length ? (
                    <div style={{ fontSize: 14, color: "#6B6358" }}>No answers yet.</div>
                  ) : (
                    <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 6 }}>
                      {replies.map((r, i) => (
                        <li key={i} style={{ fontSize: 14, borderTop: "1px solid #F2EEE8", paddingTop: 6 }}>
                          <strong>{r.answer ?? <span style={{ color: "#6B6358", fontWeight: 400 }}>Skipped</span>}</strong>
                          <span style={{ color: "#6B6358" }}>
                            {" "}
                            · {r.name || r.email} · {day(r.at)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ))}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
