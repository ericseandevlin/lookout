"use client";

import { useState } from "react";
import { AuthCard, Eyebrow, h1, p, primary } from "./Login";
import { BRAND } from "@/lib/brand";
import { color, font } from "@/lib/tokens";

/** The waitlist confirm page (#9). email is null when the link's token didn't check out or expired. */
export function ConfirmWaitlist({ token, email }: { token: string; email: string | null }) {
  const [state, setState] = useState<"idle" | "busy" | "done" | "error">("idle");
  const [msg, setMsg] = useState("");

  if (!email)
    return (
      <AuthCard>
        <Eyebrow>Waitlist</Eyebrow>
        <h1 style={h1}>That link didn&apos;t work</h1>
        <p style={p}>
          It may have been cut off, or it&apos;s more than two weeks old. <a href="/request-access" style={{ color: color.brick }}>Join the waitlist again</a> and we&apos;ll send a new one.
        </p>
      </AuthCard>
    );

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setState("busy");
    const res = await fetch(`/api/auth/waitlist-confirm?t=${encodeURIComponent(token)}`, { method: "POST" }).catch(() => null);
    if (res?.ok) return setState("done");
    const data = await res?.json().catch(() => ({}));
    setMsg(data?.error || "Couldn't save that. Try again.");
    setState("error");
  };

  if (state === "done")
    return (
      <AuthCard>
        <Eyebrow>You&apos;re on the list</Eyebrow>
        <h1 style={h1}>Confirmed</h1>
        <p style={p}>
          Thanks. <strong style={{ color: color.ink }}>{email}</strong> is on the {BRAND.name} waitlist. Your invite comes to this address, along with a short update about every two weeks.
        </p>
      </AuthCard>
    );

  return (
    <AuthCard>
      <Eyebrow>Waitlist</Eyebrow>
      <h1 style={h1}>Confirm it&apos;s you</h1>
      <p style={p}>
        For <strong style={{ color: color.ink }}>{email}</strong>.
      </p>
      <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 24 }}>
        <button type="submit" disabled={state === "busy"} style={primary}>{state === "busy" ? "Saving…" : "Confirm"}</button>
        {state === "error" && <div role="alert" style={{ fontSize: font.base, color: color.brick }}>{msg}</div>}
      </form>
    </AuthCard>
  );
}
