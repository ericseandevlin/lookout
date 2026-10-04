"use client";

import { useState } from "react";

export function Login({ emailEnabled, inviteOnly }: { emailEnabled: boolean; inviteOnly: boolean }) {
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

  return (
    <AuthCard>
      {!emailEnabled ? (
        <>
          <Eyebrow>Lookout</Eyebrow>
          <h1 style={h1}>Invite only for now</h1>
          <p style={p}>Lookout is in a private test. If someone invited you, use the sign-in link they sent you.</p>
        </>
      ) : state === "sent" ? (
        <>
          <Eyebrow>Check your email</Eyebrow>
          <h1 style={h1}>A sign-in link is on its way</h1>
          <p style={p}>We sent it to <strong style={{ color: "#1D1A0F" }}>{email}</strong>. It works once and expires in 15 minutes.</p>
          <button onClick={() => setState("idle")} style={{ ...ghost, marginTop: 22 }}>Use a different email</button>
        </>
      ) : (
        <>
          <Eyebrow>Lookout</Eyebrow>
          <h1 style={h1}>Find roles that actually fit</h1>
          <p style={p}>
            Tell Lookout what you want next. Each week it searches job boards and company sites, scores every role against your profile,
            and puts the matches on your board.
          </p>
          <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 24 }}>
            <label htmlFor="email" style={{ fontSize: 12, fontWeight: 600, letterSpacing: ".06em", textTransform: "uppercase", color: "#8A8175" }}>Email</label>
            <input
              id="email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="f-brick"
              style={{ height: 46, border: "1.5px solid #E6E0D8", background: "#fff", borderRadius: 10, padding: "0 14px", fontSize: 15, outline: "none", color: "#1D1A0F" }}
            />
            <button type="submit" disabled={state === "sending"} style={primary}>{state === "sending" ? "Sending…" : "Email me a sign-in link"}</button>
            {state === "error" && <div role="alert" style={{ fontSize: 13, color: "#99220F" }}>{msg}</div>}
            <div style={{ fontSize: 12.5, color: "#8A8175", lineHeight: 1.5 }}>
              {inviteOnly ? "Lookout is invite only for now. Use the email you were invited with." : "New here? The same link creates your account. No password."}
            </div>
          </form>
        </>
      )}
    </AuthCard>
  );
}

export function AuthCard({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: "32px 16px", background: "#EFEEEC" }}>
      <div style={{ width: "100%", maxWidth: 460, background: "#fff", borderRadius: 16, overflow: "hidden", boxShadow: "0 24px 60px rgba(29,26,15,.08)" }}>
        <div style={{ background: "#1D1A0F", color: "#fff", padding: "22px 26px" }}>
          <div className="wordmark">Lookout</div>
        </div>
        <div style={{ padding: "28px 26px 30px" }}>{children}</div>
      </div>
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
