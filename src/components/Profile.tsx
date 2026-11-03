"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { job } from "@/lib/kinds";
import { togglePhrase } from "@/lib/phrases";
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
  return (
    <nav aria-label="Profile sections" style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 18 }}>
      {tabs.map(([href, label]) => {
        const on = path === href;
        return (
          <Link key={href} href={href} aria-current={on ? "page" : undefined} style={{ display: "flex", alignItems: "center", height: 34, padding: "0 15px", borderRadius: 999, border: `1.5px solid ${on ? "#1D1A0F" : "#E0D9CF"}`, background: on ? "#1D1A0F" : "#fff", color: on ? "#fff" : "#1D1A0F", fontSize: 14, fontWeight: 600, textDecoration: "none" }}>
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

/**
 * The one next thing a new person has to do: answers, then resume, then a first search.
 * Shown on the profile, materials and an empty board, so no step ends without a way forward.
 */
export function NextStep({ here }: { here: "profile" | "materials" | "finds" }) {
  const { state, searchNow, saveProfile, fail } = useStore();
  const { answered } = useCounts(state);
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
  if (answered < 5) {
    const left = 5 - answered;
    text = `Answer ${left === 1 ? "the last question" : `the ${left} questions left`} so Lookout knows what to look for.`;
    if (here !== "profile") action = { label: "Go to your answers", run: async () => router.push("/profile") };
  } else if (rs !== "done") {
    text = rs === "scanning" ? "Reading your resume. This takes about a minute." : rs === "failed" ? "Lookout couldn't read your resume. Try a PDF or Word file." : "Next, add your resume. Lookout reads it to know what you've done.";
    if (here !== "materials" && rs !== "scanning")
      action = { label: "Next: add your resume", run: async () => { if (here === "profile") await saveProfile(); router.push("/profile/materials"); } };
  } else if (state.finds.length === 0) {
    if (state.running) text = "Your first search is running. Finds show up on your board as they come in.";
    else {
      text = "You're set. Run your first search now; after that Lookout searches on your schedule.";
      action = { label: "Run my first search", run: async () => { if (here === "profile") await saveProfile(); await searchNow(); if (here !== "finds") router.push("/finds"); } };
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

const focusEnd = (id: string) => {
  const el = document.getElementById(id) as HTMLTextAreaElement | null;
  if (!el) return;
  el.focus();
  el.setSelectionRange(el.value.length, el.value.length);
};

const splitList = (v: string) => v.split(/\s*[,;\n]\s*/).map((x) => x.trim()).filter(Boolean);

/** Chips that get someone started: drop in a sentence to finish, or toggle common items in a list. */
function Starters({ mode, options, value, onChange }: { mode: "insert" | "toggle" | "append"; options: { label: string; text: string }[]; value: string; onChange: (v: string) => void }) {
  const items = splitList(value);
  const has = (t: string) =>
    mode === "append" ? value.toLowerCase().includes(t.toLowerCase()) : items.some((x) => x.toLowerCase() === t.toLowerCase());
  const pick = (t: string) => {
    if (mode === "insert") return onChange(value.trim() ? `${value.trimEnd()}\n${t}` : t);
    if (mode === "append") return onChange(togglePhrase(value, t));
    onChange((has(t) ? items.filter((x) => x.toLowerCase() !== t.toLowerCase()) : [...items, t]).join(", "));
  };
  return (
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
  );
}

export function Profile() {
  const { state, editAnswers, saveProfile } = useStore();
  const { answered } = useCounts(state);
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

  return (
    <div className="page-pad lk-page" style={{ display: "flex", flexWrap: "wrap", gap: 24, alignItems: "flex-start" }}>
      <div style={{ flex: "1 1 520px", minWidth: 0, display: "flex", flexDirection: "column", gap: 16 }}>
        <ProfileTabs />
        <PageHead
          eyebrow="Search profile"
          title="Five questions from your recruiter"
          intro="Your resume and LinkedIn show what you've done. These answers tell the search what you want next, and they shape every score and fit rating on your board."
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 16 }}>
            <div role="progressbar" aria-valuemin={0} aria-valuemax={5} aria-valuenow={answered} style={{ flex: 1, maxWidth: 320, height: 6, borderRadius: 999, background: "#E0D9CF", overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${(answered / 5) * 100}%`, background: "#99220F", borderRadius: 999, transition: "width .2s" }} />
            </div>
            <div style={{ fontSize: 14, fontWeight: 600, color: "#6B6358" }}>{answered} of 5 answered</div>
          </div>
        </PageHead>

        {job.questions.map((q, i) => (
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
                  onChange={(v) => {
                    editAnswers({ [q.key]: v }, [q.key]);
                    if (q.starters!.mode === "insert") requestAnimationFrame(() => focusEnd(`q-${q.key}`));
                  }}
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
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }} role="group" aria-label="Work modes">
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

        <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-start", flexDirection: "row-reverse", gap: 14, flexWrap: "wrap", paddingTop: 4 }}>
          <button onClick={onSave} style={{ height: 46, padding: "0 28px", borderRadius: 12, border: 0, background: "#99220F", color: "#fff", fontSize: 14.5, fontWeight: 600, cursor: "pointer" }}>Save profile</button>
          {savedAt && <div aria-live="polite" style={{ fontSize: 14, color: "#6B6358" }}>Saved at {savedAt}. The next discovery run will use it.</div>}
        </div>
        <NextStep here="profile" />
      </div>
    </div>
  );
}
