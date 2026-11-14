"use client";

import { useEffect, useState } from "react";
import { COMPARE_INK, compareComp, compareText, parseCurrentComp } from "@/lib/currentComp";
import type { Find } from "@/lib/types";
import { api, useStore } from "./store";
import { color, font } from "@/lib/tokens";

/** The person's own current pay (#109). Not part of the app state, so it never reaches exports or the admin view. */
export function useCurrentComp() {
  const { readOnly } = useStore();
  const [amount, setAmount] = useState<number | null>(null);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    // An admin viewing someone's board must not see their own number against that person's finds.
    if (readOnly) return;
    let live = true;
    api<{ amount: number | null }>("/api/profile/current-comp")
      .then((r) => live && setAmount(r.amount))
      .catch(() => {})
      .finally(() => live && setLoaded(true));
    return () => {
      live = false;
    };
  }, [readOnly]);
  return { amount: readOnly ? null : amount, setAmount, loaded };
}

/** One line under a find's comp: its stated range against current pay. Nothing when no pay is saved. */
export function CompCompare({ f, current, style }: { f: Find; current: number | null; style?: React.CSSProperties }) {
  if (current === null) return null;
  const c = compareComp(f.comp, f.currency, current);
  return <div style={{ fontSize: font.base, fontWeight: 400, color: COMPARE_INK[c.kind], ...style }}>{compareText(c)}</div>;
}

const inputStyle: React.CSSProperties = {
  border: `1.5px solid ${color.border}`, background: "#fff", borderRadius: 10, fontSize: font.md, outline: "none", color: color.ink, height: 42, padding: "0 13px",
};

/** Profile section: set, change or delete current pay. Saved on its own, apart from the five answers. */
export function CurrentCompField() {
  const { amount, setAmount, loaded } = useCurrentComp();
  const [draft, setDraft] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const value = draft ?? (amount ? amount.toLocaleString("en-US") : "");
  const parsed = parseCurrentComp(value);

  const run = async (fn: () => Promise<{ amount: number | null }>, done: string) => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fn();
      setAmount(r.amount);
      setDraft(null);
      setMsg(done);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  };
  const save = () => parsed && run(() => api("/api/profile/current-comp", { method: "PUT", json: { amount: parsed } }), "Saved.");
  const remove = () => run(() => api("/api/profile/current-comp", { method: "DELETE" }), "Deleted. Your board no longer compares against it.");

  return (
    <section aria-labelledby="current-comp" style={{ padding: "18px 0", borderTop: `1px solid ${color.surface}`, display: "flex", flexDirection: "column", gap: 10 }}>
      <label id="current-comp" htmlFor="current-comp-input" style={{ fontSize: font.lg, fontWeight: 600 }}>Current pay</label>
      <div style={{ fontSize: font.base, color: color.t2, lineHeight: 1.5, maxWidth: 560 }}>
        Optional. Your current yearly base pay in USD. Posted ranges are usually base pay, so use base here. Your board shows each posted range against it. Only you see it: it is stored encrypted, never shared with the AI that writes your drafts, and left out of exports.
      </div>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <input
          id="current-comp-input"
          className="f-brick"
          inputMode="numeric"
          autoComplete="off"
          disabled={!loaded}
          value={value}
          onChange={(e) => { setDraft(e.target.value); setMsg(null); }}
          onKeyDown={(e) => e.key === "Enter" && save()}
          placeholder="$100,000"
          maxLength={20}
          aria-invalid={!!value && !parsed}
          style={{ ...inputStyle, flex: "0 1 220px" }}
        />
        <button onClick={save} disabled={busy || !parsed || parsed === amount} style={{ height: 42, padding: "0 20px", borderRadius: 10, border: 0, background: color.brick, color: "#fff", fontSize: font.base, fontWeight: 600, cursor: "pointer", opacity: busy || !parsed || parsed === amount ? 0.5 : 1 }}>
          Save pay
        </button>
        {amount !== null && (
          <button onClick={remove} disabled={busy} style={{ height: 42, padding: "0 16px", borderRadius: 10, border: `1.5px solid ${color.border}`, background: "#fff", color: color.ink, fontSize: font.base, fontWeight: 600, cursor: "pointer" }}>
            Delete
          </button>
        )}
      </div>
      {value && !parsed && <div style={{ fontSize: font.base, color: color.brick }}>Enter one yearly amount, like 100000 or $100k.</div>}
      {msg && <div aria-live="polite" style={{ fontSize: font.base, color: color.t2 }}>{msg}</div>}
    </section>
  );
}
