"use client";

import Link from "next/link";
import { useState } from "react";
import { ConsentCheck } from "./ConsentCheck";
import { AuthCard, Eyebrow, h1, p, primary } from "./Login";

/**
 * Sign-in happens on a click, not on page load, so mail scanners that open links can't use up the token.
 * An existing account that still has to agree to the Terms and Privacy ticks the box here, in the same step (#525).
 */
export function Verify({ token, agreeFirst = false }: { token: string; agreeFirst?: boolean }) {
  const [state, setState] = useState<"idle" | "busy" | "error">("idle");
  const [msg, setMsg] = useState("");
  const [agree, setAgree] = useState(false);
  const go = async () => {
    setState("busy");
    const res = await fetch("/api/auth/verify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(agreeFirst ? { token, agree: true } : { token }) }).catch(() => null);
    if (res?.ok) return window.location.replace(new URL("/finds", window.location.origin));
    const data = await res?.json().catch(() => ({}));
    setMsg(data?.error || "This link didn't work.");
    setState("error");
  };
  const blocked = !token || state === "busy" || (agreeFirst && !agree);
  return (
    <AuthCard>
      <Eyebrow>Sign in</Eyebrow>
      <h1 style={h1}>{state === "error" ? "That link didn't work" : agreeFirst ? "One step to sign in" : "You're one tap away"}</h1>
      <p style={p}>{state === "error" ? msg : agreeFirst ? "The Terms and Privacy Policy have changed since you last signed in. Tick the box and continue to open your board." : "Continue to open your board."}</p>
      {state === "error" ? (
        <Link href="/signin" style={{ ...primary, display: "flex", alignItems: "center", justifyContent: "center", textDecoration: "none", marginTop: 22 }}>Get a new link</Link>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 22, marginTop: 22 }}>
          {agreeFirst && <ConsentCheck checked={agree} onChange={setAgree} />}
          <button onClick={go} disabled={blocked} style={{ ...primary, width: "100%", opacity: blocked && state !== "busy" ? 0.6 : 1 }}>{state === "busy" ? "Signing in…" : "Continue"}</button>
        </div>
      )}
    </AuthCard>
  );
}
