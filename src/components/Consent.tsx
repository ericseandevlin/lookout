"use client";

import { useState } from "react";
import { ConsentCheck } from "./ConsentCheck";
import { AuthCard, Eyebrow, h1, p, primary } from "./Login";
import { color, font } from "@/lib/tokens";

/** Asked once of accounts from before #21, and again whenever the Terms or Privacy version changes. */
export function Consent({ updated }: { updated: boolean }) {
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    const res = await fetch("/api/consent", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agree }),
    }).catch(() => null);
    if (res?.ok) return window.location.replace(new URL("/finds", window.location.origin));
    setErr("Couldn't save that. Try again.");
    setBusy(false);
  };

  return (
    <AuthCard>
      <Eyebrow>{updated ? "Updated" : "One thing first"}</Eyebrow>
      <h1 style={h1}>{updated ? "The terms have changed" : "Agree to keep using Lookout"}</h1>
      <p style={p}>{updated ? "Have a look at what changed, then tick the box to carry on." : "Lookout now asks everyone to agree before using it. Read the pages, then tick the box to carry on."}</p>
      <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 22, marginTop: 24 }}>
        <ConsentCheck checked={agree} onChange={setAgree} />
        <button type="submit" disabled={busy || !agree} style={{ ...primary, opacity: agree ? 1 : 0.6 }}>{busy ? "Saving…" : "Continue"}</button>
        {err && <div role="alert" style={{ fontSize: font.base, color: color.brick }}>{err}</div>}
      </form>
    </AuthCard>
  );
}
