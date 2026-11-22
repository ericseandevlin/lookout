"use client";

import { useState } from "react";
import { SALARY_RANGES, WORK_MODE_LABEL, WORK_MODES } from "@/lib/onboarding";
import { ConsentCheck } from "./ConsentCheck";
import { AuthCard, Eyebrow, h1, p, primary } from "./Login";
import { color, font } from "@/lib/tokens";

const label: React.CSSProperties = { fontSize: font.base, fontWeight: 600, letterSpacing: ".06em", textTransform: "uppercase", color: color.t2 };
const chip = (on: boolean): React.CSSProperties => ({
  minHeight: 40, padding: "0 14px", borderRadius: 999, border: `1.5px solid ${on ? color.ink : color.border}`,
  background: on ? color.ink : "#fff", color: on ? "#fff" : color.ink, fontSize: font.base, fontWeight: 600, cursor: "pointer",
});

/** First sign-in: name plus two quick picks that pre-fill profile questions 2 and 3 (job only, #8). */
export function Welcome({ initialName, kind = "job" }: { initialName: string; kind?: string }) {
  const [name, setName] = useState(initialName);
  const [salary, setSalary] = useState<string | null>(null);
  const [modes, setModes] = useState<string[]>([]);
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const missing = !name.trim() ? "Add your name to continue." : !agree ? "Tick the box above to continue." : null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    const res = await fetch("/api/welcome", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, salary: salary ?? undefined, modes, agree }),
    }).catch(() => null);
    if (res?.ok) return window.location.replace(new URL("/profile", window.location.origin));
    setErr("Couldn't save that. Try again.");
    setBusy(false);
  };

  return (
    <AuthCard>
      <Eyebrow>Welcome</Eyebrow>
      <h1 style={h1}>Let&apos;s set up your search</h1>
      <p style={p}>{kind === "rfp" ? "A name to start. You can change anything later on your profile." : "Your name and two of the five questions. Change them anytime."}</p>
      <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 22, marginTop: 24 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <label htmlFor="name" style={label}>Your name</label>
          <input id="name" required autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" maxLength={120} className="f-brick" style={{ height: 46, border: `1.5px solid ${color.border}`, background: "#fff", borderRadius: 10, padding: "0 14px", fontSize: font.md, outline: "none", color: color.ink }} />
        </div>
        {kind !== "rfp" && (
        <fieldset style={{ border: 0, padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 8 }}>
          <legend style={{ ...label, marginBottom: 8 }}>
            <span data-tip="Roles that top out below the low end are left off.">Base salary you&apos;re aiming for</span>
          </legend>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {SALARY_RANGES.map((r) => (
              <button type="button" key={r.key} aria-pressed={salary === r.key} onClick={() => setSalary(salary === r.key ? null : r.key)} style={chip(salary === r.key)}>{r.label}</button>
            ))}
          </div>
        </fieldset>
        )}
        {kind !== "rfp" && (
        <fieldset style={{ border: 0, padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 8 }}>
          <legend style={{ ...label, marginBottom: 8 }}>{WORK_MODE_LABEL} <span style={{ textTransform: "none", letterSpacing: 0, fontWeight: 500 }}>(pick any)</span></legend>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {WORK_MODES.map((m) => (
              <button type="button" key={m} aria-pressed={modes.includes(m)} onClick={() => setModes(modes.includes(m) ? modes.filter((x) => x !== m) : [...modes, m])} style={chip(modes.includes(m))}>{m}</button>
            ))}
          </div>
        </fieldset>
        )}
        <ConsentCheck checked={agree} onChange={setAgree} />
        <button type="submit" disabled={busy || !!missing} aria-describedby={missing ? "welcome-missing" : undefined} style={{ ...primary, opacity: missing ? 0.6 : 1 }}>{busy ? "Saving…" : "Continue to your profile"}</button>
        {/* What's still missing, so a disabled button says why, to everyone and to screen readers (#1531). */}
        {missing && <div id="welcome-missing" role="status" style={{ fontSize: font.base, color: color.t2, marginTop: -12 }}>{missing}</div>}
        {err && <div role="alert" style={{ fontSize: font.base, color: color.brick }}>{err}</div>}
      </form>
    </AuthCard>
  );
}
