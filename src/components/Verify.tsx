"use client";

import Link from "next/link";
import { useState } from "react";
import { ConsentCheck } from "./ConsentCheck";
import { AuthCard, Eyebrow, h1, p, primary } from "./Login";

/**
 * Sign-in happens on a click, not on page load, so mail scanners that open links can't use up the token.
 * An onboarded account that still has to agree to the terms ticks the box here, in the same step (#525).
 */
export function Verify({ token, consent }: { token: string; consent: { updated: boolean } | null }) {
  const [state, setState] = useState<"idle" | "busy" | "error">("idle");
  const [msg, setMsg] = useState("");
  const [agree, setAgree] = useState(false);
  const go = async () => {
    setState("busy");
    const res = await fetch("/api/auth/verify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(consent && agree ? { token, agree } : { token }) }).catch(() => null);
    if (res?.ok) return window.location.replace(new URL("/finds", window.location.origin));
    const data = await res?.json().catch(() => ({}));
    setMsg(data?.error || "This link didn't work.");
    setState("error");
  };
  const intro = !consent
    ? "Continue to open your board."
    : consent.updated
      ? "The terms have changed. Have a look, tick the box, then continue to open your board."
      : "Lookout now asks everyone to agree before using it. Read the pages, tick the box, then continue to open your board.";
  const ready = !!token && state !== "busy" && (!consent || agree);
  return (
    <AuthCard>
      <Eyebrow>Sign in</Eyebrow>
      <h1 style={h1}>{state === "error" ? "That link didn't work" : "You're one tap away"}</h1>
      <p style={p}>{state === "error" ? msg : intro}</p>
      {state === "error" ? (
        <Link href="/" style={{ ...primary, display: "flex", alignItems: "center", justifyContent: "center", textDecoration: "none", marginTop: 22 }}>Get a new link</Link>
      ) : (
        <>
          {consent && <div style={{ marginTop: 24 }}><ConsentCheck checked={agree} onChange={setAgree} /></div>}
          <button onClick={go} disabled={!ready} style={{ ...primary, width: "100%", marginTop: 22, opacity: consent && !agree ? 0.6 : 1 }}>{state === "busy" ? "Signing in…" : "Continue"}</button>
        </>
      )}
    </AuthCard>
  );
}
