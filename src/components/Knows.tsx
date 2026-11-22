"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { FactKind, FactSource } from "@/lib/db/schema";
import { PageHead, ProfileTabs } from "./Profile";
import { FormAnswers } from "./SavedAnswers";
import { btn } from "./Settings";
import { useConfirm } from "./Confirm";
import { api, useStore } from "./store";
import { color, font } from "@/lib/tokens";

type Fact = { id: string; text: string; kind: FactKind; source: FactSource; quote: string; turnId: string | null; shareable: boolean; lockReason: string | null; createdAt: string };

const KIND: Record<FactKind, [string, string]> = {
  result: ["Result", "Results"],
  skill: ["Skill", "Skills"],
  project: ["Project", "Projects"],
  background: ["Background", "Background"],
  next_role: ["Next role", "Next role"],
  dealbreaker: ["Dealbreaker", "Dealbreakers"],
  pay: ["Pay", "Pay"],
};

const card: React.CSSProperties = { background: "#fff", border: `1.5px solid ${color.border}`, borderRadius: 14, padding: 20 };
/** Earlier facts show this many at a time. */
const PAGE = 20;
const day = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
const isToday = (iso: string) => new Date(iso).toDateString() === new Date().toDateString();
const short = (s: string, n = 60) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

const RULES: [string, string][] = [
  ["People you mention", "stored by role, never by name. A name becomes \"my manager\"."],
  ["Complaints about people or employers", "kept as background so Lookout understands you. Never used in writing."],
  ["Your employer's confidential details", "kept private (targets, client names, unreleased plans)."],
  ["Personal life", "kept private (health, family, pay, political or religious beliefs)."],
  ["Skills, projects and results", "shareable and usable in drafts. You can still make any one private."],
];

/** Profile > What Lookout knows (#1449): every fact, its source, and who can see it. */
export function Knows() {
  const ask = useConfirm();
  const { state } = useStore();
  const resume = state.materials.resume;
  const [facts, setFacts] = useState<Fact[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [kind, setKind] = useState<FactKind | "all">("all");
  const [who, setWho] = useState<"all" | "shareable" | "private">("all");

  useEffect(() => {
    api<{ facts: Fact[] }>("/api/facts").then((d) => setFacts(d.facts)).catch((e) => setErr(e instanceof Error ? e.message : "Couldn't load your facts"));
  }, []);

  const patch = async (id: string, p: { text?: string; shareable?: boolean }) => {
    setErr(null);
    try {
      const { fact } = await api<{ fact: Pick<Fact, "id" | "text" | "shareable" | "lockReason"> }>(`/api/facts/${id}`, { method: "PATCH", json: p });
      setFacts((fs) => fs?.map((f) => (f.id === id ? { ...f, ...fact } : f)) ?? null);
      return true;
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't save that");
      return false;
    }
  };

  const remove = async (f: Fact) => {
    if (!(await ask({ eyebrow: "Delete fact", title: "Delete this fact?", body: `"${short(f.text, 120)}" goes for good. Lookout won't use it in any later draft.`, confirmLabel: "Delete", danger: true }))) return;
    setErr(null);
    try {
      await api(`/api/facts/${f.id}`, { method: "DELETE" });
      setFacts((fs) => fs?.filter((x) => x.id !== f.id) ?? null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't delete it");
    }
  };

  // A long list shows 20 earlier facts at a time; a search shows every match.
  const [earlierShown, setEarlierShown] = useState(PAGE);
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (facts ?? []).filter(
      (f) => (kind === "all" || f.kind === kind) && (who === "all" || (who === "private") !== f.shareable) && (!needle || f.text.toLowerCase().includes(needle) || f.quote.toLowerCase().includes(needle)),
    );
  }, [facts, q, kind, who]);

  const kinds = (Object.keys(KIND) as FactKind[]).filter((k) => facts?.some((f) => f.kind === k));
  const nPrivate = facts?.filter((f) => !f.shareable).length ?? 0;
  const groups: [string, Fact[]][] = [
    ["Added today", shown.filter((f) => isToday(f.createdAt))],
    ["Earlier", shown.filter((f) => !isToday(f.createdAt))],
  ];

  return (
    <div className="page-pad lk-page w-page" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <ProfileTabs />
      <PageHead
        eyebrow="Search profile"
        title="What Lookout knows about you"
        intro="Every fact Lookout uses, in your words. Shareable facts can go into your drafts; private ones never leave Lookout."
      />
      {/* The resume is read too, so say so: a short list of facts alone looked like it wasn't (#1531). */}
      {resume?.status === "done" && (
        <div style={{ ...card, padding: "12px 20px", display: "flex", alignItems: "center", gap: 12, fontSize: font.base }}>
          <span style={{ flex: 1, minWidth: 0 }}>
            <strong>Your resume</strong> <span style={{ color: color.t2 }}>· {resume.name} · read in full</span>
          </span>
          <Link href="/profile/materials" style={{ color: color.brick, fontWeight: 600, flex: "none" }}>
            View
          </Link>
        </div>
      )}
      {err && <div role="alert" style={{ fontSize: font.base, color: color.brick }}>{err}</div>}
      {!facts && !err && <div style={{ fontSize: font.base, color: color.t2 }}>Loading what Lookout knows…</div>}
      {facts && facts.length === 0 && (
        <div style={{ ...card, fontSize: font.base, lineHeight: 1.5 }}>
          Nothing yet. <Link href="/interview" style={{ color: color.brick, fontWeight: 600 }}>Answer a question in the interview</Link> and what you say shows up here.
        </div>
      )}
      {facts && facts.length > 0 && (
        <>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <div style={{ fontSize: font.xl, fontWeight: 700 }}>
                {facts.length} {facts.length === 1 ? "fact" : "facts"}
                {nPrivate > 0 && <span style={{ fontSize: font.base, fontWeight: 500, color: color.t2 }}> · {nPrivate} private</span>}
              </div>
              <div className="focus-box" style={{ marginLeft: "auto", display: "flex", alignItems: "center", background: color.surface, borderRadius: 999, padding: "0 14px", height: 36, minWidth: 0, flex: "0 1 260px" }}>
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search your facts" aria-label="Search your facts" style={{ flex: 1, minWidth: 0, background: "transparent", border: 0, outline: "none", fontSize: font.base, color: color.ink }} />
              </div>
            </div>
            <Pills label="Type" value={kind} onChange={setKind} options={[["all", "All types"], ...kinds.map((k) => [k, `${KIND[k][1]} (${facts.filter((f) => f.kind === k).length})`] as [FactKind, string])]} />
            <Pills
              label="Who can see it"
              value={who}
              onChange={setWho}
              options={[["all", "Shareable and private"], ["shareable", `Shareable only (${facts.length - nPrivate})`], ["private", `Private only (${nPrivate})`]]}
            />
          </div>
          {shown.length === 0 && <div style={{ fontSize: font.base, color: color.t2 }}>No facts match. Clear the search or the filters.</div>}
          {groups.map(([title, list]) =>
            list.length ? (
              <section key={title} aria-label={title} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <h2 style={{ margin: "6px 0 0", fontSize: font.base, fontWeight: 700, letterSpacing: ".12em", textTransform: "uppercase", color: color.t2 }}>{title}</h2>
                {(title === "Earlier" && !q.trim() ? list.slice(0, earlierShown) : list).map((f) => (
                  <Row key={f.id} f={f} onPatch={(p) => patch(f.id, p)} onDelete={() => remove(f)} />
                ))}
                {title === "Earlier" && !q.trim() && list.length > earlierShown && (
                  <div>
                    <button onClick={() => setEarlierShown((n) => n + PAGE)} style={{ ...btn("outline"), fontSize: font.base }}>
                      Show {Math.min(PAGE, list.length - earlierShown)} more ({list.length - earlierShown} not shown)
                    </button>
                  </div>
                )}
              </section>
            ) : null,
          )}
        </>
      )}
      {/* Saved application answers live here too, so everything Lookout collected is in one place (#1531). */}
      {state.user.autoApply && <FormAnswers heading />}
      <section aria-labelledby="rules-title" style={{ ...card, display: "flex", flexDirection: "column", gap: 10, marginTop: 8 }}>
        <h2 id="rules-title" style={{ margin: 0, fontSize: font.lg, fontWeight: 700 }}>Rules Lookout applies by itself</h2>
        <ul style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 6, fontSize: font.base, lineHeight: 1.45 }}>
          {RULES.map(([k, v]) => (
            <li key={k}>
              <strong>{k}</strong>: {v}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function Pills<T extends string>({ label, value, onChange, options }: { label: string; value: T; onChange: (v: T) => void; options: [T, string][] }) {
  return (
    <div role="group" aria-label={label} style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
      <span style={{ fontSize: font.sm, fontWeight: 600, color: color.t2, marginRight: 4 }}>{label}</span>
      {options.map(([v, l]) => (
        <button key={v} onClick={() => onChange(v)} aria-pressed={value === v} style={{ height: 30, padding: "0 12px", borderRadius: 999, border: `1.5px solid ${value === v ? color.ink : color.border}`, background: value === v ? color.ink : "#fff", color: value === v ? "#fff" : color.ink, fontSize: font.sm, fontWeight: 600, cursor: "pointer" }}>
          {l}
        </button>
      ))}
    </div>
  );
}

function sourceLine(f: Fact) {
  if (f.source === "resume") return "From your resume.";
  if (f.source === "setup") return `From your setup answers${f.turnId ? `, ${day(f.createdAt)}` : ""}.`;
  return `From the interview, ${day(f.createdAt)}.`;
}

function Row({ f, onPatch, onDelete }: { f: Fact; onPatch: (p: { text?: string; shareable?: boolean }) => Promise<boolean>; onDelete: () => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(f.text);
  const [saving, setSaving] = useState(false);
  const save = async () => {
    if (!draft.trim()) return;
    setSaving(true);
    if (await onPatch({ text: draft.trim() })) setEditing(false);
    setSaving(false);
  };
  const pay = f.kind === "pay";
  return (
    <article style={{ ...card, padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 300px", minWidth: 0, display: "flex", flexDirection: "column", gap: 6 }}>
          {editing ? (
            <>
              <label htmlFor={`fact-${f.id}`} className="sr-only" style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>Fact</label>
              <textarea id={`fact-${f.id}`} value={draft} onChange={(e) => setDraft(e.target.value)} rows={2} maxLength={1000} autoFocus style={{ width: "100%", boxSizing: "border-box", padding: "8px 10px", borderRadius: 8, border: `1.5px solid ${color.border}`, fontSize: font.base, lineHeight: 1.45, resize: "vertical" }} />
            </>
          ) : (
            <div style={{ fontSize: font.md, lineHeight: 1.45, fontWeight: 500 }}>{f.text}</div>
          )}
          <div style={{ fontSize: font.sm, color: color.t2, lineHeight: 1.45 }}>
            {sourceLine(f)}{" "}
            {f.quote && f.turnId ? (
              <Link href={`/interview#turn-${f.turnId}`} style={{ color: color.brick }}>&ldquo;{short(f.quote)}&rdquo;</Link>
            ) : f.quote ? (
              <span>&ldquo;{short(f.quote)}&rdquo;</span>
            ) : null}
          </div>
        </div>
        <span style={{ flex: "none", fontSize: font.xs, fontWeight: 600, padding: "3px 8px", borderRadius: 6, background: color.surface, color: "#3B362C" }}>{KIND[f.kind][0]}</span>
        <div role="group" aria-label="Who can see it" style={{ flex: "none", display: "flex", borderRadius: 999, border: `1.5px solid ${color.border}`, overflow: "hidden" }}>
          {([true, false] as const).map((v) => (
            <button
              key={String(v)}
              onClick={() => f.shareable !== v && onPatch({ shareable: v })}
              aria-pressed={f.shareable === v}
              disabled={pay && v}
              title={pay && v ? "Pay always stays private" : undefined}
              style={{ height: 30, padding: "0 12px", border: 0, background: f.shareable === v ? (v ? color.green : color.ink) : "#fff", color: f.shareable === v ? "#fff" : pay && v ? color.t3 : color.ink, fontSize: font.sm, fontWeight: 600, cursor: pay && v ? "not-allowed" : "pointer" }}
            >
              {v ? "Shareable" : "Private"}
            </button>
          ))}
        </div>
      </div>
      {!f.shareable && f.lockReason && (
        <div style={{ fontSize: font.sm, lineHeight: 1.45, color: color.peachInk, background: "#FDF1E6", borderRadius: 8, padding: "7px 10px" }}>
          {pay ? "Always private" : "Kept private by Lookout"}: {f.lockReason}
        </div>
      )}
      <div style={{ display: "flex", gap: 6 }}>
        {editing ? (
          <>
            <button onClick={save} disabled={saving || !draft.trim()} style={{ ...btn("solid"), height: 32 }}>{saving ? "Saving…" : "Save"}</button>
            <button onClick={() => { setEditing(false); setDraft(f.text); }} style={{ ...btn("text"), height: 32 }}>Cancel</button>
          </>
        ) : (
          <>
            <button onClick={() => { setDraft(f.text); setEditing(true); }} aria-label={`Edit: ${short(f.text, 40)}`} style={{ ...btn("text"), height: 32, paddingLeft: 0 }}>Edit</button>
            <button onClick={onDelete} aria-label={`Delete: ${short(f.text, 40)}`} style={{ ...btn("text"), height: 32, color: color.brick }}>Delete</button>
          </>
        )}
      </div>
    </article>
  );
}
