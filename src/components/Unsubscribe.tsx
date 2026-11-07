"use client";

import { useState } from "react";
import { AuthCard, Eyebrow, h1, p, primary } from "./Login";
import { color } from "@/lib/tokens";

const WHAT = { news: "news and waitlist emails", digest: "the finds email" } as const;

/** The unsubscribe page (#28). email and list are null when the link's token didn't check out. */
export function Unsubscribe({ token, email, list }: { token: string; email: string | null; list: keyof typeof WHAT | null }) {
  const [state, setState] = useState<"idle" | "busy" | "done" | "error">("idle");

  if (!email || !list)
    return (
      <AuthCard>
        <Eyebrow>Unsubscribe</Eyebrow>
        <h1 style={h1}>That link didn&apos;t work</h1>
        <p style={p}>It may have been cut off. Open the link from the email again, or turn emails off in Settings.</p>
      </AuthCard>
    );

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setState("busy");
    const res = await fetch(`/api/unsubscribe?t=${encodeURIComponent(token)}`, { method: "POST" }).catch(() => null);
    setState(res?.ok ? "done" : "error");
  };

  if (state === "done")
    return (
      <AuthCard>
        <Eyebrow>Unsubscribed</Eyebrow>
        <h1 style={h1}>Done</h1>
        <p style={p}>
          <strong style={{ color: color.ink }}>{email}</strong> won&apos;t get {WHAT[list]} anymore. Sign-in links still arrive when you ask for one.
          {list === "digest" && " You can turn the finds email back on in Settings."}
        </p>
      </AuthCard>
    );

  return (
    <AuthCard>
      <Eyebrow>Unsubscribe</Eyebrow>
      <h1 style={h1}>Stop {WHAT[list]}?</h1>
      <p style={p}>
        For <strong style={{ color: color.ink }}>{email}</strong>.
      </p>
      <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 24 }}>
        <button type="submit" disabled={state === "busy"} style={primary}>{state === "busy" ? "Saving…" : "Unsubscribe"}</button>
        {state === "error" && <div role="alert" style={{ fontSize: 14, color: color.brick }}>Couldn&apos;t save that. Try again.</div>}
      </form>
    </AuthCard>
  );
}
