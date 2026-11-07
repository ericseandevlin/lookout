"use client";

import { useCallback, useEffect, useState } from "react";
import { joinInterests, MILES, splitInterests, type EventFreq, type EventReach, type NetworkingEvent } from "@/lib/networking";
import { PageHead } from "./Profile";
import { btn, Row, Section, Seg } from "./Settings";
import { api } from "./store";

type Prefs = { interests: string; reach: EventReach; miles: number; freq: EventFreq };

const card: React.CSSProperties = { background: "#fff", borderRadius: 14, border: "1.5px solid #E6E0D8", padding: "14px 16px", display: "flex", flexDirection: "column", gap: 6 };
const muted: React.CSSProperties = { fontSize: 14, color: "#6B6358" };
const chip = (on: boolean): React.CSSProperties => ({
  minHeight: 36, padding: "0 14px", borderRadius: 999, border: `1.5px solid ${on ? "#1D1A0F" : "#E0D9CF"}`,
  background: on ? "#1D1A0F" : "#fff", color: on ? "#fff" : "#1D1A0F", fontSize: 14, fontWeight: 600, cursor: "pointer",
});
const field: React.CSSProperties = { width: "100%", maxWidth: 520, height: 42, border: "1.5px solid #E6E0D8", background: "#fff", borderRadius: 10, padding: "0 13px", fontSize: 14, color: "#1D1A0F" };

const when = (e: NetworkingEvent) => {
  const d = (s: string) => new Date(`${s}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
  return `${d(e.startsOn)}${e.endsOn && e.endsOn !== e.startsOn ? ` to ${d(e.endsOn)}` : ""}${e.time ? `, ${e.time}` : ""}`;
};

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
        setEvents(r.events.filter((e) => !e.archived));
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
  const dismiss = async (id: string) => {
    try {
      await api(`/api/networking-events/${id}`, { method: "PATCH", json: { dismissed: true } });
      setEvents((xs) => xs?.filter((x) => x.id !== id) ?? null);
    } catch (e) {
      setMsg({ text: e instanceof Error ? e.message : "Couldn't hide it", ok: false });
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

      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <Section>Upcoming</Section>
        {prefs?.interests && (
          <button onClick={searchNow} disabled={searching} style={{ ...btn("outline"), marginLeft: "auto" }}>
            {searching ? "Searching for events…" : "Search now"}
          </button>
        )}
      </div>
      {events === null && !msg && <div style={muted}>Loading…</div>}
      {events && !events.length && <div style={muted}>{prefs?.interests ? "Nothing yet. Events show up here after your next search." : "Pick an interest above and your searches will look for events too."}</div>}
      {events && events.length > 0 && (
        <ul style={{ listStyle: "none", margin: "8px 0 0", padding: 0, display: "flex", flexDirection: "column", gap: 10 }}>
          {events.map((e) => (
            <li key={e.id} style={card}>
              <div style={{ fontSize: 14, fontWeight: 600, color: "#99220F" }}>{when(e)}</div>
              <div style={{ fontSize: 16, fontWeight: 700 }}>{e.title}</div>
              <div style={muted}>
                {[e.host, e.online ? "Online" : e.place, e.cost].filter(Boolean).join(" · ")}
              </div>
              {e.why && <div style={{ fontSize: 14 }}>{e.why}</div>}
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 4 }}>
                <a href={e.url} target="_blank" rel="noopener noreferrer" style={{ ...btn("solid"), height: 34, display: "inline-flex", alignItems: "center", textDecoration: "none" }}>
                  See the event
                </a>
                <button onClick={() => dismiss(e.id)} style={{ ...btn("text"), height: 34 }}>
                  Not for me
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
