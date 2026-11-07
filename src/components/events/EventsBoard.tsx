"use client";

import { Fragment, useMemo, useState } from "react";
import { boardEvents, defaultDir, EMPTY_FILTER, eventTally, type EventFilter, type EventSort, type EventView, type EventWhere } from "@/lib/eventsBoard";
import type { NetworkingEvent } from "@/lib/networking";
import { ArchiveIcon, PinIcon, SearchIcon } from "../icons";
import { IconBtn } from "../finds/Controls";
import { chip, seg } from "../finds/shared";
import { btn } from "../Settings";
import { color } from "@/lib/tokens";

const muted: React.CSSProperties = { fontSize: 14, color: color.t2 };
const GRID = "34px 36px 130px minmax(220px,2fr) minmax(150px,1fr) 124px 74px minmax(80px,.6fr)";
const pill = (on: boolean): React.CSSProperties => {
  const c = chip(on);
  return { display: "flex", alignItems: "center", gap: 7, height: 34, padding: "0 15px", borderRadius: 999, border: `1.5px solid ${c.border}`, background: c.bg, color: c.ink, fontSize: 14, fontWeight: 600, cursor: "pointer" };
};
const dateField: React.CSSProperties = { height: 34, border: "1.5px solid #E6E0D8", borderRadius: 10, padding: "0 10px", fontSize: 14, color: color.ink, background: "#fff" };

const day = (s: string) => new Date(`${s}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
const when = (e: NetworkingEvent) => `${day(e.startsOn)}${e.endsOn && e.endsOn !== e.startsOn ? ` to ${day(e.endsOn)}` : ""}`;
const distance = (e: NetworkingEvent) => (e.online ? "Online" : e.miles != null ? `${e.miles} mi` : "–");

type Props = {
  events: NetworkingEvent[];
  searching: boolean;
  canSearch: boolean;
  onSearch: () => void;
  onPatch: (ids: string[], patch: { pinned?: boolean; archived?: boolean; dismissed?: boolean }) => Promise<void>;
  onClear: () => Promise<void>;
};

/** The Events table (#265): select, open, sort, filter, pin, archive and Clear, built from the Finds board's controls and styles. */
export function EventsBoard({ events, searching, canSearch, onSearch, onPatch, onClear }: Props) {
  const [f, setF] = useState<EventFilter>(EMPTY_FILTER);
  const [sort, setSort] = useState<EventSort>("date");
  const [dir, setDir] = useState<"asc" | "desc">("asc");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [openId, setOpenId] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);

  const rows = useMemo(() => boardEvents(events, f, sort, dir), [events, f, sort, dir]);
  const tally = eventTally(events);
  const set = (patch: Partial<EventFilter>) => setF((x) => ({ ...x, ...patch }));
  const sortBy = (k: EventSort) => {
    if (k === sort) return setDir((d) => (d === "asc" ? "desc" : "asc"));
    setSort(k);
    setDir(defaultDir(k));
  };
  const arrow = (k: EventSort) => (sort === k ? (dir === "asc" ? "↑" : "↓") : "↕");
  const shown = rows.map((e) => e.id);
  const pickedShown = shown.filter((id) => picked.has(id));
  const allPicked = shown.length > 0 && pickedShown.length === shown.length;
  const togglePick = (id: string) => setPicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const bulk = async (patch: { pinned?: boolean; archived?: boolean }) => {
    await onPatch(pickedShown, patch);
    setPicked(new Set());
  };
  const unpinned = events.filter((e) => !e.pinned && !e.archived).length;

  return (
    <section style={{ background: "#fff", borderRadius: 16, overflow: "hidden", marginTop: 8 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "16px 18px", flexWrap: "wrap", borderBottom: "1px solid #EEEAE4" }}>
        {(["all", "pinned", "archived"] as EventView[]).map((k) => (
          <button key={k} onClick={() => { set({ view: k }); setPicked(new Set()); }} aria-pressed={f.view === k} style={pill(f.view === k)}>
            {k === "all" ? "All" : k === "pinned" ? "Pinned" : "Archived"}
            <span style={{ opacity: 0.65, fontWeight: 500 }}>{tally[k]}</span>
          </button>
        ))}
        <div role="group" aria-label="In person or online" style={{ display: "flex", gap: 4, padding: 4, background: "#F4F1EC", borderRadius: 12 }}>
          {([["any", "Any"], ["in-person", "In person"], ["online", "Online"]] as [EventWhere, string][]).map(([k, label]) => {
            const s = seg(f.where === k);
            return (
              <button key={k} onClick={() => set({ where: k })} aria-pressed={f.where === k} style={{ height: 28, padding: "0 12px", border: 0, borderRadius: 9, background: s.bg, color: s.ink, boxShadow: s.shadow, fontSize: 14, fontWeight: 600, cursor: "pointer" }}>
                {label}
              </button>
            );
          })}
        </div>
        <label style={{ ...muted, display: "flex", alignItems: "center", gap: 6 }}>
          From <input type="date" value={f.from} onChange={(e) => set({ from: e.target.value })} style={dateField} />
        </label>
        <label style={{ ...muted, display: "flex", alignItems: "center", gap: 6 }}>
          To <input type="date" value={f.to} onChange={(e) => set({ to: e.target.value })} style={dateField} />
        </label>
        <div style={{ display: "flex", alignItems: "center", gap: 6, height: 34, padding: "0 10px", border: "1.5px solid #E6E0D8", borderRadius: 10, flex: "1 1 180px", minWidth: 160 }}>
          <SearchIcon size={15} stroke=color.t2 />
          <input value={f.q} onChange={(e) => set({ q: e.target.value })} placeholder="Search events" aria-label="Search events" style={{ flex: 1, minWidth: 0, border: 0, outline: "none", background: "transparent", fontSize: 14, color: color.ink }} />
        </div>
        {canSearch && (
          <button onClick={onSearch} disabled={searching} style={btn("outline")}>
            {searching ? "Searching for events…" : "Search now"}
          </button>
        )}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 18px", borderBottom: "1px solid #EEEAE4", flexWrap: "wrap", minHeight: 52 }}>
        {pickedShown.length > 0 ? (
          <>
            <span style={{ fontSize: 14, fontWeight: 600 }}>{pickedShown.length} selected</span>
            <button onClick={() => bulk({ pinned: true })} style={{ ...btn("outline"), height: 32 }}>Pin</button>
            <button onClick={() => bulk({ pinned: false })} style={{ ...btn("outline"), height: 32 }}>Unpin</button>
            {f.view === "archived" ? (
              <button onClick={() => bulk({ archived: false })} style={{ ...btn("outline"), height: 32 }}>Restore</button>
            ) : (
              <button onClick={() => bulk({ archived: true })} style={{ ...btn("outline"), height: 32 }}>Archive</button>
            )}
            <button onClick={() => setPicked(new Set())} style={{ ...btn("text"), height: 32 }}>Clear selection</button>
          </>
        ) : (
          <span style={muted}>{rows.length} shown · pinned events stay on top</span>
        )}
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
          {confirmClear ? (
            <>
              <span style={{ fontSize: 14 }}>Archive {unpinned} unpinned {unpinned === 1 ? "event" : "events"}?</span>
              <button onClick={async () => { await onClear(); setConfirmClear(false); }} style={{ ...btn("danger"), height: 32 }}>Archive them</button>
              <button onClick={() => setConfirmClear(false)} style={{ ...btn("text"), height: 32 }}>Cancel</button>
            </>
          ) : (
            <button onClick={() => setConfirmClear(true)} disabled={!unpinned} data-tip="Archives every event you haven't pinned" style={{ ...btn("outline"), height: 32, opacity: unpinned ? 1 : 0.5 }}>Clear</button>
          )}
        </div>
      </div>

      <div style={{ overflowX: "auto" }}>
        <div role="table" aria-label="Events" style={{ minWidth: 900 }}>
          <div role="rowgroup">
            <div role="row" style={{ display: "grid", gridTemplateColumns: GRID, alignItems: "center", padding: "0 18px", height: 44, borderBottom: "1px solid #EEEAE4" }}>
              <div role="columnheader">
                <input type="checkbox" aria-label="Select all shown" checked={allPicked} onChange={() => setPicked(allPicked ? new Set() : new Set(shown))} />
              </div>
              <div role="columnheader" />
              {([["Date", "date"], ["Event", null], ["Where", null], ["Distance", "distance"], ["Fit", "fit"], ["Cost", null]] as [string, EventSort | null][]).map(([label, k]) => (
                <div key={label} role="columnheader" aria-sort={k && sort === k ? (dir === "asc" ? "ascending" : "descending") : undefined}>
                  {k ? (
                    <button className="no-tint" onClick={() => sortBy(k)} style={{ display: "flex", gap: 5, border: 0, background: "transparent", padding: 0, fontSize: 14, fontWeight: 600, letterSpacing: ".08em", textTransform: "uppercase", color: sort === k ? color.ink : color.t2, cursor: "pointer" }}>
                      {label} <span style={{ color: sort === k ? color.brick : "#CFC6B9" }}>{arrow(k)}</span>
                    </button>
                  ) : (
                    <span style={{ fontSize: 14, fontWeight: 600, letterSpacing: ".08em", textTransform: "uppercase", color: color.t2 }}>{label}</span>
                  )}
                </div>
              ))}
            </div>
          </div>
          <div role="rowgroup">
            {rows.length === 0 && <div style={{ ...muted, padding: "18px" }}>{f.view === "archived" ? "Nothing archived." : "No events match. Try another filter, or Search now."}</div>}
            {rows.map((e) => {
              const open = openId === e.id;
              return (
                <Fragment key={e.id}>
                  <div
                    role="row"
                    className="h-row"
                    aria-expanded={open}
                    tabIndex={0}
                    onClick={() => setOpenId(open ? null : e.id)}
                    onKeyDown={(k) => { if (k.key === "Enter" || k.key === " ") { k.preventDefault(); setOpenId(open ? null : e.id); } }}
                    style={{ display: "grid", gridTemplateColumns: GRID, alignItems: "center", padding: "0 18px", minHeight: 52, borderBottom: "1px solid #F2EEE8", cursor: "pointer", background: open ? "#FBF8F4" : undefined }}
                  >
                    <div role="cell" onClick={(x) => x.stopPropagation()}>
                      <input type="checkbox" aria-label={`Select ${e.title}`} checked={picked.has(e.id)} onChange={() => togglePick(e.id)} />
                    </div>
                    <div role="cell">
                      <IconBtn tip={e.pinned ? "Unpin" : "Pin"} pressed={!!e.pinned} onClick={() => void onPatch([e.id], { pinned: !e.pinned })} style={{ border: 0, background: "transparent" }}>
                        <PinIcon size={15} stroke={e.pinned ? color.brick : color.t2} />
                      </IconBtn>
                    </div>
                    <div role="cell" style={{ fontSize: 14, fontWeight: 600, color: color.brick }}>{when(e)}</div>
                    <div role="cell" style={{ fontSize: 14, fontWeight: 600, padding: "8px 12px 8px 0" }}>{e.title}{e.host && <div style={{ ...muted, fontWeight: 400 }}>{e.host}</div>}</div>
                    <div role="cell" style={{ ...muted, paddingRight: 12 }}>{e.online ? "Online" : e.place || "–"}</div>
                    <div role="cell" style={{ fontSize: 14, fontVariantNumeric: "tabular-nums" }}>{distance(e)}</div>
                    <div role="cell" style={{ fontSize: 14, fontWeight: 700 }}>{e.fit ?? "–"}</div>
                    <div role="cell" style={muted}>{e.cost || "–"}</div>
                  </div>
                  {open && (
                    <div role="row" style={{ padding: "12px 18px 16px 88px", borderBottom: "1px solid #F2EEE8", background: "#FBF8F4", display: "flex", flexDirection: "column", gap: 8 }}>
                      <div role="cell" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        <div style={{ fontSize: 14 }}>{[when(e), e.time].filter(Boolean).join(", ")} · {e.online ? "Online" : e.place} {e.cost && `· ${e.cost}`}</div>
                        {e.why && <div style={{ fontSize: 14 }}>{e.why}</div>}
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                          <a href={e.url} target="_blank" rel="noopener noreferrer" style={{ ...btn("solid"), height: 34, display: "inline-flex", alignItems: "center", textDecoration: "none" }}>See the event</a>
                          <button onClick={() => void onPatch([e.id], { archived: !e.archived })} style={{ ...btn("outline"), height: 34, display: "inline-flex", alignItems: "center", gap: 6 }}>
                            <ArchiveIcon size={14} /> {e.archived ? "Restore" : "Archive"}
                          </button>
                          <button onClick={() => void onPatch([e.id], { dismissed: true })} style={{ ...btn("text"), height: 34 }}>Not for me</button>
                        </div>
                      </div>
                    </div>
                  )}
                </Fragment>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
