"use client";

import { createPortal } from "react-dom";
import { useEffect, useRef, useState } from "react";
import { useStore } from "./store";

/** What a new search can hunt for (#8); same two options as the request-access kind picker. */
const KIND_OPTIONS = [
  { id: "job", label: "A job or role", note: "Job boards and company sites, scored on a schedule." },
  { id: "rfp", label: "Contract opportunities (RFPs)", note: "Solicitations from buyers, scored against your business." },
] as const;

const kindLabel = (kind: string) => KIND_OPTIONS.find((k) => k.id === kind)?.label ?? kind;

/**
 * The search switcher (#8): one account can hold several searches, each with its
 * own board; this picks which one the app shows. In the sidebar rail (expanded or
 * collapsed) and the mobile top bar.
 */
export function SearchSwitcher({ variant }: { variant: "rail" | "bar" }) {
  const store = useStore();
  const { state, readOnly } = store;
  const btnRef = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const [creating, setCreating] = useState(false);
  const [kind, setKind] = useState<string>("job");
  const [name, setName] = useState("");
  const [renaming, setRenaming] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const renameRef = useRef<HTMLInputElement>(null);

  const active = state.searches.find((s) => s.id === state.searchId) ?? state.searches[0];
  const open = !!pos;

  const close = () => {
    setPos(null);
    setCreating(false);
    setRenaming(null);
    setName("");
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  useEffect(() => {
    if (renaming) renameRef.current?.focus();
  }, [renaming]);
  useEffect(() => {
    if (creating) nameRef.current?.focus();
  }, [creating]);

  if (!active) return null;

  const toggle = () => {
    if (readOnly) return;
    if (open) return close();
    const r = btnRef.current!.getBoundingClientRect();
    setPos({ left: Math.min(Math.max(8, r.left), window.innerWidth - 292), top: Math.min(r.bottom + 6, window.innerHeight - 340) });
  };

  const pick = async (id: string) => {
    close();
    if (id !== state.searchId) await store.switchSearch(id);
  };

  const create = async () => {
    setBusy(true);
    try {
      await store.createSearch(kind, name || undefined);
      close();
    } catch {
      /* the store's fail toast shows it */
    } finally {
      setBusy(false);
    }
  };

  const saveRename = async (id: string) => {
    const next = (renameRef.current?.value ?? "").trim();
    setRenaming(null);
    if (next && next !== state.searches.find((s) => s.id === id)?.name) await store.renameSearch(id, next);
  };

  const label = (
    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{active.name}</span>
  );

  return (
    <>
      {variant === "rail" ? (
        <button
          ref={btnRef}
          onClick={toggle}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={`Search: ${active.name}. Switch searches.`}
          data-tip={state.settings.railClosed ? active.name : "Switch searches"}
          className="h-rail"
          style={{
            display: "flex", alignItems: "center", justifyContent: state.settings.railClosed ? "center" : "space-between", gap: 8,
            width: "100%", padding: state.settings.railClosed ? "9px 0" : "9px 12px", borderRadius: 10,
            background: "rgba(255,255,255,.07)", color: "#fff", fontSize: 14, fontWeight: 600, cursor: "pointer", textAlign: "left",
            border: "1px solid rgba(255,255,255,.09)",
          }}
        >
          {label}
          {!state.settings.railClosed && <span aria-hidden style={{ color: "#A89F92", fontSize: 11, flex: "none" }}>▼</span>}
        </button>
      ) : (
        <button
          ref={btnRef}
          onClick={toggle}
          aria-haspopup="menu"
          aria-expanded={open}
          className="h-rail"
          style={{
            display: "flex", alignItems: "center", gap: 6, padding: "5px 12px", borderRadius: 999, border: "1px solid rgba(255,255,255,.15)",
            background: "transparent", color: "#C9C1B5", fontSize: 13, fontWeight: 600, cursor: "pointer", maxWidth: 200,
          }}
        >
          {label}
          <span aria-hidden style={{ fontSize: 10, flex: "none" }}>▼</span>
        </button>
      )}
      {pos &&
        createPortal(
          <>
            <div onClick={close} style={{ position: "fixed", inset: 0, zIndex: 39 }} />
            <div
              role="menu"
              aria-label="Searches"
              style={{
                position: "fixed", zIndex: 40, left: pos.left, top: pos.top, width: 284, background: "#26221A", color: "#fff",
                borderRadius: 12, boxShadow: "0 12px 36px rgba(29,26,15,.4)", padding: 8, display: "flex", flexDirection: "column", gap: 2,
              }}
            >
              {state.searches.map((s) => (
                <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  {renaming === s.id ? (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        void saveRename(s.id);
                      }}
                      style={{ display: "flex", gap: 6, flex: 1, padding: "2px 4px" }}
                    >
                      <input
                        ref={renameRef}
                        defaultValue={s.name}
                        maxLength={80}
                        className="f-brick"
                        style={{ flex: 1, minWidth: 0, background: "#1D1A0F", border: "1px solid rgba(255,255,255,.15)", borderRadius: 8, padding: "6px 8px", color: "#fff", fontSize: 14 }}
                      />
                      <button type="submit" style={{ border: 0, background: "#427D33", color: "#fff", borderRadius: 8, padding: "6px 10px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
                        Save
                      </button>
                    </form>
                  ) : (
                    <>
                      <button
                        role="menuitem"
                        onClick={() => void pick(s.id)}
                        style={{
                          display: "flex", alignItems: "baseline", gap: 8, flex: 1, minWidth: 0, padding: "8px 10px", borderRadius: 8, border: 0,
                          background: s.id === state.searchId ? "rgba(255,255,255,.08)" : "transparent", color: s.id === state.searchId ? "#fff" : "#C9C1B5",
                          fontSize: 14, fontWeight: 600, cursor: "pointer", textAlign: "left",
                        }}
                      >
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.name}</span>
                        <span style={{ fontSize: 12, fontWeight: 500, opacity: 0.6, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: "none" }}>
                          {kindLabel(s.kind)}
                        </span>
                      </button>
                      {!readOnly && (
                        <button
                          aria-label={`Rename ${s.name}`}
                          onClick={() => setRenaming(s.id)}
                          className="h-rail"
                          style={{ border: 0, background: "transparent", color: "#A89F92", fontSize: 12, cursor: "pointer", padding: "6px", flex: "none" }}
                        >
                          Rename
                        </button>
                      )}
                    </>
                  )}
                </div>
              ))}
              {!creating ? (
                <button
                  role="menuitem"
                  onClick={() => setCreating(true)}
                  style={{
                    display: "flex", alignItems: "center", gap: 8, marginTop: 6, padding: "9px 10px", borderRadius: 8, border: 0,
                    background: "transparent", color: "#F8A865", fontSize: 14, fontWeight: 600, cursor: "pointer", textAlign: "left",
                  }}
                >
                  + New search
                </button>
              ) : (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void create();
                  }}
                  style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 6, padding: "6px 4px 4px", borderTop: "1px solid rgba(255,255,255,.1)" }}
                >
                  <div style={{ fontSize: 13, fontWeight: 600 }}>New search</div>
                  {KIND_OPTIONS.map((k) => {
                    const on = kind === k.id;
                    return (
                      <button
                        type="button"
                        key={k.id}
                        aria-pressed={on}
                        onClick={() => setKind(k.id)}
                        style={{
                          display: "flex", alignItems: "center", gap: 10, minHeight: 40, padding: "0 12px", borderRadius: 10,
                          border: `1.5px solid ${on ? "#F8A865" : "rgba(255,255,255,.15)"}`, background: on ? "rgba(248,168,101,.15)" : "transparent",
                          color: on ? "#fff" : "#C9C1B5", fontSize: 14, fontWeight: 500, cursor: "pointer", textAlign: "left",
                        }}
                      >
                        <span style={{ width: 14, height: 14, borderRadius: "50%", border: `1.5px solid ${on ? "#F8A865" : "#CFC6B9"}`, background: on ? "#F8A865" : "transparent", flex: "none" }} />
                        <span>
                          {k.label}
                          <span style={{ display: "block", fontSize: 13, fontWeight: 400, opacity: 0.65 }}>{k.note}</span>
                        </span>
                      </button>
                    );
                  })}
                  <input
                    ref={nameRef}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Name (optional)"
                    maxLength={80}
                    className="f-brick"
                    style={{ background: "#1D1A0F", border: "1px solid rgba(255,255,255,.15)", borderRadius: 8, padding: "8px 10px", color: "#fff", fontSize: 14 }}
                  />
                  <div style={{ display: "flex", gap: 8 }}>
                    <button
                      type="submit"
                      disabled={busy}
                      style={{ flex: 1, border: 0, background: "#427D33", color: "#fff", borderRadius: 8, padding: "9px 0", fontSize: 14, fontWeight: 600, cursor: busy ? "wait" : "pointer" }}
                    >
                      {busy ? "Creating…" : "Create search"}
                    </button>
                    <button type="button" onClick={() => setCreating(false)} style={{ border: 0, background: "transparent", color: "#A89F92", fontSize: 14, fontWeight: 600, cursor: "pointer", padding: "0 8px" }}>
                      Cancel
                    </button>
                  </div>
                </form>
              )}
            </div>
          </>,
          document.body,
        )}
    </>
  );
}