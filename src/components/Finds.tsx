"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  cellQuiet, cellText, dueDays, isNewFind, postedDays, scoreStyle, shortDate, slugOf, stageStyle,
} from "@/lib/board";
import { kindOf } from "@/lib/kinds";
import type { Find } from "@/lib/types";
import { CompCompare, useCurrentComp } from "./CurrentComp";
import { ArchiveIcon, ChevronDown, PinIcon, SearchIcon, SlidersIcon } from "./icons";
import { useCounts } from "./Shell";
import { LastReport, SearchPanel } from "./SearchPanel";
import { useStore } from "./store";
import { NextStep } from "./Profile";
import { trackClient } from "./track";
import { sortsFor, chip, seg, type SortKey } from "./finds/shared";
import { IconBtn, Menu, StageMenu, Switch } from "./finds/Controls";
import { SetupPanel } from "./finds/SetupPanel";
import { SearchNowButton } from "./finds/SearchNowButton";
import { AddLink } from "./finds/AddLink";
import { FilterSheet } from "./finds/FilterSheet";
import { Drawer } from "./finds/Drawer";
import { color } from "@/lib/tokens";

export { Switch } from "./finds/Controls";

type Filter = "all" | "new" | "archived";

/** Column widths (#8), keyed by column key so the grid follows the kind config. */
const WIDTH: Record<string, string> = {
  company: "minmax(170px,1.2fr)",
  role: "minmax(210px,1.6fr)",
  comp: "minmax(170px,1fr)",
  listed: "100px",
  location: "minmax(160px,1.1fr)",
  value: "minmax(150px,1fr)",
  due: "110px",
  setAside: "minmax(130px,1fr)",
};

/** One column's sort value for a find (#8): from the find itself, or its kind's stage order. */
const sortValue = (f: Find, key: SortKey): string | number =>
  key === "score" ? f.score
  : key === "company" ? f.company
  : key === "role" ? f.role
  : key === "location" ? f.location
  : key === "comp" ? (f.comp ? f.comp[1] : -1)
  : key === "stage" ? kindOf(f.type).stages.indexOf(f.stage)
  : key === "listed" ? -(postedDays(f) ?? 9999)
  : key === "value" ? (typeof f.attributes?.value === "number" ? f.attributes.value : -1)
  : key === "due" ? (dueDays(f) ?? 9999)
  : typeof f.attributes?.setAside === "string" ? f.attributes.setAside : "";

export function Finds() {
  const store = useStore();
  const { state, patchFind } = store;
  const { settings } = state;
  const { amount: currentComp } = useCurrentComp();
  const counts = useCounts(state);
  // Board columns, headers and stage list come from the profile's kind (#8).
  const cfg = kindOf(state.profile.kind);
  const SORTS = sortsFor(cfg);
  const GRID = `82px 76px ${cfg.board.columns.map((c) => WIDTH[c.key]).join(" ")} ${WIDTH[cfg.board.preStage.key]} 136px ${WIDTH[cfg.board.tail.key]}`;

  const [filter, setFilter] = useState<Filter>("all");
  const [fit, setFit] = useState(0);
  const [q, setQ] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("score");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [compOnly, setCompOnly] = useState(false);
  const [fitMenu, setFitMenu] = useState(false);
  const [stageMenu, setStageMenu] = useState<string | null>(null);
  // The stage menu renders in a top layer, placed from its button, so the board's scroll container can't clip it.
  const [menuAt, setMenuAt] = useState<React.CSSProperties>({});
  // Desktop rows and phone cards both exist in the DOM; only the one that was clicked shows its menu.
  const [menuSurface, setMenuSurface] = useState<"desk" | "mob">("desk");
  const toggleStageMenu = (e: React.MouseEvent<HTMLElement>, id: string, align: "left" | "right") => {
    e.stopPropagation();
    if (stageMenu === id) return setStageMenu(null);
    const r = e.currentTarget.getBoundingClientRect();
    const below = window.innerHeight - r.bottom;
    const up = below < 340 && r.top > below;
    setMenuAt({
      ...(up ? { bottom: window.innerHeight - r.top + 6 } : { top: r.bottom + 6 }),
      ...(align === "left" ? { left: r.left } : { right: window.innerWidth - r.right }),
    });
    setMenuSurface(align === "left" ? "desk" : "mob");
    setStageMenu(id);
    setFitMenu(false);
  };
  useEffect(() => {
    if (!stageMenu) return;
    const close = () => setStageMenu(null);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [stageMenu]);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [showReport, setShowReport] = useState(false);

  const finds = state.finds;
  const isNew = useCallback((f: Find) => isNewFind(f, settings.newDays), [settings.newDays]);
  const active = finds.filter((f) => !f.archived);
  const tally = { all: active.length, new: active.filter(isNew).length, archived: finds.length - active.length };

  const base = filter === "archived" ? finds.filter((f) => f.archived) : filter === "new" ? active.filter(isNew) : active;
  const rows = useMemo(() => {
    let list = base;
    if (fit) list = list.filter((f) => f.score >= fit);
    if (compOnly) list = list.filter((f) => f.comp);
    const needle = q.trim().toLowerCase();
    if (needle) list = list.filter((f) => [f.company, f.role, f.location, f.notes].join(" ").toLowerCase().includes(needle));
    const dir = sortDir === "asc" ? 1 : -1;
    return [...list].sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      const x = sortValue(a, sortKey), y = sortValue(b, sortKey);
      return (typeof x === "string" ? x.localeCompare(y as string) : x - (y as number)) * dir;
    });
  }, [base, fit, compOnly, q, sortKey, sortDir]);

  const fitCount = (m: number) => base.filter((f) => f.score >= m).length;

  // True while stepping between finds with previous/next, so the drawer doesn't replay its slide-in.
  const [switching, setSwitching] = useState(false);
  // Deep links: #company-role-slug opens the drawer.
  const open = useCallback(
    (id: string | null) => {
      const f = finds.find((x) => x.id === id);
      history.replaceState(null, "", location.pathname + location.search + (f ? "#" + slugOf(f) : ""));
      if (!id) setSwitching(false);
      setOpenId(id);
      setFitMenu(false);
      if (f && !f.seen) patchFind(f.id, { seen: true });
      if (f) trackClient("find_opened", f.id);
    },
    [finds, patchFind],
  );
  useEffect(() => {
    const read = () => {
      const s = decodeURIComponent(location.hash.slice(1));
      const f = s && finds.find((x) => slugOf(x) === s);
      if (f) {
        setFilter(f.archived ? "archived" : "all");
        setFit(0);
        setQ("");
        setOpenId(f.id);
        if (!f.seen) patchFind(f.id, { seen: true });
      }
    };
    read();
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
    // Only on mount: later updates to finds must not reopen a closed drawer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const closeMenus = () => {
    setStageMenu(null);
    setFitMenu(false);
  };
  // Ended stages archive the find, whichever kind it is (#180, #8).
  const setStage = (f: Find, s: string) => {
    if (!kindOf(f.type).endedStages.includes(s)) return patchFind(f.id, { stage: s });
    patchFind(f.id, { stage: s, archived: true });
    if (openId === f.id) open(null);
  };
  const toggle = (f: Find, k: "pinned" | "archived") => {
    patchFind(f.id, { [k]: !f[k] });
    if (k === "archived" && openId === f.id) open(null);
  };

  const sortLabel = (SORTS.find((s) => s[0] === sortKey) ?? SORTS[0])[1];
  const arrow = sortDir === "asc" ? "↑" : "↓";
  const filterCount = (fit ? 1 : 0) + (compOnly ? 1 : 0);
  const openFind = finds.find((f) => f.id === openId) ?? null;
  // Previous/next walk the board in its current filter and sort order; the drawer swaps in place without re-animating.
  const openIndex = openFind ? rows.findIndex((f) => f.id === openFind.id) : -1;
  const step = (d: number) => {
    const to = rows[openIndex + d];
    if (!to) return;
    setSwitching(true);
    open(to.id);
  };
  const dense = settings.density === "Compact";

  const sub = state.running
    ? state.running === "url" ? "Reading the posting you added…" : `Lookout is searching for new ${cfg.noun.many}…`
    : state.lastRunAt ? `Updated ${shortDate(state.lastRunAt)}` : finds.length ? `${tally.all} ${cfg.noun.many}` : "No searches yet";

  return (
    <>
      <div className="board-hdr">
        <div style={{ display: "flex", alignItems: "center", gap: 20, flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 260 }}>
            <h1 style={{ margin: 0, fontSize: 27, fontWeight: 700, letterSpacing: "-0.02em", lineHeight: "32px" }}>Finds</h1>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap", marginTop: 4 }}>
              <span className={state.running ? "pulse" : undefined} style={{ fontSize: 14, color: color.t2 }}>{sub}</span>
              {!state.running && state.lastReport && (
                <button onClick={() => { if (!showReport) trackClient("report_opened"); setShowReport(!showReport); }} aria-expanded={showReport} style={{ border: 0, background: "transparent", padding: 0, fontSize: 14, fontWeight: 600, color: color.brick, cursor: "pointer", textDecoration: "underline", textUnderlineOffset: 3 }}>
                  {showReport ? "Hide search report" : "See search report"}
                </button>
              )}
            </div>
          </div>
          <div className="hdr-tools" style={{ display: "flex", gap: 8, alignItems: "center", maxWidth: "100%" }}>
            <div className="board-search" style={{ display: "flex", alignItems: "center", gap: 10, background: "#F4F1EC", borderRadius: 999, padding: "0 16px", maxWidth: "100%" }}>
              <SearchIcon />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search company, role, notes..."
                aria-label="Search finds"
                style={{ flex: 1, minWidth: 0, background: "transparent", border: 0, outline: "none", color: color.ink, fontSize: 14 }}
              />
            </div>
            {!store.readOnly && (cfg.discovery || state.canSearch) && <SearchNowButton />}
            {!store.readOnly && cfg.discovery && <AddLink open={addOpen} setOpen={setAddOpen} />}
          </div>
        </div>
      </div>

      <div className="board-body">
        {showReport && !state.running && state.lastReport && <LastReport {...state.lastReport} onClose={() => setShowReport(false)} />}
        <SearchPanel ready={counts.answered === counts.total && state.materials.resume?.status === "done"} />
        <SetupPanel answered={counts.answered} sources={counts.sources} />

        <section className="board-sec" style={{ background: "#fff", overflow: "hidden" }}>
          {/* Desktop toolbar */}
          <div className="desk-only" style={{ display: "flex", alignItems: "center", gap: 8, padding: "18px 22px", flexWrap: "wrap", borderBottom: "1px solid #EEEAE4" }}>
            {(["all", "new", "archived"] as Filter[]).map((k) => {
              const c = chip(filter === k);
              return (
                <button key={k} onClick={() => { setFilter(k); setFitMenu(false); }} style={{ display: "flex", alignItems: "center", gap: 7, height: 34, padding: "0 15px", borderRadius: 999, border: `1.5px solid ${c.border}`, background: c.bg, color: c.ink, fontSize: 14, fontWeight: 600, cursor: "pointer" }}>
                  {k === "all" ? "All" : k === "new" ? "New" : "Archived"}
                  <span style={{ opacity: 0.65, fontWeight: 500 }}>{tally[k]}</span>
                </button>
              );
            })}
            <div style={{ width: 1, height: 22, background: color.border, margin: "0 4px" }} />
            <div style={{ position: "relative" }}>
              {(() => {
                const c = chip(!!fit);
                return (
                  <button onClick={() => { setFitMenu((v) => !v); setStageMenu(null); }} aria-expanded={fitMenu} style={{ display: "flex", alignItems: "center", gap: 7, height: 34, padding: "0 15px", borderRadius: 999, border: `1.5px solid ${c.border}`, background: c.bg, color: c.ink, fontSize: 14, fontWeight: 600, cursor: "pointer" }}>
                    {fit ? `Match · ${fit === 5 ? "5" : fit + "+"}` : "Match · Any"}
                    <ChevronDown />
                  </button>
                );
              })()}
              {fitMenu && (
                <Menu style={{ top: 40, left: 0, minWidth: 150 }}>
                  {([["Any match", 0], ["5 only", 5], ["4 and up", 4], ["3 and up", 3]] as const).map(([label, k]) => (
                    <button key={k} className="h-menu" onClick={() => { setFit(k); setFitMenu(false); }} style={{ display: "flex", justifyContent: "space-between", padding: "9px 12px", border: 0, borderRadius: 8, background: fit === k ? "#F6F2EC" : "transparent", fontSize: 14, fontWeight: 500, color: color.ink, cursor: "pointer", textAlign: "left" }}>
                      {label}
                      <span style={{ color: color.t2 }}>{fitCount(k)}</span>
                    </button>
                  ))}
                </Menu>
              )}
            </div>
            <div className="wide-only" style={{ marginLeft: "auto", fontSize: 14, color: color.t2 }}>Click a row for details · click a stage to change it</div>
          </div>

          {/* Mobile toolbar */}
          <div className="mob-only" style={{ padding: "14px 12px 12px", borderBottom: "1px solid #EEEAE4" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 4, padding: 4, background: "#F4F1EC", borderRadius: 12 }}>
                {(["all", "new", "archived"] as Filter[]).map((k) => {
                  const s = seg(filter === k);
                  return (
                    <button key={k} onClick={() => setFilter(k)} style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, height: 36, border: 0, borderRadius: 9, background: s.bg, color: s.ink, boxShadow: s.shadow, fontSize: 14, fontWeight: 600, cursor: "pointer" }}>
                      {k === "all" ? "All" : k === "new" ? "New" : "Archived"}
                      <span style={{ opacity: 0.6, fontWeight: 500 }}>{tally[k]}</span>
                    </button>
                  );
                })}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ flex: 1, minWidth: 0, fontSize: 14, color: color.t2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {rows.length} shown · Sorted by {sortLabel} {arrow}
                </div>
                <button onClick={() => setSheetOpen(true)} style={{ display: "flex", alignItems: "center", gap: 8, height: 40, padding: "0 14px", borderRadius: 999, border: `1.5px solid ${filterCount ? color.ink : "#E0D9CF"}`, background: filterCount ? "#FBF8F4" : "#fff", color: color.ink, fontSize: 14, fontWeight: 600, cursor: "pointer", flex: "none" }}>
                  <SlidersIcon />
                  Filter &amp; sort
                  {filterCount > 0 && (
                    <span style={{ minWidth: 20, height: 20, padding: "0 6px", borderRadius: 999, background: color.brick, color: "#fff", fontSize: 14, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>{filterCount}</span>
                  )}
                </button>
              </div>
            </div>
          </div>

          {/* Desktop table */}
          <div className="desk-only" style={{ overflowX: "auto" }}>
            <div style={{ minWidth: 1080 }} role="table" aria-label="Finds">
              <div role="rowgroup">
              <div role="row" style={{ display: "grid", gridTemplateColumns: GRID, alignItems: "center", padding: "0 22px", height: 46, borderBottom: "1px solid #EEEAE4" }}>
                {([["", null], ["Match", "score" as SortKey], ...cfg.board.columns.map((c) => [c.label, c.key as SortKey] as [string, SortKey]), [cfg.board.preStage.label, cfg.board.preStage.key as SortKey], ["Stage", "stage" as SortKey], [cfg.board.tail.label, cfg.board.tail.key as SortKey]] as [string, SortKey | null][]).map(([label, key]) => {
                  const on = key && sortKey === key;
                  return (
                    <div key={label} role="columnheader" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <button
                        className="no-tint"
                        onClick={() => key && (setSortDir(sortKey === key && sortDir === "desc" ? "asc" : "desc"), setSortKey(key))}
                        style={{ display: "flex", alignItems: "center", gap: 5, border: 0, background: "transparent", padding: 0, fontSize: 14, fontWeight: 600, letterSpacing: ".08em", textTransform: "uppercase", color: on ? color.ink : color.t2, cursor: key ? "pointer" : "default", textAlign: "left" }}
                      >
                        {label}
                        <span style={{ color: on ? color.brick : "#CFC6B9", marginRight: 16 }}>{key ? (on ? arrow : "↕") : ""}</span>
                      </button>
                      {key === "comp" && <Switch small on={compOnly} onClick={() => setCompOnly((v) => !v)} tip={compOnly ? "Showing only roles with posted comp. Click to show all." : "Hide roles with no comp posted"} />}
                    </div>
                  );
                })}
              </div>
              </div>
              <div role="rowgroup">
              {rows.map((f, i) => {
                const st = stageStyle(f.stage);
                const sc = scoreStyle(f.score);
                return (
                  <div
                    key={f.id}
                    role="row"
                    className="h-row lk-in"
                    onClick={() => open(f.id)}
                    style={{ animationDelay: `${Math.min(i, 14) * 28}ms`, position: "relative", zIndex: stageMenu === f.id ? 6 : undefined, display: "grid", gridTemplateColumns: GRID, alignItems: "center", padding: `${dense ? 9 : 16}px 22px`, borderBottom: "1px solid #F2EEE8", cursor: "pointer", background: f.pinned ? "#FFFBF6" : "#fff" }}
                  >
                    <div role="cell" style={{ display: "flex", gap: 6, alignItems: "center", position: "relative" }}>
                      {isNew(f) && <span data-tip="New this week" style={{ position: "absolute", left: -15, top: "50%", marginTop: -4, width: 8, height: 8, borderRadius: "50%", background: "#427D33" }} />}
                      <IconBtn tip={f.pinned ? "Unpin" : "Pin"} onClick={() => toggle(f, "pinned")} pressed={f.pinned} style={iconState(f.pinned)}>
                        <PinIcon size={15} sw={f.pinned ? 2.4 : 1.8} />
                      </IconBtn>
                      <IconBtn tip={f.archived ? "Restore" : "Archive"} onClick={() => toggle(f, "archived")} pressed={f.archived} style={iconState(f.archived)}>
                        <ArchiveIcon size={15} sw={f.archived ? 2.4 : 1.8} />
                      </IconBtn>
                    </div>
                    <div role="cell" style={{ paddingLeft: 13, width: 60 }}>
                      <div style={{ width: 30, height: 30, borderRadius: "50%", background: sc.bg, color: sc.ink, border: `1.5px solid ${sc.border}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 700 }}>{f.score}</div>
                    </div>
                    {cfg.board.columns.map((c, ci) =>
                      ci === 0 ? (
                        <div role="rowheader" key={c.key} style={{ fontSize: 14.5, fontWeight: 600, paddingRight: 16 }}>
                          {/* The keyboard and screen reader way into a find (#211); the row's click stays for pointers. */}
                          <button className="cell-link" onClick={(e) => { e.stopPropagation(); open(f.id); }} aria-label={`${f.role} at ${f.company}`}>
                            {cellText(f, c.key)}
                          </button>
                        </div>
                      ) : (
                        <div role="cell" key={c.key} style={{ fontSize: 14, fontWeight: c.key === "comp" || c.key === "value" ? 600 : 400, color: cellQuiet(f, c.key) ? color.t2 : c.key === "comp" || c.key === "value" ? color.brick : color.ink, fontVariantNumeric: "tabular-nums", paddingRight: 16, textWrap: "pretty" }}>
                          {cellText(f, c.key)}
                          {c.key === "comp" && <CompCompare f={f} current={currentComp} style={{ marginTop: 2 }} />}
                        </div>
                      ),
                    )}
                    <div role="cell" style={{ fontSize: 14, color: color.t2, fontStyle: cellQuiet(f, cfg.board.preStage.key) ? "italic" : "normal" }}>{cellText(f, cfg.board.preStage.key)}</div>
                    <div role="cell" style={{ position: "relative", paddingRight: 16 }}>
                      <button
                        data-tip="Change stage"
                        onClick={(e) => toggleStageMenu(e, f.id, "left")}
                        style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 10px", borderRadius: 999, fontSize: 14, fontWeight: 600, border: "1.5px solid rgba(29,26,15,.14)", background: st.bg, color: st.ink, cursor: "pointer" }}
                      >
                        {f.stage}
                        <ChevronDown />
                      </button>
                      {stageMenu === f.id && menuSurface === "desk" && (
                        <StageMenu stages={kindOf(f.type).stages} ended={kindOf(f.type).endedStages} current={f.stage} style={{ ...menuAt, minWidth: 150 }} onPick={(s) => { setStage(f, s); setStageMenu(null); }} />
                      )}
                    </div>
                    <div role="cell" style={{ fontSize: 14, color: color.t2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} data-tip={cellText(f, cfg.board.tail.key)}>{cellText(f, cfg.board.tail.key)}</div>
                  </div>
                );
              })}
              </div>
              {rows.length === 0 && <Empty hasAny={finds.length > 0} running={!!state.running} />}
            </div>
          </div>

          {/* Mobile cards */}
          <div className="mob-only">
            {rows.map((f, i) => {
              const st = stageStyle(f.stage);
              const sc = scoreStyle(f.score);
              return (
                <div key={f.id} className="lk-in" onClick={() => open(f.id)} style={{ animationDelay: `${Math.min(i, 14) * 28}ms`, position: "relative", zIndex: stageMenu === f.id ? 6 : undefined, display: "flex", gap: 12, alignItems: "flex-start", padding: "12px 12px 12px 20px", borderBottom: "1px solid #F2EEE8", background: f.pinned ? "#FFFBF6" : "#fff", cursor: "pointer" }}>
                  {isNew(f) && <span aria-label="New" style={{ position: "absolute", left: 7, top: 22, width: 8, height: 8, borderRadius: "50%", background: "#427D33" }} />}
                  <div style={{ width: 28, height: 28, borderRadius: "50%", background: sc.bg, color: sc.ink, border: `1.5px solid ${sc.border}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 700, flex: "none", marginTop: 1 }}>{f.score}</div>
                  <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 3 }}>
                    <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 14.5, fontWeight: 600, lineHeight: 1.3 }}>
                          <button className="cell-link" onClick={(e) => { e.stopPropagation(); open(f.id); }} aria-label={`${f.role} at ${f.company}`} style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.company}</button>
                          {f.pinned && <PinIcon size={13} stroke=color.brick sw={2} style={{ flex: "none" }} />}
                        </div>
                        <div style={{ fontSize: 14, lineHeight: 1.35, color: "#3A3428", marginTop: 1, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{f.role}</div>
                      </div>
                      <span style={{ flex: "none", fontSize: 14, color: color.t2, fontStyle: cellQuiet(f, cfg.board.preStage.key) ? "italic" : "normal", whiteSpace: "nowrap", marginTop: 2 }}>{cellText(f, cfg.board.preStage.key)}</span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginTop: 2 }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 14, fontWeight: 600, color: color.brick, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{cellText(f, cfg.board.columns[2].key)}</div>
                        {cfg.board.columns[2].key === "comp" && <CompCompare f={f} current={currentComp} />}
                      </div>
                      <div style={{ position: "relative", flex: "none" }}>
                        <button onClick={(e) => toggleStageMenu(e, f.id, "right")} style={{ display: "inline-flex", alignItems: "center", gap: 4, height: 26, padding: "0 8px 0 10px", borderRadius: 999, fontSize: 14, fontWeight: 600, border: "1.5px solid rgba(29,26,15,.14)", background: st.bg, color: st.ink, cursor: "pointer", whiteSpace: "nowrap" }}>
                          {f.stage}
                          <ChevronDown size={11} />
                        </button>
                        {stageMenu === f.id && menuSurface === "mob" && (
                          <StageMenu stages={kindOf(f.type).stages} ended={kindOf(f.type).endedStages} mobile current={f.stage} style={{ ...menuAt, minWidth: 170 }} onPick={(s) => { setStage(f, s); setStageMenu(null); }} />
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
            {rows.length === 0 && <Empty hasAny={finds.length > 0} running={!!state.running} />}
          </div>
        </section>
      </div>

      {(stageMenu || fitMenu) && <div onClick={closeMenus} style={{ position: "fixed", inset: 0, zIndex: 4 }} />}

      {sheetOpen && (
        <FilterSheet
          close={() => setSheetOpen(false)}
          fit={fit} setFit={setFit} fitCount={fitCount}
          compOnly={compOnly} setCompOnly={setCompOnly} hasComp={cfg.board.columns.some((c) => c.key === "comp")}
          sortKey={sortKey} setSortKey={setSortKey} sortDir={sortDir} setSortDir={setSortDir} sorts={SORTS}
          shown={rows.length}
        />
      )}

      {openFind && (
        <Drawer
          key={openFind.id}
          f={openFind}
          currentComp={currentComp}
          close={() => open(null)}
          toggle={toggle}
          setStage={setStage}
          enter={!switching}
          nav={{
            index: openIndex,
            total: rows.length,
            prev: openIndex > 0 ? () => step(-1) : undefined,
            next: openIndex >= 0 && openIndex < rows.length - 1 ? () => step(1) : undefined,
          }}
        />
      )}
    </>
  );
}

function Empty({ hasAny, running }: { hasAny: boolean; running: boolean }) {
  return (
    <div style={{ padding: "48px 22px", textAlign: "center", color: color.t2, fontSize: 14 }}>
      {hasAny ? "No roles match this view." : running ? "Searching now. New finds will show up here." : (
        <div style={{ maxWidth: 560, margin: "0 auto", textAlign: "left" }}><NextStep here="finds" /></div>
      )}
    </div>
  );
}

// Row pin/archive buttons stay quiet so the match score is the loudest thing in the row: no box until hover,
// and active is a brick-red icon rather than a fill.
const iconState = (on: boolean): React.CSSProperties =>
  on ? { border: "1px solid transparent", background: "transparent", color: color.brick } : { border: "1px solid transparent", background: "transparent", color: "#857C70" };
