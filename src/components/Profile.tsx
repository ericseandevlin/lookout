"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, useSyncExternalStore } from "react";
import { fillTemplate, parseTemplate, type Chunk } from "@/lib/blanks";
import { BONUS_KEY, kindOf } from "@/lib/kinds";
import { WORK_MODE_LABEL } from "@/lib/onboarding";
import { searchBlocker } from "@/lib/ready";
import { togglePhrase } from "@/lib/phrases";
import { CurrentCompField } from "./CurrentComp";
import { useCounts } from "./Shell";
import { useStore } from "./store";

const inputBase: React.CSSProperties = {
  border: "1.5px solid #E6E0D8", background: "#fff", borderRadius: 10, fontSize: 14, outline: "none", color: "#1D1A0F",
};

/** Tabs across the Profile pages: what you want, what you've done, and what searches use. */
export function ProfileTabs() {
  const path = usePathname();
  const { state } = useStore();
  const tabs: [string, string][] = [["/profile", "Your answers"], ["/profile/materials", "Materials"], ["/profile/sees", "What Lookout sees"]];
  // Auto-apply beta: the answers it reuses on every application form (#108).
  if (state.user.autoApply) tabs.push(["/profile/application", "Application answers"]);
  // Each tab is its own page, so arrows move focus between tabs and Enter opens one (manual activation).
  const onKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const list = [...e.currentTarget.querySelectorAll<HTMLAnchorElement>('[role="tab"]')];
    const i = list.indexOf(document.activeElement as HTMLAnchorElement);
    const n = list.length;
    const to = ({ ArrowRight: i + 1, ArrowDown: i + 1, ArrowLeft: i - 1, ArrowUp: i - 1, Home: 0, End: n - 1 } as Record<string, number>)[e.key];
    if (to === undefined || i < 0) return;
    e.preventDefault();
    list[(to + n) % n].focus();
  };
  const anyOn = tabs.some(([href]) => href === path);
  return (
    // Drawn as tabs, not pills: one baseline, the open page underlined (#277).
    <div role="tablist" aria-label="Profile sections" onKeyDown={onKey} style={{ display: "flex", gap: 24, overflowX: "auto", overflowY: "hidden", boxShadow: "inset 0 -1px 0 #E0D9CF", marginBottom: 22 }}>
      {tabs.map(([href, label]) => {
        const on = path === href;
        return (
          <Link key={href} href={href} role="tab" className="lk-tab" aria-selected={on} tabIndex={on || (!anyOn && href === tabs[0][0]) ? 0 : -1} style={{ display: "flex", alignItems: "center", flex: "none", height: 42, padding: "0 2px", borderBottom: `2.5px solid ${on ? "#99220F" : "transparent"}`, color: on ? "#1D1A0F" : "#6B6358", fontSize: 15, fontWeight: on ? 700 : 600, whiteSpace: "nowrap", textDecoration: "none" }}>
            {label}
          </Link>
        );
      })}
    </div>
  );
}

/**
 * The one next thing a new person has to do: answers, then resume, then a first search.
 * Shown on materials and an empty board, so no step ends without a way forward. The profile has its own Next button.
 */
export function NextStep({ here }: { here: "materials" | "finds" }) {
  const { state, searchNow, fail } = useStore();
  const { answered, total } = useCounts(state);
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const rs = state.materials.resume?.status;
  const go = (fn: () => Promise<unknown>) => async () => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };
  let text = "";
  let action: { label: string; run: () => Promise<unknown> } | null = null;
  if (answered < total) {
    const left = total - answered;
    text = `Answer ${left === 1 ? "the last question" : `the ${left} questions left`} so Lookout knows what to look for.`;
    action = { label: "Go to your answers", run: async () => router.push("/profile") };
  } else if (rs !== "done") {
    text = rs === "scanning" ? "Reading your resume. This takes about a minute." : rs === "failed" ? "Lookout couldn't read your resume. Try a PDF or Word file." : "Next, add your resume. Lookout reads it to know what you've done.";
    if (here !== "materials" && rs !== "scanning")
      action = { label: "Next: add your resume", run: async () => router.push("/profile/materials") };
  } else if (state.finds.length === 0) {
    if (state.running) text = "Your first search is running. Finds show up on your board as they come in.";
    else {
      text = "You're set. Run your first search now; after that Lookout searches on your schedule.";
      action = { label: "Run my first search", run: async () => { await searchNow(); if (here !== "finds") router.push("/finds"); } };
    }
  }
  if (!text) return null;
  return (
    <div role="status" style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", padding: "14px 16px", borderRadius: 12, background: "#FFF4F1", border: "1.5px solid #F0C9BF" }}>
      <div style={{ flex: "1 1 240px", fontSize: 14.5, lineHeight: 1.45, color: "#3B362C" }}>{text}</div>
      {action && (
        <button onClick={go(action.run)} disabled={busy} style={{ height: 42, padding: "0 20px", borderRadius: 10, border: 0, background: "#99220F", color: "#fff", fontSize: 14.5, fontWeight: 600, cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1 }}>
          {busy ? "One moment…" : `${action.label} →`}
        </button>
      )}
    </div>
  );
}

export function PageHead({ eyebrow, title, intro, children }: { eyebrow: string; title: string; intro?: string; children?: React.ReactNode }) {
  return (
    <div style={{ padding: "8px 0" }}>
      <div style={{ fontSize: 14, fontWeight: 700, letterSpacing: ".14em", textTransform: "uppercase", color: "#99220F" }}>{eyebrow}</div>
      <h1 style={{ margin: "8px 0 0", fontSize: 30, fontWeight: 700, letterSpacing: "-0.02em" }}>{title}</h1>
      {intro && <p style={{ margin: "8px 0 0", fontSize: 14.5, lineHeight: 1.5, color: "#6B6358", maxWidth: 560, textWrap: "pretty" }}>{intro}</p>}
      {children}
    </div>
  );
}

const AutoTag = ({ src }: { src?: string }) =>
  src ? (
    <span style={{ fontSize: 14, fontWeight: 600, padding: "3px 8px", borderRadius: 6, background: "#FDE7D3", color: "#7A3A10" }}>Filled from {src}</span>
  ) : null;

const splitList = (v: string) => v.split(/\s*[,;\n]\s*/).map((x) => x.trim()).filter(Boolean);

const addLine = (base: string, line: string) => (!line ? base : base.trim() ? `${base.trimEnd()}\n${line}` : line);

const blankWidth = { n: "4.5em", s: "11em", t: "16em" } as const;

/**
 * A starter sentence with small inputs where the blanks are (#254). Each keystroke writes the finished
 * sentence into the answer; empty optional blanks drop out, and nothing is written until the required ones are filled.
 */
function BlankSentence({ chunks, fills, onFill, onDone }: { chunks: Chunk[]; fills: string[]; onFill: (i: number, v: string) => void; onDone: () => void }) {
  return (
    <div
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === "Escape") { e.preventDefault(); onDone(); } }}
      style={{ display: "flex", alignItems: "center", gap: "6px 10px", flexWrap: "wrap", padding: "10px 12px", borderRadius: 10, background: "#FBF8F4", border: "1.5px dashed #E0D9CF" }}
    >
      <div style={{ display: "flex", alignItems: "baseline", flexWrap: "wrap", gap: "6px 0", fontSize: 14.5, lineHeight: 1.5, flex: "1 1 auto" }}>
        {chunks.flatMap((ch, c) =>
          ch.parts.map((p, j) =>
            "blank" in p ? (
              <input
                key={`${c}-${j}`}
                autoFocus={p.blank === 0}
                value={fills[p.blank] ?? ""}
                onChange={(e) => onFill(p.blank, e.target.value)}
                inputMode={p.kind === "n" ? "decimal" : undefined}
                placeholder={p.placeholder}
                aria-label={`Blank ${p.blank + 1}${ch.optional ? " (optional)" : ""}, for example ${p.placeholder}`}
                maxLength={p.kind === "t" ? 200 : 60}
                style={{ ...inputBase, width: blankWidth[p.kind], maxWidth: "100%", height: 30, padding: "0 8px", margin: "0 4px" }}
              />
            ) : (
              <span key={`${c}-${j}`} style={{ whiteSpace: "pre-wrap" }}>{p.text}</span>
            ),
          ),
        )}
      </div>
      <button type="button" onClick={onDone} style={{ height: 30, padding: "0 12px", borderRadius: 999, border: "1.5px solid #1D1A0F", background: "#1D1A0F", color: "#fff", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>Done</button>
    </div>
  );
}

/** Chips that get someone started: fill in a sentence with blanks, or toggle common items in a list. */
function Starters({ mode, options, value, onChange }: { mode: "insert" | "toggle" | "append"; options: { label: string; text: string }[]; value: string; onChange: (v: string) => void }) {
  const [draft, setDraft] = useState<{ chunks: Chunk[]; base: string; fills: string[] } | null>(null);
  const items = splitList(value);
  const has = (t: string) =>
    mode === "append" ? value.toLowerCase().includes(t.toLowerCase()) : items.some((x) => x.toLowerCase() === t.toLowerCase());
  // Typing in the answer box itself ends the draft, so the blanks never overwrite a hand edit.
  const open = draft && value === addLine(draft.base, fillTemplate(draft.chunks, draft.fills)) ? draft : null;
  const fill = (i: number, v: string) => {
    if (!open) return;
    const fills = [...open.fills];
    fills[i] = v;
    setDraft({ ...open, fills });
    onChange(addLine(open.base, fillTemplate(open.chunks, fills)));
  };
  const pick = (t: string) => {
    if (mode === "insert") return setDraft({ chunks: parseTemplate(t), base: value, fills: [] });
    if (mode === "append") return onChange(togglePhrase(value, t));
    onChange((has(t) ? items.filter((x) => x.toLowerCase() !== t.toLowerCase()) : [...items, t]).join(", "));
  };
  return (
    <>
      <div role="group" aria-label={mode === "insert" ? "Sentence starters" : "Common answers"} style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {options.map((o) => {
          const on = mode !== "insert" && has(o.text);
          return (
            <button
              key={o.label}
              type="button"
              onClick={() => pick(o.text)}
              aria-pressed={mode !== "insert" ? on : undefined}
              style={{ height: 32, padding: "0 12px", borderRadius: 999, border: `1.5px solid ${on ? "#1D1A0F" : "#E0D9CF"}`, background: on ? "#1D1A0F" : "#fff", color: on ? "#fff" : "#1D1A0F", fontSize: 14, fontWeight: 600, cursor: "pointer" }}
            >
              {mode === "insert" ? `+ ${o.label}` : on ? `✓ ${o.label}` : o.label}
            </button>
          );
        })}
      </div>
      {open && <BlankSentence chunks={open.chunks} fills={open.fills} onFill={fill} onDone={() => setDraft(null)} />}
    </>
  );
}

const FIRST_NOTE_KEY = "lookout:profile-first-note";

function readNoteHidden() {
  try {
    return localStorage.getItem(FIRST_NOTE_KEY) ?? "";
  } catch {
    return "";
  }
}

export function Profile() {
  const { state, editAnswers, saveProfile, searchNow, fail } = useStore();
  // Questions and counts come from the profile's kind config (#8).
  const cfg = kindOf(state.profile.kind);
  const { answered, total } = useCounts(state);
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [noteClosed, setNoteClosed] = useState(false);
  // Hidden on the server render so the note doesn't flash for someone who already closed it.
  const noteStored = useSyncExternalStore(() => () => {}, readNoteHidden, () => "1");
  const showNote = answered < total && !noteClosed && !noteStored;
  const a = state.profile.answers;
  const auto = state.profile.auto;
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const str = (k: string) => (typeof a[k] === "string" ? (a[k] as string) : "");
  const arr = (k: string) => (Array.isArray(a[k]) ? (a[k] as string[]) : []);
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => editAnswers({ [k]: e.target.value }, [k]);

  const onSave = async () => {
    await saveProfile();
    setSavedAt(new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }));
  };
  const closeNote = () => {
    setNoteClosed(true);
    try {
      localStorage.setItem(FIRST_NOTE_KEY, "1");
    } catch {
      // per-device convenience only
    }
  };

  // Next opens only once the profile has been saved, then goes to the next setup step.
  const saved = !!state.profile.savedAt;
  const rs = state.materials.resume?.status;
  const canSearch = !searchBlocker(answered, rs);
  const next =
    rs !== "done" ? { label: "Next: add your resume", run: async () => router.push("/profile/materials") }
    : canSearch && state.finds.length === 0 && !state.running ? { label: "Next: run my first search", run: async () => { await searchNow(); router.push("/finds"); } }
    : { label: "Next: your finds", run: async () => router.push("/finds") };
  const onNext = async () => {
    setBusy(true);
    try {
      await saveProfile();
      await next.run();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page-pad lk-page w-page" style={{ display: "flex", flexWrap: "wrap", gap: 24, alignItems: "flex-start" }}>
      <div style={{ flex: "1 1 520px", minWidth: 0, display: "flex", flexDirection: "column", gap: 16 }}>
        <ProfileTabs />
        {showNote && (
          <div role="note" style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px 12px 16px", borderRadius: 12, background: "#FFF4F1", border: "1.5px solid #F0C9BF" }}>
            <div style={{ flex: 1, fontSize: 14.5, fontWeight: 600, color: "#3B362C" }}>First: answer these {total}. About 2 minutes.</div>
            <button type="button" onClick={closeNote} aria-label="Dismiss" style={{ width: 32, height: 32, borderRadius: 8, border: 0, background: "transparent", color: "#6B6358", fontSize: 18, cursor: "pointer" }}>×</button>
          </div>
        )}
        <PageHead
          eyebrow="Search profile"
          title={cfg.id === "rfp" ? "Tell Lookout about your business" : "Five questions from your recruiter"}
          intro={cfg.id === "rfp"
            ? "These answers tell the search what your business can win, and they shape every score and fit rating on your board."
            : "Your resume and LinkedIn show what you've done. These answers tell the search what you want next, and they shape every score and fit rating on your board."}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 16 }}>
            <div role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={answered} style={{ flex: 1, maxWidth: 320, height: 6, borderRadius: 999, background: "#E0D9CF", overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${(answered / total) * 100}%`, background: "#99220F", borderRadius: 999, transition: "width .2s" }} />
            </div>
            <div style={{ fontSize: 14, fontWeight: 600, color: "#6B6358" }}>{answered} of {total} answered</div>
          </div>
        </PageHead>

        {cfg.questions.map((q, i) => (
          <div key={q.key} style={{ padding: "18px 0", display: "grid", gridTemplateColumns: "44px minmax(0,1fr)", gap: "4px 12px" }}>
            <div style={{ fontSize: 22, fontWeight: 700, color: "#99220F" }}>{String(i + 1).padStart(2, "0")}</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <label htmlFor={`q-${q.key}`} style={{ fontSize: 17, fontWeight: 600 }}>{q.prompt}</label>
                {q.kind === "text" && <AutoTag src={auto[q.key]} />}
                {q.kind === "modes" && <AutoTag src={auto[q.areaKey] || auto[q.modesKey]} />}
              </div>
              {q.kind !== "modes" && <div style={{ fontSize: 14, color: "#6B6358" }}>{q.helper}</div>}

              {q.kind === "text" && q.starters && (
                <Starters
                  mode={q.starters.mode}
                  options={q.starters.options}
                  value={str(q.key)}
                  onChange={(v) => editAnswers({ [q.key]: v }, [q.key])}
                />
              )}
              {q.kind === "text" && (
                <textarea id={`q-${q.key}`} className="f-brick" value={str(q.key)} onChange={set(q.key)} rows={3} placeholder={q.placeholder} maxLength={4000} style={{ ...inputBase, resize: "vertical", padding: "11px 13px", lineHeight: 1.5 }} />
              )}

              {q.kind === "comp" && (
                <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                  {([[q.floorKey, "Floor", "$120,000"], [q.targetKey, "Would jump for", "$160,000"]] as const).map(([k, label, ph], j) => (
                    <label key={k} style={{ flex: "1 1 180px", display: "flex", flexDirection: "column", gap: 6, fontSize: 14, fontWeight: 600, letterSpacing: ".06em", textTransform: "uppercase", color: "#6B6358" }}>
                      {label}
                      <input id={j === 0 ? `q-${q.key}` : undefined} className="f-brick" inputMode="numeric" value={str(k)} onChange={set(k)} placeholder={ph} maxLength={40} style={{ ...inputBase, height: 42, padding: "0 13px", fontSize: 14.5, textTransform: "none", letterSpacing: 0, fontWeight: 500 }} />
                    </label>
                  ))}
                </div>
              )}

              {q.kind === "modes" && (
                <>
                  <div id={`q-${q.key}-modes`} style={{ fontSize: 14, fontWeight: 600, letterSpacing: ".06em", textTransform: "uppercase", color: "#6B6358" }}>{WORK_MODE_LABEL}</div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }} role="group" aria-labelledby={`q-${q.key}-modes`}>
                    {q.options.map((m) => {
                      const modes = arr(q.modesKey);
                      const on = modes.includes(m);
                      return (
                        <button
                          key={m}
                          aria-pressed={on}
                          onClick={() => editAnswers({ [q.modesKey]: on ? modes.filter((x) => x !== m) : [...modes, m] }, [q.modesKey, q.areaKey])}
                          style={{ height: 34, padding: "0 15px", borderRadius: 999, border: `1.5px solid ${on ? "#1D1A0F" : "#E0D9CF"}`, background: on ? "#1D1A0F" : "#fff", color: on ? "#fff" : "#1D1A0F", fontSize: 14, fontWeight: 600, cursor: "pointer" }}
                        >
                          {m}
                        </button>
                      );
                    })}
                  </div>
                  <input id={`q-${q.key}`} className="f-brick" value={str(q.areaKey)} onChange={set(q.areaKey)} placeholder="Neighborhoods or cities" aria-label="Areas" maxLength={300} style={{ ...inputBase, height: 42, padding: "0 13px" }} />
                </>
              )}
            </div>
          </div>
        ))}

        <div style={{ padding: "18px 0", display: "grid", gridTemplateColumns: "44px minmax(0,1fr)", gap: "4px 12px" }}>
          <div />
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <label htmlFor={`q-${BONUS_KEY}`} style={{ fontSize: 17, fontWeight: 600 }}>Bonus context (optional)</label>
            <div id={`q-${BONUS_KEY}-help`} style={{ fontSize: 14, color: "#6B6358" }}>Anything else Lookout should know.</div>
            <textarea id={`q-${BONUS_KEY}`} aria-describedby={`q-${BONUS_KEY}-help`} className="f-brick" value={str(BONUS_KEY)} onChange={set(BONUS_KEY)} rows={3} maxLength={4000} style={{ ...inputBase, resize: "vertical", padding: "11px 13px", lineHeight: 1.5 }} />
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", paddingTop: 4 }}>
          <button onClick={onSave} style={{ height: 46, padding: "0 28px", borderRadius: 12, border: 0, background: "#99220F", color: "#fff", fontSize: 14.5, fontWeight: 600, cursor: "pointer" }}>Save profile</button>
          <button onClick={onNext} disabled={!saved || busy} title={saved ? undefined : "Save your profile first"} style={{ height: 46, padding: "0 22px", borderRadius: 12, border: "1.5px solid #1D1A0F", background: "#fff", color: "#1D1A0F", fontSize: 14.5, fontWeight: 600, cursor: saved && !busy ? "pointer" : "default", opacity: saved && !busy ? 1 : 0.45 }}>
            {busy ? "One moment…" : `${next.label} →`}
          </button>
          {savedAt && <div aria-live="polite" style={{ flexBasis: "100%", fontSize: 14, color: "#6B6358" }}>Saved at {savedAt}. The next discovery run will use it.</div>}
        </div>

        {/* Current pay only means something next to posted pay ranges (#109). */}
        {cfg.board.columns.some((c) => c.key === "comp") && <CurrentCompField />}
      </div>
    </div>
  );
}
