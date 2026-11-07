"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { joinInterests, MILES, splitInterests, type EventFreq, type EventReach, type NetworkingEvent } from "@/lib/networking";
import { PageHead } from "./Profile";
import { Row, Section, Seg } from "./Settings";
import { api } from "./store";
import { EventsBoard } from "./events/EventsBoard";

type Prefs = { interests: string; reach: EventReach; miles: number; freq: EventFreq };

const muted: React.CSSProperties = { fontSize: 14, color: "#6B6358" };
const field: React.CSSProperties = { width: "100%", maxWidth: 520, height: 42, border: "1.5px solid #E6E0D8", background: "#fff", borderRadius: 10, padding: "0 13px", fontSize: 14, color: "#1D1A0F" };


/** /events: networking events the sweep found (#7), apart from job finds, with what to look for. */
export function Events() {
  const [events, setEvents] = useState<NetworkingEvent[] | null>(null);
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [searching, setSearching] = useState(false);

  const load = useCallback(
    () =>
      api<{ events: NetworkingEvent[]; prefs: Prefs; suggestions: string[]; searching: boolean }>("/api/networking-events")
      .then((r) => {
        setEvents(r.events);
        setPrefs(r.prefs);
        setSuggestions(r.suggestions ?? []);
        setSearching(r.searching);
        return r;
      }),
    [],
  );
  useEffect(() => {
    load().catch((e) => setMsg({ text: e instanceof Error ? e.message : "Couldn't load", ok: false }));
  }, [load]);
  // While an event search runs, check every few seconds and reload when it ends (#265).
  useEffect(() => {
    if (!searching) return;
    const t = setInterval(() => void load().catch(() => {}), 4000);
    return () => clearInterval(t);
  }, [searching, load]);
  const searchNow = async () => {
    setMsg(null);
    try {
      await api("/api/networking-events/search", { method: "POST" });
      setSearching(true);
    } catch (e) {
      setMsg({ text: e instanceof Error ? e.message : "Couldn't start the search", ok: false });
    }
  };

  const save = async (p: Prefs, done: string) => {
    setMsg(null);
    try {
      const r = await api<{ prefs: Prefs }>("/api/networking-events", { method: "PUT", json: p });
      setPrefs(r.prefs);
      setMsg({ text: done, ok: true });
    } catch (e) {
      setMsg({ text: e instanceof Error ? e.message : "Couldn't save", ok: false });
    }
  };
  const chosen = splitInterests(prefs?.interests ?? "");
  const has = (t: string) => chosen.some((c) => c.toLowerCase() === t.toLowerCase());
  const setInterests = (list: string[]) => {
    if (!prefs) return;
    const interests = joinInterests(list);
    if (interests.length > 300) return setMsg({ text: "That's the most it can hold. Remove one first.", ok: false });
    save({ ...prefs, interests }, interests ? "Saved. Your next search looks for events too." : "Event search is off.");
  };
  const toggle = (t: string) => setInterests(has(t) ? chosen.filter((c) => c.toLowerCase() !== t.toLowerCase()) : [...chosen, t]);
  // Pin, archive and "Not for me" (#265): applied here at once, then saved one by one.
  const patchEvents = async (ids: string[], patch: { pinned?: boolean; archived?: boolean; dismissed?: boolean }) => {
    setEvents((xs) => (xs ?? []).flatMap((x) => (ids.includes(x.id) ? (patch.dismissed ? [] : [{ ...x, ...patch }]) : [x])));
    try {
      for (const id of ids) await api(`/api/networking-events/${id}`, { method: "PATCH", json: patch });
    } catch (e) {
      setMsg({ text: e instanceof Error ? e.message : "Couldn't save that", ok: false });
      void load().catch(() => {});
    }
  };
  const clearEvents = async () => {
    try {
      const r = await api<{ archived: number }>("/api/networking-events/clear", { method: "POST" });
      setEvents((xs) => (xs ?? []).map((x) => (x.pinned ? x : { ...x, archived: true })));
      setMsg({ text: `Archived ${r.archived} ${r.archived === 1 ? "event" : "events"}. Pinned ones stayed.`, ok: true });
    } catch (e) {
      setMsg({ text: e instanceof Error ? e.message : "Couldn't clear", ok: false });
    }
  };


  return (
    <div className="page-pad settings lk-page w-page" style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <PageHead eyebrow="Networking" title="Events" intro="Meetups, panels, industry nights, conferences and talks that fit your field, found with each search. Kept apart from your job finds. Past events drop off on their own." />
      {msg && (
        <div role={msg.ok ? "status" : "alert"} style={{ fontSize: 14, color: msg.ok ? "#35662A" : "#99220F" }}>
          {msg.text}
        </div>
      )}
      {prefs && (
        <>
          <Section>What to look for</Section>
          <Row title="Interests" help="The topics you want events for. Suggestions come from what Lookout sees in your profile. Your first three go into each search.">
            <InterestPicker chosen={chosen} suggestions={suggestions} onToggle={toggle} onAdd={(add) => setInterests([...chosen, ...add])} />
          </Row>
          <Row title="Where" help="In person near where you live (from your profile), online, or both.">
            <Seg opts={[["Nearby", "nearby"], ["Online", "online"], ["Both", "both"]]} cur={prefs.reach} pick={(v) => save({ ...prefs, reach: v as EventReach }, "Saved.")} />
          </Row>
          <Row title="How often" help="Event searches run with your job search, at most this often.">
            <Seg opts={[["Weekly", "weekly"], ["Monthly", "monthly"]]} cur={prefs.freq} pick={(v) => save({ ...prefs, freq: v as EventFreq }, "Saved.")} />
          </Row>
          {prefs.reach !== "online" && (
            <Row title="How far" help="For in-person events.">
              <Seg opts={MILES.map((m) => [`${m} mi`, m] as [string, number])} cur={prefs.miles} pick={(v) => save({ ...prefs, miles: v }, "Saved.")} />
            </Row>
          )}
        </>
      )}

      <Section>Events</Section>
      {events === null && !msg && <div style={muted}>Loading…</div>}
      {events && !events.length && <div style={muted}>{prefs?.interests ? "Nothing yet. Events show up here after your next search, or press Search now." : "Pick an interest above and your searches will look for events too."}</div>}
      {events && (events.length > 0 || !!prefs?.interests) && (
        <EventsBoard events={events} searching={searching} canSearch={!!prefs?.interests} onSearch={searchNow} onPatch={patchEvents} onClear={clearEvents} />
      )}
    </div>
  );
}

/**
 * Event interests without a wall of chips (#277): the picked ones stay in view, small and removable;
 * suggestions and your own topics live in one menu behind "Add interest".
 */
function InterestPicker({ chosen, suggestions, onToggle, onAdd }: { chosen: string[]; suggestions: string[]; onToggle: (t: string) => void; onAdd: (add: string[]) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const box = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState<{ top: number; left: number; width: number } | null>(null);
  const has = (t: string) => chosen.some((c) => c.toLowerCase() === t.toLowerCase());
  useEffect(() => {
    if (!open) return;
    // The menu sits on <body> so the rows below can't paint over it; it follows the button and closes on an outside click.
    const place = () => {
      const r = box.current?.getBoundingClientRect();
      if (r) setAt({ top: r.bottom + 6, left: r.left, width: Math.min(340, r.width) });
    };
    place();
    const away = (e: MouseEvent) => !box.current?.contains(e.target as Node) && !menu.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", away);
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      document.removeEventListener("mousedown", away);
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open, chosen.length]);
  const needle = q.trim().toLowerCase();
  const list = suggestions.filter((t) => !needle || t.toLowerCase().includes(needle));
  const isNew = !!needle && ![...suggestions, ...chosen].some((t) => t.toLowerCase() === needle);
  const addTyped = () => {
    const add = splitInterests(q);
    if (!add.length) return;
    setQ("");
    onAdd(add.filter((t) => !has(t)));
  };
  return (
    <div ref={box} style={{ position: "relative", display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }} onKeyDown={(e) => e.key === "Escape" && setOpen(false)}>
      {chosen.map((t) => (
        <span key={t} style={{ display: "inline-flex", alignItems: "center", gap: 4, height: 32, padding: "0 6px 0 12px", borderRadius: 999, background: "#1D1A0F", color: "#fff", fontSize: 14, fontWeight: 600 }}>
          {t}
          <button type="button" onClick={() => onToggle(t)} aria-label={`Remove ${t}`} style={{ width: 22, height: 22, border: 0, borderRadius: "50%", background: "rgba(255,255,255,.14)", color: "#fff", fontSize: 14, lineHeight: 1, cursor: "pointer" }}>×</button>
        </span>
      ))}
      <button type="button" aria-expanded={open} aria-haspopup="true" onClick={() => setOpen((o) => !o)} style={{ height: 32, padding: "0 12px", borderRadius: 999, border: "1.5px dashed #B9AE9F", background: "transparent", color: "#1D1A0F", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>
        + Add interest
      </button>
      {!chosen.length && <span style={muted}>Event search is off until you pick one.</span>}
      {open && at && createPortal(
        <div ref={menu} role="dialog" aria-label="Add interests" onKeyDown={(e) => e.key === "Escape" && setOpen(false)} style={{ position: "fixed", top: at.top, left: at.left, zIndex: 1000, width: at.width, background: "#fff", border: "1px solid #E6E0D8", borderRadius: 12, boxShadow: "0 16px 40px rgba(29,26,15,.14)", padding: 10, display: "flex", flexDirection: "column", gap: 8 }}>
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                if (isNew) addTyped();
                else if (list.length === 1) onToggle(list[0]);
              }
            }}
            maxLength={120}
            placeholder="Filter, or type your own"
            aria-label="Filter suggestions or type your own interest"
            className="f-brick"
            style={{ ...field, maxWidth: "none", height: 38 }}
          />
          <div style={{ maxHeight: 240, overflowY: "auto", display: "flex", flexDirection: "column" }}>
            {isNew && (
              <button type="button" onClick={addTyped} style={{ textAlign: "left", padding: "8px 6px", border: 0, background: "transparent", fontSize: 14, fontWeight: 600, color: "#99220F", cursor: "pointer" }}>
                + Add &ldquo;{q.trim()}&rdquo;
              </button>
            )}
            {list.map((t) => (
              <label key={t} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 6px", borderRadius: 8, fontSize: 14, color: "#1D1A0F", cursor: "pointer" }}>
                <input type="checkbox" checked={has(t)} onChange={() => onToggle(t)} />
                {t}
              </label>
            ))}
            {!list.length && !isNew && <div style={{ ...muted, padding: "6px" }}>{suggestions.length ? "No match." : "Suggestions show up once Lookout has read your profile. Type your own above."}</div>}
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
