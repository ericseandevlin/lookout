"use client";

import Link from "next/link";
import { useState } from "react";
import { AuthCard, Eyebrow, h1, p, primary } from "./Login";

/** Confirm on click, not on load, so mail scanners can't use the link up. */
export function ConfirmEmail({ token }: { token: string }) {
  const [state, setState] = useState<"idle" | "busy" | "done" | "error">("idle");
  const [msg, setMsg] = useState("");
  const go = async () => {
    setState("busy");
    const res = await fetch("/api/auth/confirm-email", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token }) }).catch(() => null);
    const data = await res?.json().catch(() => ({}));
    if (res?.ok) {
      setMsg(data?.email ?? "");
      return setState("done");
    }
    setMsg(data?.error || "This link didn't work.");
    setState("error");
  };
  return (
    <AuthCard>
      <Eyebrow>Change email</Eyebrow>
      <h1 style={h1}>{state === "done" ? "Your email is updated" : state === "error" ? "That link didn't work" : "Confirm your new email"}</h1>
      <p style={p}>
        {state === "done" ? <>You&apos;ll sign in with <strong style={{ color: "#1D1A0F" }}>{msg}</strong> from now on.</> : state === "error" ? msg : "Make this the email you sign in with."}
      </p>
      {state === "done" || state === "error" ? (
        <Link href="/settings" style={{ ...primary, display: "flex", alignItems: "center", justifyContent: "center", textDecoration: "none", marginTop: 22 }}>Back to settings</Link>
      ) : (
        <button onClick={go} disabled={!token || state === "busy"} style={{ ...primary, width: "100%", marginTop: 22 }}>{state === "busy" ? "Confirming…" : "Confirm"}</button>
      )}
    </AuthCard>
  );
}
