"use client";

import { useState } from "react";
import { AuthCard, Eyebrow, h1, p, primary } from "@/components/Login";
import { color, font } from "@/lib/tokens";

const field: React.CSSProperties = { height: 46, border: `1.5px solid ${color.border}`, background: "#fff", borderRadius: 10, padding: "0 14px", fontSize: font.md, outline: "none", color: color.ink };
const label: React.CSSProperties = { fontSize: font.base, fontWeight: 600, letterSpacing: ".06em", textTransform: "uppercase", color: color.t2 };
const CLOSED = { unknown: "This invite link doesn't work.", closed: "This invite link is closed.", expired: "This invite link has expired.", full: "Every spot on this invite is taken." } as const;

export function JoinForm({ code, label: group, closed, emailEnabled }: { code: string; label: string; closed: keyof typeof CLOSED | null; emailEnabled: boolean }) {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [msg, setMsg] = useState("");

  if (closed)
    return (
      <AuthCard>
        <Eyebrow>Invite link</Eyebrow>
        <h1 style={h1}>{CLOSED[closed]}</h1>
        <p style={p}>You can still ask for access, or sign in if you already have an account.</p>
        <a href="/signin" style={{ ...primary, display: "flex", alignItems: "center", justifyContent: "center", marginTop: 22, textDecoration: "none" }}>Go to sign in</a>
      </AuthCard>
    );

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setState("sending");
    const res = await fetch("/api/auth/join", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code, email }) }).catch(() => null);
    if (res?.ok) return setState("sent");
    const data = await res?.json().catch(() => ({}));
    setMsg(data?.error === "Invalid input" ? "Enter a valid email address." : data?.error || "Couldn't send the link. Try again.");
    setState("error");
  };

  if (state === "sent")
    return (
      <AuthCard>
        <Eyebrow>Check your email</Eyebrow>
        <h1 style={h1}>Your link is on its way</h1>
        <p style={p}>
          Open the email we sent to <strong style={{ color: color.ink }}>{email}</strong> and tap the link. It creates your account and signs you in. It works once and
          expires in 15 minutes.
        </p>
      </AuthCard>
    );

  return (
    <AuthCard>
      <Eyebrow>You&apos;re invited{group ? ` · ${group}` : ""}</Eyebrow>
      <h1 style={h1}>Make your Lookout account</h1>
      <p style={p}>
        Lookout is invite only while it&apos;s in testing, and this link gets you in. Answer five questions and it starts looking for roles that fit, twice a week. No
        password: we email you a link.
      </p>
      {emailEnabled ? (
        <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 24 }}>
          <label htmlFor="join-email" style={label}>Email</label>
          <input id="join-email" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" className="f-brick" style={field} />
          <button type="submit" disabled={state === "sending"} style={primary}>{state === "sending" ? "Sending…" : "Email me my link"}</button>
          {state === "error" && <div role="alert" style={{ fontSize: font.base, color: color.brick }}>{msg}</div>}
        </form>
      ) : (
        <p style={{ ...p, marginTop: 20, fontSize: font.base }}>Sign-in emails aren&apos;t on yet, so this link can&apos;t make accounts right now.</p>
      )}
      <p style={{ fontSize: font.base, color: color.t2, marginTop: 20, paddingTop: 16, borderTop: `1px solid ${color.border}` }}>
        Already have an account? <a href="/signin" style={{ color: color.brick, fontWeight: 600 }}>Sign in</a>
      </p>
    </AuthCard>
  );
}
