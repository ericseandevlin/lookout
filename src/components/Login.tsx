"use client";

import { useEffect, useRef, useState } from "react";
import { LegalLinks } from "./LegalLinks";
import { WAITLIST_NOTICE } from "@/lib/legal";
import { NEXT_MOVES } from "@/lib/onboarding";
import { color } from "@/lib/tokens";

export function Login({ emailEnabled, inviteOnly, turnstileSiteKey = "", kinds = false, signedOut = false, channel = null, inline = false, start }: { emailEnabled: boolean; inviteOnly: boolean; turnstileSiteKey?: string; kinds?: boolean; signedOut?: boolean; channel?: string | null; inline?: boolean; start?: "signin" | "request" }) {
  const [mode, setMode] = useState<"signin" | "request">(start ?? (inviteOnly && !emailEnabled ? "request" : "signin"));
  // The landing page (#600) shows the same card inside the page instead of as a full screen.
  const Frame = inline ? InlineCard : AuthCard;
  return (
    <Frame>
      {mode === "signin" ? (
        <SignIn emailEnabled={emailEnabled} inviteOnly={inviteOnly} signedOut={signedOut} onRequest={() => setMode("request")} />
      ) : (
        <RequestAccess emailEnabled={emailEnabled} turnstileSiteKey={turnstileSiteKey} kinds={kinds} channel={channel} onSignIn={() => setMode("signin")} />
      )}
    </Frame>
  );
}

const field: React.CSSProperties = { height: 46, border: `1.5px solid ${color.border}`, background: "#fff", borderRadius: 10, padding: "0 14px", fontSize: 15, outline: "none", color: color.ink };
const label: React.CSSProperties = { fontSize: 14, fontWeight: 600, letterSpacing: ".06em", textTransform: "uppercase", color: color.t2 };
const linkBtn: React.CSSProperties = { border: 0, background: "transparent", padding: 0, color: color.brick, fontWeight: 600, fontSize: "inherit", cursor: "pointer", textDecoration: "underline", textUnderlineOffset: 3 };

function SignIn({ emailEnabled, inviteOnly, signedOut, onRequest }: { emailEnabled: boolean; inviteOnly: boolean; signedOut: boolean; onRequest: () => void }) {
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
          If <strong style={{ color: color.ink }}>{email}</strong> has an account, the link is in your inbox. It works once and expires in 15 minutes.
        </p>
        <button onClick={() => setState("idle")} style={{ ...ghost, marginTop: 22 }}>Use a different email</button>
      </>
    );

  return (
    <>
      {/* A plain sign-in page for people who already have an account (#517). Lookout has no passwords: the emailed link is the sign-in. */}
      {signedOut && (
        <div role="status" style={{ marginBottom: 16, padding: "8px 12px", borderRadius: 10, background: "#F3F7F1", border: "1px solid #CFE3C6", fontSize: 14, color: color.greenText }}>
          You&apos;re signed out.
        </div>
      )}
      <Eyebrow>Welcome back</Eyebrow>
      <h1 style={h1}>Sign in to Lookout</h1>
      <p style={p}>Enter the email you use for Lookout and we&apos;ll send you a one-time sign-in link. There&apos;s no password to remember or reset.</p>
      {emailEnabled ? (
        <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 24 }}>
          <label htmlFor="email" style={label}>Email</label>
          <input id="email" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" className="f-brick" style={field} />
          <button type="submit" disabled={state === "sending"} style={primary}>{state === "sending" ? "Sending…" : "Email me a sign-in link"}</button>
          {state === "error" && <div role="alert" style={{ fontSize: 14, color: color.brick }}>{msg}</div>}
        </form>
      ) : (
        <p style={{ ...p, marginTop: 20, fontSize: 14 }}>Sign-in emails aren&apos;t on yet. If you were invited, open the sign-in link you were sent.</p>
      )}
      <div style={{ fontSize: 14, color: color.t2, lineHeight: 1.5, marginTop: 22, paddingTop: 16, borderTop: `1px solid ${color.border}` }}>
        <strong style={{ color: color.ink }}>New here?</strong> Lookout finds roles that actually fit. Each week it searches job boards and company sites, scores every role against your
        profile, and puts the matches on your board.{" "}
        {inviteOnly ? (
          <>It&apos;s invite only for now. <button onClick={onRequest} style={linkBtn}>Request access</button></>
        ) : (
          "The same link creates your account."
        )}
      </div>
    </>
  );
}

function RequestAccess({ emailEnabled, turnstileSiteKey, kinds, channel, onSignIn }: { emailEnabled: boolean; turnstileSiteKey: string; kinds: boolean; channel: string | null; onSignIn: () => void }) {
  const [email, setEmail] = useState("");
  const [kind, setKind] = useState<string>("job");
  const [move, setMove] = useState<string | null>(null);
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [msg, setMsg] = useState("");
  const [token, setToken] = useState("");
  const [resetKey, setResetKey] = useState(0);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setState("sending");
    const res = await fetch("/api/auth/request-access", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, kind, nextMove: kind === "job" ? move ?? undefined : undefined, turnstileToken: token || undefined, channel: channel ?? undefined }),
    }).catch(() => null);
    if (res?.ok) return setState("sent");
    const data = await res?.json().catch(() => ({}));
    setMsg(data?.error === "Invalid input" ? "Enter a valid email address." : data?.error || "Couldn't send your request. Try again.");
    // A Turnstile token works once, so a retry needs a fresh one.
    if (turnstileSiteKey) {
      setToken("");
      setResetKey((k) => k + 1);
    }
    setState("error");
  };

  if (state === "sent")
    return (
      <>
        <Eyebrow>You&apos;re on the list</Eyebrow>
        <h1 style={h1}>Thanks. We&apos;ll be in touch.</h1>
        <p style={p}>
          When your access is approved, you&apos;ll get a link {emailEnabled ? <>at <strong style={{ color: color.ink }}>{email}</strong></> : "from the person who runs Lookout"} to set up your account.
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
        {kinds && (
        <fieldset style={{ border: 0, padding: 0, margin: "18px 0 8px", display: "flex", flexDirection: "column", gap: 10 }}>
          <legend style={{ ...label, marginBottom: 10 }}>What do you want Lookout to find?</legend>
          {([
            ["job", "A job or role", "Lookout searches job boards and company sites every week and scores what it finds."],
            ["rfp", "Contract opportunities (RFPs)", "Lookout watches solicitations and scores them against your business. Starting with federal."],
          ] as const).map(([key, lab, note]) => {
            const on = kind === key;
            return (
              <button
                type="button"
                key={key}
                aria-pressed={on}
                onClick={() => setKind(key)}
                style={{ display: "flex", alignItems: "center", gap: 12, minHeight: 48, padding: "12px 16px", borderRadius: 10, border: `1.5px solid ${on ? color.ink : color.border}`, background: on ? color.ink : "#fff", color: on ? "#fff" : color.ink, fontSize: 14, fontWeight: 500, cursor: "pointer", textAlign: "left" }}
              >
                <span style={{ width: 14, height: 14, borderRadius: "50%", border: `1.5px solid ${on ? color.orange : "#CFC6B9"}`, background: on ? color.orange : "transparent", flex: "none" }} />
                <span>
                  {lab}
                  <span style={{ display: "block", fontSize: 14, fontWeight: 400, lineHeight: 1.45, opacity: 0.75, marginTop: 3 }}>{note}</span>
                </span>
              </button>
            );
          })}
        </fieldset>
        )}
        {kind === "job" && (
        <fieldset style={{ border: 0, padding: 0, margin: "18px 0 8px", display: "flex", flexDirection: "column", gap: 10 }}>
          <legend style={{ ...label, marginBottom: 10 }}>What&apos;s your next move? <span style={{ textTransform: "none", letterSpacing: 0, fontWeight: 500 }}>(optional)</span></legend>
          {NEXT_MOVES.map((m) => {
            const on = move === m.key;
            return (
              <button
                type="button"
                key={m.key}
                aria-pressed={on}
                onClick={() => setMove(on ? null : m.key)}
                style={{ display: "flex", alignItems: "center", gap: 12, minHeight: 48, padding: "12px 16px", borderRadius: 10, border: `1.5px solid ${on ? color.ink : color.border}`, background: on ? color.ink : "#fff", color: on ? "#fff" : color.ink, fontSize: 14, fontWeight: 500, cursor: "pointer", textAlign: "left" }}
              >
                <span style={{ width: 14, height: 14, borderRadius: "50%", border: `1.5px solid ${on ? color.orange : "#CFC6B9"}`, background: on ? color.orange : "transparent", flex: "none" }} />
                {m.label}
              </button>
            );
          })}
        </fieldset>
        )}
        {turnstileSiteKey && <Turnstile siteKey={turnstileSiteKey} resetKey={resetKey} onToken={setToken} />}
        <p style={{ fontSize: 14, lineHeight: 1.5, color: color.t2, margin: 0 }}>{WAITLIST_NOTICE}</p>
        <button type="submit" disabled={state === "sending" || (!!turnstileSiteKey && !token)} style={primary}>{state === "sending" ? "Sending…" : "Request access"}</button>
        {state === "error" && <div role="alert" style={{ fontSize: 14, color: color.brick }}>{msg}</div>}
      </form>
      <div style={{ fontSize: 14, color: color.t2, marginTop: 18 }}>
        Already have an account? <button onClick={onSignIn} style={linkBtn}>Sign in</button>
      </div>
    </>
  );
}

type TurnstileApi = {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string;
  remove: (id: string) => void;
};
declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const TURNSTILE_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
let turnstileScript: Promise<TurnstileApi> | null = null;

/** Loads Cloudflare's script once. Added from code, so the page CSP's 'strict-dynamic' lets it run (#13). */
function loadTurnstile() {
  turnstileScript ??= new Promise<TurnstileApi>((resolve, reject) => {
    if (window.turnstile) return resolve(window.turnstile);
    const s = document.createElement("script");
    s.src = TURNSTILE_SRC;
    s.async = true;
    s.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error("turnstile missing")));
    s.onerror = () => {
      turnstileScript = null;
      reject(new Error("turnstile failed to load"));
    };
    document.head.appendChild(s);
  });
  return turnstileScript;
}

/** Cloudflare Turnstile widget (#13). Reports a token when the check passes, "" when it expires or fails. */
function Turnstile({ siteKey, resetKey, onToken }: { siteKey: string; resetKey: number; onToken: (token: string) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let id: string | null = null;
    let gone = false;
    loadTurnstile()
      .then((api) => {
        if (gone || !box.current) return;
        id = api.render(box.current, {
          sitekey: siteKey,
          action: "request-access",
          callback: (t: string) => onToken(t),
          "expired-callback": () => onToken(""),
          "error-callback": () => onToken(""),
        });
      })
      .catch(() => !gone && setFailed(true));
    return () => {
      gone = true;
      if (id && window.turnstile) window.turnstile.remove(id);
    };
  }, [siteKey, resetKey, onToken]);
  return (
    <>
      <div ref={box} style={{ minHeight: 65, marginTop: 4 }} />
      {failed && <div role="alert" style={{ fontSize: 14, color: color.brick }}>The bot check didn&apos;t load. Check your connection and reload the page.</div>}
    </>
  );
}

export function AuthCard({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "32px 16px", background: "#EFEEEC" }}>
      <div style={{ width: "100%", maxWidth: 460, background: "#fff", borderRadius: 16, overflow: "hidden", boxShadow: "0 24px 60px rgba(29,26,15,.08)" }}>
        <div style={{ background: color.ink, color: "#fff", padding: "22px 26px" }}>
          <div className="wordmark">Lookout</div>
        </div>
        <div style={{ padding: "28px 26px 30px" }}>{children}</div>
      </div>
      <LegalLinks style={{ marginTop: 16 }} />
    </div>
  );
}

function InlineCard({ children }: { children: React.ReactNode }) {
  return (
    <div id="get-in" style={{ width: "100%", maxWidth: 460, background: "#fff", borderRadius: 16, overflow: "hidden", boxShadow: "0 24px 60px rgba(29,26,15,.10)", scrollMarginTop: 24 }}>
      <div style={{ padding: "26px 26px 28px" }}>{children}</div>
    </div>
  );
}

export const Eyebrow = ({ children }: { children: React.ReactNode }) => (
  <div style={{ fontSize: 14, fontWeight: 700, letterSpacing: ".14em", textTransform: "uppercase", color: color.brick }}>{children}</div>
);
export const h1: React.CSSProperties = { margin: "8px 0 0", fontSize: 27, fontWeight: 700, letterSpacing: "-0.02em", lineHeight: 1.15 };
export const p: React.CSSProperties = { margin: "10px 0 0", fontSize: 14.5, lineHeight: 1.5, color: color.t2, textWrap: "pretty" };
export const primary: React.CSSProperties = { height: 46, borderRadius: 12, border: 0, background: color.brick, color: "#fff", fontSize: 14.5, fontWeight: 600, cursor: "pointer" };
const ghost: React.CSSProperties = { height: 40, padding: "0 16px", borderRadius: 10, border: "1.5px solid #1D1A0F", background: "#fff", color: color.ink, fontSize: 14, fontWeight: 600, cursor: "pointer" };
