"use client";

import { useState } from "react";
import { SALARY_RANGES, WORK_MODE_LABEL, WORK_MODES } from "@/lib/onboarding";
import { ConsentCheck } from "./ConsentCheck";
import { AuthCard, Eyebrow, h1, p, primary } from "./Login";

const label: React.CSSProperties = { fontSize: 14, fontWeight: 600, letterSpacing: ".06em", textTransform: "uppercase", color: "#6B6358" };
const chip = (on: boolean): React.CSSProperties => ({
  minHeight: 40, padding: "0 14px", borderRadius: 999, border: `1.5px solid ${on ? "#1D1A0F" : "#E0D9CF"}`,
  background: on ? "#1D1A0F" : "#fff", color: on ? "#fff" : "#1D1A0F", fontSize: 14, fontWeight: 600, cursor: "pointer",
});

/** First sign-in: name plus two quick picks that pre-fill profile questions 2 and 3 (job only, #8). */
export function Welcome({ initialName, kind = "job" }: { initialName: string; kind?: string }) {
  const [name, setName] = useState(initialName);
  const [salary, setSalary] = useState<string | null>(null);
  const [mode, setMode] = useState<string | null>(null);
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    const res = await fetch("/api/welcome", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, salary: salary ?? undefined, mode: mode ?? undefined, agree }),
    }).catch(() => null);
    if (res?.ok) return window.location.replace(new URL("/profile", window.location.origin));
    setErr("Couldn't save that. Try again.");
    setBusy(false);
  };

  return (
    <AuthCard>
      <Eyebrow>Welcome</Eyebrow>
      <h1 style={h1}>Let&apos;s set up your search</h1>
      <p style={p}>{kind === "rfp" ? "A name to start. You can change anything later on your profile." : "Three quick answers to start. You can change any of them later on your profile."}</p>
      <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 22, marginTop: 24 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <label htmlFor="name" style={label}>Your name</label>
          <input id="name" required autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" maxLength={120} className="f-brick" style={{ height: 46, border: "1.5px solid #E6E0D8", background: "#fff", borderRadius: 10, padding: "0 14px", fontSize: 15, outline: "none", color: "#1D1A0F" }} />
        </div>
        {kind !== "rfp" && (
        <fieldset style={{ border: 0, padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 8 }}>
          <legend style={{ ...label, marginBottom: 8 }}>Base salary you&apos;re aiming for</legend>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {SALARY_RANGES.map((r) => (
              <button type="button" key={r.key} aria-pressed={salary === r.key} onClick={() => setSalary(salary === r.key ? null : r.key)} style={chip(salary === r.key)}>{r.label}</button>
            ))}
          </div>
          <div style={{ fontSize: 14, color: "#6B6358" }}>Roles below the low end get marked down, not hidden.</div>
        </fieldset>
        )}
        {kind !== "rfp" && (
        <fieldset style={{ border: 0, padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 8 }}>
          <legend style={{ ...label, marginBottom: 8 }}>{WORK_MODE_LABEL}</legend>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {WORK_MODES.map((m) => (
              <button type="button" key={m} aria-pressed={mode === m} onClick={() => setMode(mode === m ? null : m)} style={chip(mode === m)}>{m}</button>
            ))}
          </div>
        </fieldset>
        )}
        <ConsentCheck checked={agree} onChange={setAgree} />
        <button type="submit" disabled={busy || !name.trim() || !agree} style={{ ...primary, opacity: name.trim() && agree ? 1 : 0.6 }}>{busy ? "Saving…" : "Continue to your profile"}</button>
        {err && <div role="alert" style={{ fontSize: 14, color: "#99220F" }}>{err}</div>}
      </form>
    </AuthCard>
  );
}
