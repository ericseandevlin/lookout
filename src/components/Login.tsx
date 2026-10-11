"use client";

import { useState } from "react";
import { NEXT_MOVES } from "@/lib/onboarding";

export function Login({ emailEnabled, inviteOnly }: { emailEnabled: boolean; inviteOnly: boolean }) {
  const [mode, setMode] = useState<"signin" | "request">(inviteOnly && !emailEnabled ? "request" : "signin");
  return (
    <AuthCard>
      {mode === "signin" ? (
        <SignIn emailEnabled={emailEnabled} inviteOnly={inviteOnly} onRequest={() => setMode("request")} />
      ) : (
        <RequestAccess emailEnabled={emailEnabled} onSignIn={() => setMode("signin")} />
      )}
    </AuthCard>
  );
}

const field: React.CSSProperties = { height: 46, border: "1.5px solid #E6E0D8", background: "#fff", borderRadius: 10, padding: "0 14px", fontSize: 15, outline: "none", color: "#1D1A0F" };
const label: React.CSSProperties = { fontSize: 12, fontWeight: 600, letterSpacing: ".06em", textTransform: "uppercase", color: "#8A8175" };
const linkBtn: React.CSSProperties = { border: 0, background: "transparent", padding: 0, color: "#99220F", fontWeight: 600, fontSize: "inherit", cursor: "pointer", textDecoration: "underline", textUnderlineOffset: 3 };

function SignIn({ emailEnabled, inviteOnly, onRequest }: { emailEnabled: boolean; inviteOnly: boolean; onRequest: () => void }) {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [msg, setMsg] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setState("sending");
    const res = await fetch("/api/auth/request", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email }) }).catch(() => null);
    if (res?.ok) return setState("sent");
    const data = await res?.json().catch(() => ({}));
    setMsg(data?.error === "Invalid input" ? "Enter a valid email address." : data?.error || "Couldn't send the link. Try again.");
    setState("error");
  };

  if (state === "sent")
    return (
      <>
        <Eyebrow>Check your email</Eyebrow>
        <h1 style={h1}>A sign-in link is on its way</h1>
        <p style={p}>
          If <strong style={{ color: "#1D1A0F" }}>{email}</strong> has an account, the link is in your inbox. It works once and expires in 15 minutes.
        </p>
        <button onClick={() => setState("idle")} style={{ ...ghost, marginTop: 22 }}>Use a different email</button>
      </>
    );

  return (
    <>
      <Eyebrow>Lookout</Eyebrow>
      <h1 style={h1}>Find roles that actually fit</h1>
      <p style={p}>
        Tell Lookout what you want next. Each week it searches job boards and company sites, scores every role against your profile, and puts the
        matches on your board.
      </p>
      {emailEnabled ? (
        <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 24 }}>
          <label htmlFor="email" style={label}>Email</label>
          <input id="email" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" className="f-brick" style={field} />
          <button type="submit" disabled={state === "sending"} style={primary}>{state === "sending" ? "Sending…" : "Email me a sign-in link"}</button>
          {state === "error" && <div role="alert" style={{ fontSize: 13, color: "#99220F" }}>{msg}</div>}
        </form>
      ) : (
        <p style={{ ...p, marginTop: 20, fontSize: 13.5 }}>Sign-in emails aren&apos;t on yet. If you were invited, open the sign-in link you were sent.</p>
      )}
      <div style={{ fontSize: 13.5, color: "#6B6358", lineHeight: 1.5, marginTop: 18 }}>
        {inviteOnly ? (
          <>New here? Lookout is invite only for now. <button onClick={onRequest} style={linkBtn}>Request access</button></>
        ) : (
          "New here? The same link creates your account. No password."
        )}
      </div>
    </>
  );
}

function RequestAccess({ emailEnabled, onSignIn }: { emailEnabled: boolean; onSignIn: () => void }) {
  const [email, setEmail] = useState("");
  const [move, setMove] = useState<string | null>(null);
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [msg, setMsg] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setState("sending");
    const res = await fetch("/api/auth/request-access", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, nextMove: move ?? undefined }),
    }).catch(() => null);
    if (res?.ok) return setState("sent");
    const data = await res?.json().catch(() => ({}));
    setMsg(data?.error === "Invalid input" ? "Enter a valid email address." : data?.error || "Couldn't send your request. Try again.");
    setState("error");
  };

  if (state === "sent")
    return (
      <>
        <Eyebrow>You&apos;re on the list</Eyebrow>
        <h1 style={h1}>Thanks. We&apos;ll be in touch.</h1>
        <p style={p}>
          When your access is approved, you&apos;ll get a link {emailEnabled ? <>at <strong style={{ color: "#1D1A0F" }}>{email}</strong></> : "from the person who runs Lookout"} to set up your account.
        </p>
      </>
    );

  return (
    <>
      <Eyebrow>Request access</Eyebrow>
      <h1 style={h1}>Get on the list</h1>
      <p style={p}>Lookout is invite only while it&apos;s in testing. Leave your email and we&apos;ll send you an invite.</p>
      <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 24 }}>
        <label htmlFor="req-email" style={label}>Email</label>
        <input id="req-email" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" className="f-brick" style={field} />
        <fieldset style={{ border: 0, padding: 0, margin: "8px 0 4px", display: "flex", flexDirection: "column", gap: 6 }}>
          <legend style={{ ...label, marginBottom: 8 }}>What&apos;s your next move? <span style={{ textTransform: "none", letterSpacing: 0, fontWeight: 500 }}>(optional)</span></legend>
          {NEXT_MOVES.map((m) => {
            const on = move === m.key;
            return (
              <button
                type="button"
                key={m.key}
                aria-pressed={on}
                onClick={() => setMove(on ? null : m.key)}
                style={{ display: "flex", alignItems: "center", gap: 10, minHeight: 42, padding: "0 14px", borderRadius: 10, border: `1.5px solid ${on ? "#1D1A0F" : "#E6E0D8"}`, background: on ? "#1D1A0F" : "#fff", color: on ? "#fff" : "#1D1A0F", fontSize: 14, fontWeight: 500, cursor: "pointer", textAlign: "left" }}
              >
                <span style={{ width: 14, height: 14, borderRadius: "50%", border: `1.5px solid ${on ? "#F8A865" : "#CFC6B9"}`, background: on ? "#F8A865" : "transparent", flex: "none" }} />
                {m.label}
              </button>
            );
          })}
        </fieldset>
        <button type="submit" disabled={state === "sending"} style={primary}>{state === "sending" ? "Sending…" : "Request access"}</button>
        {state === "error" && <div role="alert" style={{ fontSize: 13, color: "#99220F" }}>{msg}</div>}
      </form>
      <div style={{ fontSize: 13.5, color: "#6B6358", marginTop: 18 }}>
        Already have an account? <button onClick={onSignIn} style={linkBtn}>Sign in</button>
      </div>
    </>
  );
}

export function AuthCard({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "32px 16px", background: "#EFEEEC" }}>
      <div style={{ width: "100%", maxWidth: 460, background: "#fff", borderRadius: 16, overflow: "hidden", boxShadow: "0 24px 60px rgba(29,26,15,.08)" }}>
        <div style={{ background: "#1D1A0F", color: "#fff", padding: "22px 26px" }}>
          <div className="wordmark">Lookout</div>
        </div>
        <div style={{ padding: "28px 26px 30px" }}>{children}</div>
      </div>
      <a href="/privacy" style={{ marginTop: 16, fontSize: 12.5, color: "#8A8175" }}>Privacy</a>
    </div>
  );
}

export const Eyebrow = ({ children }: { children: React.ReactNode }) => (
  <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: ".14em", textTransform: "uppercase", color: "#99220F" }}>{children}</div>
);
export const h1: React.CSSProperties = { margin: "8px 0 0", fontSize: 27, fontWeight: 700, letterSpacing: "-0.02em", lineHeight: 1.15 };
export const p: React.CSSProperties = { margin: "10px 0 0", fontSize: 14.5, lineHeight: 1.5, color: "#6B6358", textWrap: "pretty" };
export const primary: React.CSSProperties = { height: 46, borderRadius: 12, border: 0, background: "#99220F", color: "#fff", fontSize: 14.5, fontWeight: 600, cursor: "pointer" };
const ghost: React.CSSProperties = { height: 40, padding: "0 16px", borderRadius: 10, border: "1.5px solid #1D1A0F", background: "#fff", color: "#1D1A0F", fontSize: 13.5, fontWeight: 600, cursor: "pointer" };
