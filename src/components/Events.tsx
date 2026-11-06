"use client";

import { useEffect, useState } from "react";
import { MILES, type EventReach, type NetworkingEvent } from "@/lib/networking";
import { PageHead } from "./Profile";
import { btn, Row, Section, Seg } from "./Settings";
import { api } from "./store";

type Prefs = { interests: string; reach: EventReach; miles: number };

const card: React.CSSProperties = { background: "#fff", borderRadius: 14, border: "1.5px solid #E6E0D8", padding: "14px 16px", display: "flex", flexDirection: "column", gap: 6 };
const muted: React.CSSProperties = { fontSize: 14, color: "#6B6358" };
const field: React.CSSProperties = { width: "100%", maxWidth: 520, height: 42, border: "1.5px solid #E6E0D8", background: "#fff", borderRadius: 10, padding: "0 13px", fontSize: 14, color: "#1D1A0F" };

const when = (e: NetworkingEvent) => {
  const d = (s: string) => new Date(`${s}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
  return `${d(e.startsOn)}${e.endsOn && e.endsOn !== e.startsOn ? ` to ${d(e.endsOn)}` : ""}${e.time ? `, ${e.time}` : ""}`;
};

/** /events: networking events the sweep found (#7), apart from job finds, with what to look for. */
export function Events() {
  const [events, setEvents] = useState<NetworkingEvent[] | null>(null);
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [draft, setDraft] = useState("");
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);

  useEffect(() => {
    api<{ events: NetworkingEvent[]; prefs: Prefs }>("/api/networking-events")
      .then((r) => {
        setEvents(r.events);
        setPrefs(r.prefs);
        setDraft(r.prefs.interests);
      })
      .catch((e) => setMsg({ text: e instanceof Error ? e.message : "Couldn't load", ok: false }));
  }, []);

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
          <Row title="Interests" help="Topics, comma separated, e.g. design systems, AI product, accessibility. Leave empty to turn event search off.">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                save({ ...prefs, interests: draft.trim() }, draft.trim() ? "Saved. Your next search looks for events too." : "Event search is off.");
              }}
              style={{ display: "flex", gap: 8, flexWrap: "wrap" }}
            >
              <label htmlFor="ev-interests" style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>
                Event interests
              </label>
              <input id="ev-interests" value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={300} placeholder="design systems, AI product" className="f-brick" style={{ ...field, flex: "1 1 260px" }} />
              <button type="submit" disabled={draft.trim() === prefs.interests} style={btn("outline")}>
                Save
              </button>
            </form>
          </Row>
          <Row title="Where" help="In person near where you live (from your profile), online, or both.">
            <Seg opts={[["Nearby", "nearby"], ["Online", "online"], ["Both", "both"]]} cur={prefs.reach} pick={(v) => save({ ...prefs, reach: v as EventReach }, "Saved.")} />
          </Row>
          {prefs.reach !== "online" && (
            <Row title="How far" help="For in-person events.">
              <Seg opts={MILES.map((m) => [`${m} mi`, m] as [string, number])} cur={prefs.miles} pick={(v) => save({ ...prefs, miles: v }, "Saved.")} />
            </Row>
          )}
        </>
      )}

      <Section>Upcoming</Section>
      {events === null && !msg && <div style={muted}>Loading…</div>}
      {events && !events.length && <div style={muted}>{prefs?.interests ? "Nothing yet. Events show up here after your next search." : "Add an interest above and your searches will look for events too."}</div>}
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
