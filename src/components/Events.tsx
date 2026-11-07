"use client";

import { useCallback, useEffect, useState } from "react";
import { joinInterests, MILES, splitInterests, type EventFreq, type EventReach, type NetworkingEvent } from "@/lib/networking";
import { PageHead } from "./Profile";
import { btn, Row, Section, Seg } from "./Settings";
import { api } from "./store";
import { EventsBoard } from "./events/EventsBoard";

type Prefs = { interests: string; reach: EventReach; miles: number; freq: EventFreq };

const muted: React.CSSProperties = { fontSize: 14, color: "#6B6358" };
const chip = (on: boolean): React.CSSProperties => ({
  minHeight: 36, padding: "0 14px", borderRadius: 999, border: `1.5px solid ${on ? "#1D1A0F" : "#E0D9CF"}`,
  background: on ? "#1D1A0F" : "#fff", color: on ? "#fff" : "#1D1A0F", fontSize: 14, fontWeight: 600, cursor: "pointer",
});
const field: React.CSSProperties = { width: "100%", maxWidth: 520, height: 42, border: "1.5px solid #E6E0D8", background: "#fff", borderRadius: 10, padding: "0 13px", fontSize: 14, color: "#1D1A0F" };


/** /events: networking events the sweep found (#7), apart from job finds, with what to look for. */
export function Events() {
  const [events, setEvents] = useState<NetworkingEvent[] | null>(null);
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
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
  // Suggestions first, then anything they added themselves.
  const chips = [...suggestions, ...chosen.filter((c) => !suggestions.some((s) => s.toLowerCase() === c.toLowerCase()))];
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
    <div className="page-pad settings lk-page" style={{ display: "flex", flexDirection: "column", maxWidth: 820, gap: 4 }}>
      <PageHead eyebrow="Networking" title="Events" intro="Meetups, panels, industry nights, conferences and talks that fit your field, found with each search. Kept apart from your job finds. Past events drop off on their own." />
      {msg && (
        <div role={msg.ok ? "status" : "alert"} style={{ fontSize: 14, color: msg.ok ? "#35662A" : "#99220F" }}>
          {msg.text}
        </div>
      )}
      {prefs && (
        <>
          <Section>What to look for</Section>
          <Row title="Interests" help="Tap the topics you want events for. Suggestions come from what Lookout sees in your profile and get better as it fills in. Your first three picks go into each search.">
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {chips.length > 0 ? (
                <div role="group" aria-label="Event interests" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {chips.map((t) => (
                    <button type="button" key={t} aria-pressed={has(t)} onClick={() => toggle(t)} style={chip(has(t))}>
                      {t}
                    </button>
                  ))}
                </div>
              ) : (
                <div style={muted}>Suggestions show up here once Lookout has read your profile. You can add your own now.</div>
              )}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const add = splitInterests(draft);
                  if (!add.length) return;
                  setDraft("");
                  setInterests([...chosen, ...add]);
                }}
                style={{ display: "flex", gap: 8, flexWrap: "wrap" }}
              >
                <label htmlFor="ev-interests" style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>
                  Add your own interest
                </label>
                <input id="ev-interests" value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={120} placeholder="Add your own, e.g. accessibility" className="f-brick" style={{ ...field, flex: "1 1 260px" }} />
                <button type="submit" disabled={!draft.trim()} style={btn("outline")}>
                  Add
                </button>
              </form>
              {!chosen.length && <div style={muted}>Event search is off. Pick an interest to turn it on.</div>}
            </div>
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
