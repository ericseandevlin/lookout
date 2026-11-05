"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  compText, DAYS, ENDED_STAGES, isNewFind, postedDays, postedText, scoreStyle, shortDate, slugOf, STAGE_STYLE, STAGES,
} from "@/lib/board";
import type { Find, Stage } from "@/lib/types";
import { ArchiveIcon, ArrowUpRight, CheckIcon, ChevronDown, LinkIcon, PinIcon, PlusIcon, SearchIcon, SlidersIcon, XIcon } from "./icons";
import { useCounts } from "./Shell";
import { LastReport, SearchPanel } from "./SearchPanel";
import { api, useStore } from "./store";
import { NextStep } from "./Profile";
import { applicationLabel } from "@/lib/applyLabels";
import { SubmitModeNote } from "./SubmitModeNote";
import { trackClient } from "./track";
import { useFocusTrap } from "./useFocusTrap";

type SortKey = "score" | "company" | "role" | "comp" | "listed" | "stage" | "location";
type Filter = "all" | "new" | "archived";

const SORTS: [SortKey, string][] = [["score", "Match"], ["comp", "Comp"], ["listed", "Posted"], ["company", "Company"], ["role", "Role"], ["stage", "Stage"], ["location", "Location"]];
const GRID = "82px 76px minmax(170px,1.2fr) minmax(210px,1.6fr) minmax(170px,1fr) 100px 136px minmax(160px,1.1fr)";
const ON = { bg: "#99220F", ink: "#fff", border: "#99220F" };
const OFF = { bg: "#fff", ink: "#1D1A0F", border: "#E0D9CF" };
const chip = (on: boolean) => (on ? ON : OFF);
const seg = (on: boolean) => (on ? { bg: "#fff", ink: "#1D1A0F", shadow: "0 1px 3px rgba(29,26,15,.12)" } : { bg: "transparent", ink: "#6B6358", shadow: "none" });

const sortVal: Record<SortKey, (f: Find) => string | number> = {
  score: (f) => f.score,
  company: (f) => f.company,
  role: (f) => f.role,
  location: (f) => f.location,
  comp: (f) => (f.comp ? f.comp[1] : -1),
  stage: (f) => STAGES.indexOf(f.stage),
  listed: (f) => -(postedDays(f) ?? 9999),
};

export function Finds() {
  const store = useStore();
  const { state, patchFind } = store;
  const { settings } = state;
  const counts = useCounts(state);

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
    const sv = sortVal[sortKey];
    return [...list].sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      const x = sv(a), y = sv(b);
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
  // Closed, Ghosted, Not selected and Nope end a find, so they archive it too (#180).
  const setStage = (f: Find, s: Stage) => {
    if (!ENDED_STAGES.includes(s)) return patchFind(f.id, { stage: s });
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
    ? state.running === "url" ? "Reading the posting you added…" : "Lookout is searching for new roles…"
    : state.lastRunAt ? `Updated ${shortDate(state.lastRunAt)}` : finds.length ? `${tally.all} roles` : "No searches yet";

  return (
    <>
      <div className="board-hdr">
        <div style={{ display: "flex", alignItems: "center", gap: 20, flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 260 }}>
            <h1 style={{ margin: 0, fontSize: 27, fontWeight: 700, letterSpacing: "-0.02em", lineHeight: "32px" }}>Finds</h1>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap", marginTop: 4 }}>
              <span className={state.running ? "pulse" : undefined} style={{ fontSize: 14, color: "#6B6358" }}>{sub}</span>
              {!state.running && state.lastReport && (
                <button onClick={() => { if (!showReport) trackClient("report_opened"); setShowReport(!showReport); }} aria-expanded={showReport} style={{ border: 0, background: "transparent", padding: 0, fontSize: 14, fontWeight: 600, color: "#99220F", cursor: "pointer", textDecoration: "underline", textUnderlineOffset: 3 }}>
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
                style={{ flex: 1, minWidth: 0, background: "transparent", border: 0, outline: "none", color: "#1D1A0F", fontSize: 14 }}
              />
            </div>
            {!store.readOnly && (
              <>
                <SearchNowButton />
                <AddLink open={addOpen} setOpen={setAddOpen} />
              </>
            )}
          </div>
        </div>
      </div>

      <div className="board-body">
        {showReport && !state.running && state.lastReport && <LastReport {...state.lastReport} onClose={() => setShowReport(false)} />}
        <SearchPanel ready={counts.answered === 5 && state.materials.resume?.status === "done"} />
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
            <div style={{ width: 1, height: 22, background: "#E6E0D8", margin: "0 4px" }} />
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
                    <button key={k} className="h-menu" onClick={() => { setFit(k); setFitMenu(false); }} style={{ display: "flex", justifyContent: "space-between", padding: "9px 12px", border: 0, borderRadius: 8, background: fit === k ? "#F6F2EC" : "transparent", fontSize: 14, fontWeight: 500, color: "#1D1A0F", cursor: "pointer", textAlign: "left" }}>
                      {label}
                      <span style={{ color: "#6B6358" }}>{fitCount(k)}</span>
                    </button>
                  ))}
                </Menu>
              )}
            </div>
            <div className="wide-only" style={{ marginLeft: "auto", fontSize: 14, color: "#6B6358" }}>Click a row for details · click a stage to change it</div>
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
                <div style={{ flex: 1, minWidth: 0, fontSize: 14, color: "#6B6358", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {rows.length} shown · Sorted by {sortLabel} {arrow}
                </div>
                <button onClick={() => setSheetOpen(true)} style={{ display: "flex", alignItems: "center", gap: 8, height: 40, padding: "0 14px", borderRadius: 999, border: `1.5px solid ${filterCount ? "#1D1A0F" : "#E0D9CF"}`, background: filterCount ? "#FBF8F4" : "#fff", color: "#1D1A0F", fontSize: 14, fontWeight: 600, cursor: "pointer", flex: "none" }}>
                  <SlidersIcon />
                  Filter &amp; sort
                  {filterCount > 0 && (
                    <span style={{ minWidth: 20, height: 20, padding: "0 6px", borderRadius: 999, background: "#99220F", color: "#fff", fontSize: 14, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>{filterCount}</span>
                  )}
                </button>
              </div>
            </div>
          </div>

          {/* Desktop table */}
          <div className="desk-only" style={{ overflowX: "auto" }}>
            <div style={{ minWidth: 1080 }} role="table" aria-label="Finds">
              <div role="row" style={{ display: "grid", gridTemplateColumns: GRID, alignItems: "center", padding: "0 22px", height: 46, borderBottom: "1px solid #EEEAE4" }}>
                {([["", null], ["Match", "score"], ["Company", "company"], ["Role", "role"], ["Comp", "comp"], ["Posted", "listed"], ["Stage", "stage"], ["Location", "location"]] as [string, SortKey | null][]).map(([label, key]) => {
                  const on = key && sortKey === key;
                  return (
                    <div key={label} role="columnheader" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <button
                        className="no-tint"
                        onClick={() => key && (setSortDir(sortKey === key && sortDir === "desc" ? "asc" : "desc"), setSortKey(key))}
                        style={{ display: "flex", alignItems: "center", gap: 5, border: 0, background: "transparent", padding: 0, fontSize: 14, fontWeight: 600, letterSpacing: ".08em", textTransform: "uppercase", color: on ? "#1D1A0F" : "#6B6358", cursor: key ? "pointer" : "default", textAlign: "left" }}
                      >
                        {label}
                        <span style={{ color: on ? "#99220F" : "#CFC6B9", marginRight: 16 }}>{key ? (on ? arrow : "↕") : ""}</span>
                      </button>
                      {key === "comp" && <Switch small on={compOnly} onClick={() => setCompOnly((v) => !v)} tip={compOnly ? "Showing only roles with posted comp. Click to show all." : "Hide roles with no comp posted"} />}
                    </div>
                  );
                })}
              </div>
              {rows.map((f, i) => {
                const st = STAGE_STYLE[f.stage];
                const sc = scoreStyle(f.score);
                return (
                  <div
                    key={f.id}
                    role="row"
                    className="h-row lk-in"
                    onClick={() => open(f.id)}
                    style={{ animationDelay: `${Math.min(i, 14) * 28}ms`, position: "relative", zIndex: stageMenu === f.id ? 6 : undefined, display: "grid", gridTemplateColumns: GRID, alignItems: "center", padding: `${dense ? 9 : 16}px 22px`, borderBottom: "1px solid #F2EEE8", cursor: "pointer", background: f.pinned ? "#FFFBF6" : "#fff" }}
                  >
                    <div style={{ display: "flex", gap: 6, alignItems: "center", position: "relative" }}>
                      {isNew(f) && <span data-tip="New this week" style={{ position: "absolute", left: -15, top: "50%", marginTop: -4, width: 8, height: 8, borderRadius: "50%", background: "#427D33" }} />}
                      <IconBtn tip={f.pinned ? "Unpin" : "Pin"} onClick={() => toggle(f, "pinned")} pressed={f.pinned} style={iconState(f.pinned)}>
                        <PinIcon size={15} sw={f.pinned ? 2.4 : 1.8} />
                      </IconBtn>
                      <IconBtn tip={f.archived ? "Restore" : "Archive"} onClick={() => toggle(f, "archived")} pressed={f.archived} style={iconState(f.archived)}>
                        <ArchiveIcon size={15} sw={f.archived ? 2.4 : 1.8} />
                      </IconBtn>
                    </div>
                    <div style={{ paddingLeft: 13, width: 60 }}>
                      <div style={{ width: 30, height: 30, borderRadius: "50%", background: sc.bg, color: sc.ink, border: `1.5px solid ${sc.border}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 700 }}>{f.score}</div>
                    </div>
                    <div style={{ fontSize: 14.5, fontWeight: 600, paddingRight: 16 }}>{f.company}</div>
                    <div style={{ fontSize: 14, paddingRight: 16, textWrap: "pretty" }}>{f.role}</div>
                    <div style={{ fontSize: 14, fontWeight: f.comp ? 600 : 400, color: f.comp ? "#99220F" : "#6B6358", fontVariantNumeric: "tabular-nums" }}>{compText(f)}</div>
                    <div style={{ fontSize: 14, color: "#6B6358", fontStyle: f.postedAt ? "normal" : "italic" }}>{postedText(f)}</div>
                    <div style={{ position: "relative", paddingRight: 16 }}>
                      <button
                        data-tip="Change stage"
                        onClick={(e) => toggleStageMenu(e, f.id, "left")}
                        style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 10px", borderRadius: 999, fontSize: 14, fontWeight: 600, border: "1.5px solid rgba(29,26,15,.14)", background: st.bg, color: st.ink, cursor: "pointer" }}
                      >
                        {f.stage}
                        <ChevronDown />
                      </button>
                      {stageMenu === f.id && menuSurface === "desk" && (
                        <StageMenu current={f.stage} style={{ ...menuAt, minWidth: 150 }} onPick={(s) => { setStage(f, s); setStageMenu(null); }} />
                      )}
                    </div>
                    <div style={{ fontSize: 14, color: "#6B6358", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} data-tip={f.location}>{f.location}</div>
                  </div>
                );
              })}
              {rows.length === 0 && <Empty hasAny={finds.length > 0} running={!!state.running} />}
            </div>
          </div>

          {/* Mobile cards */}
          <div className="mob-only">
            {rows.map((f, i) => {
              const st = STAGE_STYLE[f.stage];
              const sc = scoreStyle(f.score);
              return (
                <div key={f.id} className="lk-in" onClick={() => open(f.id)} style={{ animationDelay: `${Math.min(i, 14) * 28}ms`, position: "relative", zIndex: stageMenu === f.id ? 6 : undefined, display: "flex", gap: 12, alignItems: "flex-start", padding: "12px 12px 12px 20px", borderBottom: "1px solid #F2EEE8", background: f.pinned ? "#FFFBF6" : "#fff", cursor: "pointer" }}>
                  {isNew(f) && <span aria-label="New" style={{ position: "absolute", left: 7, top: 22, width: 8, height: 8, borderRadius: "50%", background: "#427D33" }} />}
                  <div style={{ width: 28, height: 28, borderRadius: "50%", background: sc.bg, color: sc.ink, border: `1.5px solid ${sc.border}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 700, flex: "none", marginTop: 1 }}>{f.score}</div>
                  <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 3 }}>
                    <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 14.5, fontWeight: 600, lineHeight: 1.3 }}>
                          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.company}</span>
                          {f.pinned && <PinIcon size={13} stroke="#99220F" sw={2} style={{ flex: "none" }} />}
                        </div>
                        <div style={{ fontSize: 14, lineHeight: 1.35, color: "#3A3428", marginTop: 1, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{f.role}</div>
                      </div>
                      <span style={{ flex: "none", fontSize: 14, color: "#6B6358", fontStyle: f.postedAt ? "normal" : "italic", whiteSpace: "nowrap", marginTop: 2 }}>{postedText(f)}</span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginTop: 2 }}>
                      <span style={{ minWidth: 0, fontSize: 14, fontWeight: f.comp ? 600 : 400, color: f.comp ? "#99220F" : "#6B6358", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{compText(f)}</span>
                      <div style={{ position: "relative", flex: "none" }}>
                        <button onClick={(e) => toggleStageMenu(e, f.id, "right")} style={{ display: "inline-flex", alignItems: "center", gap: 4, height: 26, padding: "0 8px 0 10px", borderRadius: 999, fontSize: 14, fontWeight: 600, border: "1.5px solid rgba(29,26,15,.14)", background: st.bg, color: st.ink, cursor: "pointer", whiteSpace: "nowrap" }}>
                          {f.stage}
                          <ChevronDown size={11} />
                        </button>
                        {stageMenu === f.id && menuSurface === "mob" && (
                          <StageMenu mobile current={f.stage} style={{ ...menuAt, minWidth: 170 }} onPick={(s) => { setStage(f, s); setStageMenu(null); }} />
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
          compOnly={compOnly} setCompOnly={setCompOnly}
          sortKey={sortKey} setSortKey={setSortKey} sortDir={sortDir} setSortDir={setSortDir}
          shown={rows.length}
        />
      )}

      {openFind && (
        <Drawer
          key={openFind.id}
          f={openFind}
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
    <div style={{ padding: "48px 22px", textAlign: "center", color: "#6B6358", fontSize: 14 }}>
      {hasAny ? "No roles match this view." : running ? "Searching now. New finds will show up here." : (
        <div style={{ maxWidth: 560, margin: "0 auto", textAlign: "left" }}><NextStep here="finds" /></div>
      )}
    </div>
  );
}

function Menu({ style, children, onClick }: { style: React.CSSProperties; children: React.ReactNode; onClick?: (e: React.MouseEvent) => void }) {
  return (
    <div onClick={onClick} role="menu" style={{ position: "absolute", zIndex: 6, background: "#fff", borderRadius: 12, boxShadow: "0 8px 28px rgba(29,26,15,.18)", padding: 6, display: "flex", flexDirection: "column", ...style }}>
      {children}
    </div>
  );
}

function StageMenu({ current, onPick, style, mobile }: { current: Stage; onPick: (s: Stage) => void; style: React.CSSProperties; mobile?: boolean }) {
  return createPortal(
    <Menu style={{ position: "fixed", zIndex: 40, ...style }} onClick={(e) => e.stopPropagation()}>
      {STAGES.map((s, i) => (
        <div key={s} style={{ display: "contents" }}>
          {i === 4 && <div style={{ height: 1, background: "#EEEAE4", margin: "4px 6px" }} />}
          <button
            role="menuitem"
            className="h-menu"
            data-tip={ENDED_STAGES.includes(s) ? "Archives it" : undefined}
            onClick={(e) => { e.stopPropagation(); onPick(s); }}
            style={{ display: "flex", alignItems: "center", gap: 9, padding: mobile ? "0 10px" : "8px 10px", minHeight: mobile ? 40 : undefined, border: 0, borderRadius: 8, background: s === current ? "#F6F2EC" : "transparent", fontSize: mobile ? 14 : 13, fontWeight: 500, color: "#1D1A0F", cursor: "pointer", textAlign: "left", whiteSpace: "nowrap" }}
          >
            <span style={{ width: 10, height: 10, borderRadius: "50%", background: STAGE_STYLE[s].bg, border: `1.5px solid ${STAGE_STYLE[s].bg}`, flex: "none" }} />
            {s}
          </button>
        </div>
      ))}
    </Menu>,
    document.body,
  );
}

function IconBtn({ tip, onClick, style, pressed, children }: { tip: string; onClick: () => void; style: React.CSSProperties; pressed?: boolean; children: React.ReactNode }) {
  return (
    <button
      data-tip={tip}
      aria-label={tip}
      aria-pressed={pressed}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      style={{ width: 30, height: 30, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", padding: 0, ...style }}
    >
      {children}
    </button>
  );
}

export function Switch({ on, onClick, tip, small, disabled }: { on: boolean; onClick: () => void; tip?: string; small?: boolean; disabled?: boolean }) {
  const w = small ? 28 : 40, h = small ? 16 : 22, k = small ? 12 : 16, p = small ? 2 : 3;
  return (
    <button
      role="switch"
      aria-checked={on}
      aria-label={tip}
      data-tip={tip}
      disabled={disabled}
      onClick={onClick}
      style={{ width: w, height: h, borderRadius: 999, border: 0, padding: p, background: on ? "#99220F" : "#D8D0C4", cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.5 : 1, display: "flex", justifyContent: on ? "flex-end" : "flex-start", transition: "background .15s", flex: "none" }}
    >
      <span style={{ width: k, height: k, borderRadius: "50%", background: "#fff", boxShadow: "0 1px 2px rgba(0,0,0,.2)" }} />
    </button>
  );
}

function SetupPanel({ answered, sources }: { answered: number; sources: number }) {
  const { state } = useStore();
  const st = state.settings;
  const d1 = answered === 5;
  const d2 = state.materials.resume?.status === "done";
  const ready = d1 && d2;
  if (st.setup === "Never" || (st.setup === "Until complete" && ready)) return null;
  const s3 = !ready
    ? "Starts once 1 and 2 are done"
    : st.freq === "Weekly" ? `Next run ${DAYS[st.day]}` : st.freq === "Twice a week" ? `Runs ${st.days.join(" & ")}` : "Runs daily";

  const tiles = [
    { n: 1, done: d1, status: d1 ? "Done" : `${answered} of 5 answered`, title: "Answer five questions", body: "What you want next, the comp you need, and what’s off the table.", href: "/profile", btn: d1 ? "Review answers" : answered > 0 ? "Continue" : "Start profile" },
    { n: 2, done: d2, status: d2 ? `${sources} of 3 added` : "Resume needed", title: "Add your materials", body: "Your resume, LinkedIn and any links. Lookout reads these to fill in gaps and to write in your voice.", href: "/profile/materials", btn: d2 ? "Review materials" : "Add materials" },
    { n: 3, done: false, status: s3, title: "Lookout gets to work", body: "New matches land here each week with a green dot. Pin, archive and move them through stages as you go." },
  ];
  return (
    <div className="setup board-sec lk-in" style={{ background: "#1D1A0F", color: "#fff", display: "flex", flexDirection: "column" }}>
      <div>
        <div style={{ fontSize: 14, fontWeight: 700, letterSpacing: ".14em", textTransform: "uppercase", color: "#F8A865" }}>Getting started</div>
        <div className="setup-title" style={{ fontWeight: 700, letterSpacing: "-0.01em", marginTop: 6, textWrap: "pretty" }}>Tell Lookout what you&apos;re looking for</div>
        <div style={{ fontSize: 14, lineHeight: 1.5, color: "#C9C1B5", marginTop: 6, maxWidth: 620, textWrap: "pretty" }}>
          Lookout searches for new roles every week and scores each one against your profile. The more it knows about you, the better the matches on this board.
        </div>
      </div>
      <div className="setup-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))" }}>
        {tiles.map((t) => (
          <div key={t.n} className="setup-tile" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
                <div style={{ fontSize: 30, fontWeight: 700, lineHeight: 1, letterSpacing: "-0.02em", color: "#F8A865" }}>{t.n}</div>
                {t.done && <span style={{ fontSize: 14, fontWeight: 700, letterSpacing: ".12em", color: "#F8A865" }}>COMPLETE</span>}
              </div>
              {t.done ? <CheckIcon stroke="#F8A865" /> : <div style={{ fontSize: 14, fontWeight: 600, color: "#A89F92" }}>{t.status}</div>}
            </div>
            <div style={{ fontSize: 15.5, fontWeight: 600 }}>{t.title}</div>
            <div style={{ fontSize: 14, lineHeight: 1.5, color: "#C9C1B5", textWrap: "pretty", flex: 1 }}>{t.body}</div>
            {t.href && (
              <Link href={t.href} style={{ alignSelf: "flex-start", height: 34, padding: "0 14px", borderRadius: 999, background: t.done ? "rgba(255,255,255,.1)" : "#F8A865", color: t.done ? "#fff" : "#1D1A0F", fontSize: 14, fontWeight: 600, marginTop: 4, display: "inline-flex", alignItems: "center", textDecoration: "none" }}>
                {t.btn}
              </Link>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function SearchNowButton() {
  const { searchNow, fail, state } = useStore();
  const [busy, setBusy] = useState(false);
  const running = !!state.running;
  const go = async () => {
    setBusy(true);
    try {
      await searchNow();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <button
      onClick={go}
      disabled={running || busy}
      data-tip={running ? "A search is running" : "Look for new roles now"}
      aria-label="Search now"
      className="board-search"
      style={{ width: "auto", flex: "none", display: "flex", alignItems: "center", gap: 6, padding: "0 14px", borderRadius: 999, border: "1.5px solid #1D1A0F", background: "#fff", color: "#1D1A0F", fontSize: 14, fontWeight: 600, cursor: running || busy ? "default" : "pointer", opacity: running || busy ? 0.5 : 1 }}
    >
      <span aria-hidden style={{ fontSize: 15, lineHeight: 1 }}>↻</span>
      <span className="desk-only">{running ? "Searching…" : "Search now"}</span>
    </button>
  );
}

function AddLink({ open, setOpen }: { open: boolean; setOpen: (v: boolean) => void }) {
  const { addFindByUrl, state } = useStore();
  const [url, setUrl] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!url.trim()) return;
    setBusy(true);
    setMsg(null);
    try {
      await addFindByUrl(url.trim());
      setUrl("");
      setOpen(false);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Couldn't add that link");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div style={{ position: "relative", flex: "none" }}>
      <button
        onClick={() => setOpen(!open)}
        disabled={!!state.running}
        data-tip="Add a posting by link"
        aria-label="Add a posting by link"
        className="board-search"
        style={{ width: "auto", display: "flex", alignItems: "center", gap: 6, padding: "0 14px", borderRadius: 999, border: 0, background: "#1D1A0F", color: "#fff", fontSize: 14, fontWeight: 600, cursor: state.running ? "default" : "pointer", opacity: state.running ? 0.5 : 1 }}
      >
        <PlusIcon />
        <span className="desk-only">Add</span>
      </button>
      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 5 }} />
          <div style={{ position: "absolute", right: 0, top: 46, zIndex: 6, width: 340, maxWidth: "calc(100vw - 32px)", background: "#fff", borderRadius: 12, boxShadow: "0 8px 28px rgba(29,26,15,.18)", padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ fontSize: 14.5, fontWeight: 600 }}>Add a posting</div>
            <div style={{ fontSize: 14, color: "#6B6358", lineHeight: 1.45 }}>Paste a link. Lookout reads it, scores it against your profile and adds it to the board.</div>
            <div style={{ display: "flex", gap: 6 }}>
              <input
                autoFocus
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") submit(); if (e.key === "Escape") setOpen(false); }}
                placeholder="https://..."
                aria-label="Posting link"
                className="f-brick"
                style={{ flex: 1, minWidth: 0, height: 40, borderRadius: 10, border: "1.5px solid #E6E0D8", padding: "0 12px", fontSize: 14, outline: "none" }}
              />
              <button onClick={submit} disabled={busy} style={{ height: 40, padding: "0 14px", borderRadius: 10, border: 0, background: "#99220F", color: "#fff", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>
                {busy ? "Adding…" : "Add"}
              </button>
            </div>
            {msg && <div style={{ fontSize: 14, color: "#99220F" }}>{msg}</div>}
          </div>
        </>
      )}
    </div>
  );
}

function FilterSheet(p: {
  close: () => void;
  fit: number; setFit: (n: number) => void; fitCount: (n: number) => number;
  compOnly: boolean; setCompOnly: (v: boolean) => void;
  sortKey: SortKey; setSortKey: (k: SortKey) => void;
  sortDir: "asc" | "desc"; setSortDir: (d: "asc" | "desc") => void;
  shown: number;
}) {
  const box = useRef<HTMLDivElement>(null);
  useFocusTrap(box);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && p.close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [p]);
  return (
    <>
      <div onClick={p.close} style={{ position: "fixed", inset: 0, background: "rgba(29,26,15,.32)", zIndex: 30 }} />
      <div ref={box} role="dialog" aria-modal="true" aria-label="Filter and sort" style={{ position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 31, background: "#fff", borderRadius: "20px 20px 0 0", boxShadow: "0 -12px 40px rgba(29,26,15,.18)", padding: "10px 16px calc(16px + env(safe-area-inset-bottom))", display: "flex", flexDirection: "column", gap: 20, maxHeight: "85vh", overflowY: "auto" }}>
        <div style={{ width: 36, height: 4, borderRadius: 999, background: "#E0D9CF", alignSelf: "center" }} />
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ fontSize: 18, fontWeight: 700 }}>Filter &amp; sort</div>
          <button onClick={() => { p.setFit(0); p.setCompOnly(false); p.setSortKey("score"); p.setSortDir("desc"); }} style={{ border: 0, background: "transparent", padding: "8px 0 8px 12px", fontSize: 14, fontWeight: 600, color: "#99220F", cursor: "pointer" }}>Reset</button>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <SheetLabel>Match</SheetLabel>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,minmax(0,1fr))", gap: 8 }}>
            {([["Any", 0], ["5", 5], ["4+", 4], ["3+", 3]] as const).map(([label, k]) => {
              const c = chip(p.fit === k);
              return (
                <button key={k} onClick={() => p.setFit(k)} style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 1, height: 52, borderRadius: 12, border: `1.5px solid ${c.border}`, background: c.bg, color: c.ink, cursor: "pointer" }}>
                  <span style={{ fontSize: 14, fontWeight: 600 }}>{label}</span>
                  <span style={{ fontSize: 14, opacity: 0.7 }}>{p.fitCount(k)}</span>
                </button>
              );
            })}
          </div>
        </div>
        <button onClick={() => p.setCompOnly(!p.compOnly)} role="switch" aria-checked={p.compOnly} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, minHeight: 48, padding: 0, border: 0, background: "transparent", cursor: "pointer", textAlign: "left" }}>
          <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <span style={{ fontSize: 14.5, fontWeight: 600, color: "#1D1A0F" }}>Only roles with comp posted</span>
            <span style={{ fontSize: 14, color: "#6B6358" }}>Hides listings with no pay range</span>
          </span>
          <span style={{ width: 44, height: 26, borderRadius: 999, background: p.compOnly ? "#99220F" : "#D8D0C4", display: "flex", justifyContent: p.compOnly ? "flex-end" : "flex-start", padding: 3, flex: "none" }}>
            <span style={{ width: 20, height: 20, borderRadius: "50%", background: "#fff", boxShadow: "0 1px 3px rgba(29,26,15,.25)" }} />
          </span>
        </button>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <SheetLabel>Sort by</SheetLabel>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {SORTS.map(([k, label]) => {
              const c = chip(k === p.sortKey);
              return (
                <button key={k} onClick={() => p.setSortKey(k)} style={{ height: 38, padding: "0 15px", borderRadius: 999, border: `1.5px solid ${c.border}`, background: c.bg, color: c.ink, fontSize: 14, fontWeight: 600, cursor: "pointer" }}>{label}</button>
              );
            })}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 4, padding: 4, background: "#F4F1EC", borderRadius: 12 }}>
            {([["desc", "↓ Descending"], ["asc", "↑ Ascending"]] as const).map(([d, label]) => {
              const s = seg(p.sortDir === d);
              return (
                <button key={d} onClick={() => p.setSortDir(d)} style={{ height: 38, border: 0, borderRadius: 9, background: s.bg, color: s.ink, boxShadow: s.shadow, fontSize: 14, fontWeight: 600, cursor: "pointer" }}>{label}</button>
              );
            })}
          </div>
        </div>
        <button onClick={p.close} style={{ height: 48, borderRadius: 12, border: 0, background: "#99220F", color: "#fff", fontSize: 15, fontWeight: 600, cursor: "pointer" }}>Show {p.shown} roles</button>
      </div>
    </>
  );
}

const SheetLabel = ({ children }: { children: React.ReactNode }) => (
  <div style={{ fontSize: 14, fontWeight: 700, letterSpacing: ".1em", textTransform: "uppercase", color: "#1D1A0F" }}>{children}</div>
);

const Label = ({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) => (
  <div style={{ fontSize: 14, letterSpacing: ".1em", textTransform: "uppercase", color: "#1D1A0F", fontWeight: 700, ...style }}>{children}</div>
);

const NOTES_IDLE_MS = 6000;
// Row pin/archive buttons stay quiet so the match score is the loudest thing in the row: no box until hover,
// and active is a brick-red icon rather than a fill.
const iconState = (on: boolean): React.CSSProperties =>
  on ? { border: "1px solid transparent", background: "transparent", color: "#99220F" } : { border: "1px solid transparent", background: "transparent", color: "#857C70" };
const DRAWER_MS = 220;

const NOT_A_FIT = ["Wrong level", "Wrong kind of role", "Wrong industry", "Location", "Pay", "Not that company", "Just not interested"];

type DrawerNav = { index: number; total: number; prev?: () => void; next?: () => void };

function Drawer({ f, close, toggle, setStage, enter, nav }: { f: Find; close: () => void; toggle: (f: Find, k: "pinned" | "archived") => void; setStage: (f: Find, s: Stage) => void; enter: boolean; nav: DrawerNav }) {
  const { patchFind, state, refresh, readOnly } = useStore();
  const [applyMsg, setApplyMsg] = useState<string | null>(null);
  const applyWithLookout = async () => {
    setApplyMsg("Queuing…");
    try {
      await api("/api/apply", { method: "POST", json: { findId: f.id } });
      await refresh();
      setApplyMsg(null);
    } catch (e) {
      setApplyMsg(e instanceof Error ? e.message : "Couldn't queue it");
    }
  };
  const [notes, setNotes] = useState(f.notes);
  const [noteState, setNoteState] = useState<"idle" | "saving" | "saved">("idle");
  const [copied, setCopied] = useState(false);
  const [asking, setAsking] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const timers = useRef<{ save?: ReturnType<typeof setTimeout>; hide?: ReturnType<typeof setTimeout>; copy?: ReturnType<typeof setTimeout> }>({});
  const closeBtn = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLElement>(null);
  useFocusTrap(panel);
  // Notes stay local while typing; they save after a long pause or when the drawer closes, so typing never stalls.
  const pending = useRef<string | null>(null);
  const navRef = useRef(nav);
  useEffect(() => {
    navRef.current = nav;
  });

  const flushNotes = useCallback(async () => {
    clearTimeout(timers.current.save);
    const v = pending.current;
    if (v === null) return;
    pending.current = null;
    setNoteState("saving");
    await patchFind(f.id, { notes: v });
    setNoteState("saved");
    clearTimeout(timers.current.hide);
    timers.current.hide = setTimeout(() => setNoteState("idle"), 2000);
  }, [f.id, patchFind]);

  const animatedClose = useCallback(() => {
    flushNotes();
    setLeaving(true);
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    setTimeout(close, reduce ? 0 : DRAWER_MS);
  }, [close, flushNotes]);

  useEffect(() => {
    closeBtn.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") return animatedClose();
      const typing = (e.target as HTMLElement | null)?.closest("input, textarea, select, [contenteditable]");
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "ArrowLeft" || e.key === "k") navRef.current.prev?.();
      if (e.key === "ArrowRight" || e.key === "j") navRef.current.next?.();
    };
    // Leaving the page with unsaved notes: send them with keepalive so the request outlives the tab.
    const onHide = () => {
      if (pending.current === null) return;
      fetch(`/api/finds/${f.id}`, { method: "PATCH", keepalive: true, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ notes: pending.current }) });
      pending.current = null;
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pagehide", onHide);
    const t = timers.current;
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pagehide", onHide);
      clearTimeout(t.hide);
      clearTimeout(t.copy);
      if (pending.current !== null) {
        clearTimeout(t.save);
        patchFind(f.id, { notes: pending.current });
        pending.current = null;
      }
    };
  }, [animatedClose, f.id, patchFind]);

  const onNotes = (v: string) => {
    setNotes(v);
    pending.current = v;
    clearTimeout(timers.current.save);
    timers.current.save = setTimeout(flushNotes, NOTES_IDLE_MS);
  };
  const copy = () => {
    const url = location.href.split("#")[0] + "#" + slugOf(f);
    (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject())
      .catch(() => {})
      .finally(() => {
        setCopied(true);
        clearTimeout(timers.current.copy);
        timers.current.copy = setTimeout(() => setCopied(false), 1800);
      });
  };
  const posting = f.url || "https://www.google.com/search?q=" + encodeURIComponent(f.company + " " + f.role + " job");

  return (
    <>
      <div onClick={animatedClose} className={leaving ? "drawer-scrim out" : enter ? "drawer-scrim" : undefined} style={{ position: "fixed", inset: 0, background: "rgba(29,26,15,.28)", zIndex: 20 }} />
      <aside ref={panel} role="dialog" aria-modal="true" aria-label={`${f.role} at ${f.company}`} className={leaving ? "drawer-panel out" : enter ? "drawer-panel" : undefined} style={{ position: "fixed", top: 0, right: 0, bottom: 0, width: 440, maxWidth: "100vw", background: "#fff", zIndex: 21, display: "flex", flexDirection: "column", boxShadow: "-12px 0 40px rgba(29,26,15,.18)" }}>
        {nav.index >= 0 && nav.total > 1 && (
          <div className="drawer-nav" role="group" aria-label="Move between finds">
            <button onClick={nav.prev} disabled={!nav.prev} aria-label="Previous find" data-tip="Previous (←)" className="drawer-nav-btn">‹</button>
            <span aria-live="polite" className="drawer-nav-count">{nav.index + 1}/{nav.total}</span>
            <button onClick={nav.next} disabled={!nav.next} aria-label="Next find" data-tip="Next (→)" className="drawer-nav-btn">›</button>
          </div>
        )}
        <div style={{ background: "#1D1A0F", color: "#fff", padding: "24px 26px 22px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
            <div style={{ fontSize: 14, color: "#F8A865", fontWeight: 600 }}>{f.company}</div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <button ref={closeBtn} onClick={animatedClose} aria-label="Close" style={{ border: 0, background: "rgba(255,255,255,.1)", color: "#fff", width: 30, height: 30, borderRadius: "50%", cursor: "pointer", fontSize: 16, lineHeight: 1 }}>×</button>
            </div>
          </div>
          <div style={{ fontSize: 23, fontWeight: 700, letterSpacing: "-0.01em", marginTop: 6, textWrap: "pretty" }}>{f.role}</div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
            <span style={{ padding: "4px 10px", borderRadius: 6, fontSize: 14, fontWeight: 600, background: "#F8A865", color: "#1D1A0F" }}>Match {f.score}/5</span>
            <div style={{ marginLeft: "auto", display: "flex", gap: 6, alignItems: "center" }}>
              <button onClick={() => toggle(f, "pinned")} data-tip={f.pinned ? "Unpin" : "Pin"} aria-label={f.pinned ? "Unpin" : "Pin"} style={{ width: 30, height: 30, border: 0, borderRadius: "50%", background: f.pinned ? "#F8A865" : "rgba(255,255,255,.1)", color: f.pinned ? "#1D1A0F" : "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", padding: 0 }}>
                <PinIcon size={14} sw={2} />
              </button>
              <button onClick={copy} style={{ height: 30, padding: "0 12px", border: 0, borderRadius: 999, background: "rgba(255,255,255,.1)", color: "#fff", fontSize: 14, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}>
                <LinkIcon />
                {copied ? "Copied" : "Copy link"}
              </button>
            </div>
          </div>
        </div>
        <div style={{ padding: "22px 26px", display: "flex", flexDirection: "column", gap: 22, overflowY: "auto", flex: 1 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px 18px" }}>
            <div><Label>Comp</Label><div style={{ fontSize: 14.5, marginTop: 4, fontWeight: 600, color: f.comp ? "#99220F" : "#6B6358" }}>{compText(f)}</div></div>
            <div><Label>Posted</Label><div style={{ fontSize: 14.5, marginTop: 4 }}>{postedText(f)}</div></div>
            <div style={{ gridColumn: "1 / -1" }}><Label>Location</Label><div style={{ fontSize: 14.5, marginTop: 4 }}>{f.location || "Not stated"}</div></div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {f.reasonsMatch.length > 0 && (
              <div>
                <Label style={{ marginBottom: 8 }}>Why it’s a match</Label>
                <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                  {f.reasonsMatch.map((m) => (
                    <div key={m} style={{ display: "flex", gap: 10, alignItems: "flex-start", fontSize: 14, lineHeight: 1.45 }}>
                      <CheckIcon size={14} stroke="#427D33" style={{ flex: "none", marginTop: 3 }} />
                      <span style={{ textWrap: "pretty" }}>{m}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {f.reasonsGap.length > 0 && (
              <div>
                <Label style={{ marginBottom: 8 }}>Not a match</Label>
                <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                  {f.reasonsGap.map((m) => (
                    <div key={m} style={{ display: "flex", gap: 10, alignItems: "flex-start", fontSize: 14, lineHeight: 1.45 }}>
                      <XIcon stroke="#99220F" style={{ flex: "none", marginTop: 3 }} />
                      <span style={{ textWrap: "pretty" }}>{m}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
          <div>
            <Label style={{ marginBottom: 8 }}>Stage</Label>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 6 }}>
              {STAGES.map((s) => {
                const on = f.stage === s, ss = STAGE_STYLE[s];
                return (
                  <button key={s} onClick={() => setStage(f, s)} aria-pressed={on} data-tip={ENDED_STAGES.includes(s) ? "Archives it" : undefined} style={{ height: 36, borderRadius: 9, border: `1.5px solid ${on ? ss.bg : "#E6E0D8"}`, background: on ? ss.bg : "#fff", color: on ? ss.ink : "#6B6358", fontSize: 14, fontWeight: 600, cursor: "pointer", padding: "0 4px" }}>
                    {s}
                  </button>
                );
              })}
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, marginBottom: 8 }}>
              <Label>Notes</Label>
              <div style={{ fontSize: 14, color: "#6B6358" }}>{readOnly ? "View only" : "Saves when you pause or close"}</div>
            </div>
            <div style={{ position: "relative", flex: 1, display: "flex" }}>
              <textarea value={notes} readOnly={readOnly} onChange={(e) => onNotes(e.target.value)} onBlur={flushNotes} placeholder="Contacts, follow-ups, interview prep..." aria-label="Notes" className="f-brick" style={{ flex: 1, minHeight: 160, resize: "vertical", border: "1.5px solid #E6E0D8", borderRadius: 10, padding: "12px 14px 34px", fontSize: 14, lineHeight: 1.5, outline: "none", color: "#1D1A0F", cursor: noteState === "saving" ? "progress" : undefined }} />
              <div aria-live="polite" style={{ position: "absolute", right: 10, bottom: 10, padding: "3px 10px", borderRadius: 999, fontSize: 14, fontWeight: 600, background: noteState === "saved" ? "#E8F1E6" : "#F4F1EC", color: noteState === "saved" ? "#2F5A2A" : "#3B362C", opacity: noteState === "idle" ? 0 : 1, transition: "opacity .25s", pointerEvents: "none" }}>
                {noteState === "saving" ? "Saving…" : noteState === "saved" ? "Saved" : ""}
              </div>
            </div>
          </div>
        </div>
        {state.user.autoApply && !f.archived && (
          <div style={{ padding: "14px 26px 0", borderTop: "1px solid #EEEAE4", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            {f.application ? (
              (() => {
                const st = applicationLabel(f.application.status, f.application.queuedBy);
                return (
                  <>
                    <span style={{ padding: "5px 11px", borderRadius: 999, fontSize: 14, fontWeight: 600, background: st.bg, color: st.ink }}>{st.label}</span>
                    <Link href={`/apply#app-${f.application.id}`} style={{ fontSize: 14, fontWeight: 600 }}>View application →</Link>
                    {f.application.status !== "submitted" && f.application.status !== "canceled" && <SubmitModeNote submit={f.submit} compact />}
                  </>
                );
              })()
            ) : (
              <>
                <button onClick={applyWithLookout} disabled={applyMsg === "Queuing…"} style={{ height: 38, padding: "0 14px", borderRadius: 10, border: "1.5px solid #1D1A0F", background: "#fff", fontSize: 14, fontWeight: 600, color: "#1D1A0F", cursor: "pointer" }}>
                  {applyMsg === "Queuing…" ? "Queuing…" : "Apply with Lookout"}
                </button>
                <span style={{ fontSize: 14, color: applyMsg ? "#99220F" : "#6B6358" }}>{applyMsg ?? "Beta. Drafts everything for your review first."}</span>
                {!applyMsg && <SubmitModeNote submit={f.submit} />}
              </>
            )}
          </div>
        )}
        {asking && !f.archived && (
          <div style={{ padding: "14px 26px 0", borderTop: "1px solid #EEEAE4", display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ fontSize: 14, fontWeight: 600 }}>What&apos;s off about it? Lookout uses this on your next searches.</div>
            <div role="group" aria-label="Why it's not a fit" style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {NOT_A_FIT.map((r) => (
                <button key={r} onClick={() => { patchFind(f.id, { archived: true, feedback: r === "Just not interested" ? null : r }); setAsking(false); }} style={{ height: 32, padding: "0 12px", borderRadius: 999, border: "1.5px solid #E0D9CF", background: "#fff", color: "#1D1A0F", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>{r}</button>
              ))}
            </div>
          </div>
        )}
        <div style={{ padding: "16px 26px", borderTop: asking && !f.archived ? 0 : "1px solid #EEEAE4", display: "flex", gap: 8 }}>
          <button
            onClick={() => (f.archived ? patchFind(f.id, { archived: false, feedback: null }) : setAsking((v) => !v))}
            aria-expanded={f.archived ? undefined : asking}
            style={{ flex: 1, height: 42, borderRadius: 10, border: "1.5px solid #1D1A0F", background: asking ? "#F4F1EC" : "#fff", fontSize: 14, fontWeight: 600, color: "#1D1A0F", cursor: "pointer" }}
          >
            {f.archived ? (f.feedback ? `Restore · was “${f.feedback}”` : "Restore") : asking ? "Cancel" : "Not a fit"}
          </button>
          <a href={posting} target="_blank" rel="noopener noreferrer" onClick={() => trackClient("posting_clicked", f.id)} style={{ flex: 1, height: 42, borderRadius: 10, background: "#99220F", fontSize: 14, fontWeight: 600, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", gap: 7, textDecoration: "none" }}>
            View posting
            <ArrowUpRight />
          </a>
        </div>
      </aside>
    </>
  );
}
