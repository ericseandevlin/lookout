"use client";

import Link from "next/link";
import { useState } from "react";
import { AuthCard, Eyebrow, h1, p, primary } from "./Login";

/** Sign-in happens on a click, not on page load, so mail scanners that open links can't use up the token. */
export function Verify({ token }: { token: string }) {
  const [state, setState] = useState<"idle" | "busy" | "error">("idle");
  const [msg, setMsg] = useState("");
  const go = async () => {
    setState("busy");
    const res = await fetch("/api/auth/verify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token }) }).catch(() => null);
    if (res?.ok) return window.location.replace(new URL("/finds", window.location.origin));
    const data = await res?.json().catch(() => ({}));
    setMsg(data?.error || "This link didn't work.");
    setState("error");
  };
  return (
    <AuthCard>
      <Eyebrow>Sign in</Eyebrow>
      <h1 style={h1}>{state === "error" ? "That link didn't work" : "You're one tap away"}</h1>
      <p style={p}>{state === "error" ? msg : "Continue to open your board."}</p>
      {state === "error" ? (
        <Link href="/" style={{ ...primary, display: "flex", alignItems: "center", justifyContent: "center", textDecoration: "none", marginTop: 22 }}>Get a new link</Link>
      ) : (
        <button onClick={go} disabled={!token || state === "busy"} style={{ ...primary, width: "100%", marginTop: 22 }}>{state === "busy" ? "Signing in…" : "Continue"}</button>
      )}
    </AuthCard>
  );
}
