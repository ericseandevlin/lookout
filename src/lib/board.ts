import type { Find, Stage } from "@/lib/types";

export const STAGES: Stage[] = ["Not applied", "Auto-applying", "Applied", "Interview", "Offer", "Closed", "Ghosted", "Not selected", "Nope"];
/** Stages that end a find. Moving a find into one archives it (#180). */
export const ENDED_STAGES: Stage[] = ["Closed", "Ghosted", "Not selected", "Nope"];
export const STAGE_STYLE: Record<string, { bg: string; ink: string }> = {
  "Not applied": { bg: "#F4F1EC", ink: "#1D1A0F" },
  "Auto-applying": { bg: "#E4E9F2", ink: "#2C4468" },
  Applied: { bg: "#FDE7D3", ink: "#7A3A10" },
  Interview: { bg: "#F9DDD7", ink: "#99220F" },
  Offer: { bg: "#E6EDD9", ink: "#35662A" },
  Closed: { bg: "#EEEAE4", ink: "#6B6358" },
  Ghosted: { bg: "#EEEAE4", ink: "#5E574D" },
  "Not selected": { bg: "#EEEAE4", ink: "#5E574D" },
  Nope: { bg: "#EEEAE4", ink: "#5E574D" },
  // rfp (#8)
  Reviewing: { bg: "#F4F1EC", ink: "#1D1A0F" },
  Bid: { bg: "#E4E9F2", ink: "#2C4468" },
  Submitted: { bg: "#FDE7D3", ink: "#7A3A10" },
  Awarded: { bg: "#E6EDD9", ink: "#35662A" },
  Lost: { bg: "#EEEAE4", ink: "#5E574D" },
};
/** Style for a stage from any kind; unknown stages fall back to neutral. */
export const stageStyle = (s: string) => STAGE_STYLE[s] ?? { bg: "#EEEAE4", ink: "#5E574D" };

export const DAYS: Record<string, string> = {
  Mon: "Monday", Tue: "Tuesday", Wed: "Wednesday", Thu: "Thursday", Fri: "Friday", Sat: "Saturday", Sun: "Sunday",
};

const fmt = (n: number) => "$" + n.toLocaleString("en-US");
export const compText = (f: Find) => (f.comp ? `${fmt(f.comp[0])} – ${fmt(f.comp[1])}` : "No comp posted");

// --- Kind-driven cells (#8) --------------------------------------------------------

/** A find's attributes are type-specific (rfp: agency, due date, value, set-aside). */
export const attrStr = (f: Find, k: string) => {
  const v = f.attributes?.[k];
  return typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "";
};
export const attrNum = (f: Find, k: string) => {
  const v = f.attributes?.[k];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
};
/** Contract or project value; the attribute is a number (dollars) or free text. */
export function valueText(f: Find) {
  const n = attrNum(f, "value");
  if (n != null) return fmt(n);
  const s = attrStr(f, "value");
  if (s) return /^\d+$/i.test(s) ? `$${s}` : s;
  return "No value posted";
}
/** Days until a due date (negative once it's past), or null when there's no date. */
export function dueDays(f: Find) {
  const s = attrStr(f, "due");
  if (!s) return null;
  const t = new Date(/^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T12:00:00` : s).getTime();
  return Number.isFinite(t) ? Math.ceil((t - Date.now()) / 864e5) : null;
}
export function dueText(f: Find) {
  const s = attrStr(f, "due");
  if (!s) return "no date";
  const d = dueDays(f);
  if (d == null) return s;
  return d < 0 ? `${-d}d past` : d === 0 ? "today" : `${d}d left`;
}
/** The text for one board cell, by column key (#8). */
export const cellText = (f: Find, key: string): string =>
  key === "company" ? f.company
  : key === "role" ? f.role
  : key === "comp" ? compText(f)
  : key === "listed" ? postedText(f)
  : key === "location" ? f.location || "—"
  : key === "value" ? valueText(f)
  : key === "due" ? dueText(f)
  : key === "setAside" ? attrStr(f, "setAside") || "—"
  : "";
/** Whether a column's cell reads as "not stated" styling: dim and italic. */
export const cellQuiet = (f: Find, key: string): boolean =>
  (key === "comp" && !f.comp)
  || (key === "listed" && !f.postedAt)
  || (key === "value" && valueText(f) === "No value posted")
  || (key === "due" && dueText(f) === "no date")
  || (key === "setAside" && !attrStr(f, "setAside"))
  || (key === "location" && !f.location);

/** Days since posted, or null when the posting has no date. */
export function postedDays(f: Find) {
  if (!f.postedAt) return null;
  const d = Math.floor((Date.now() - new Date(f.postedAt + "T12:00:00").getTime()) / 864e5);
  return Math.max(0, d);
}

export function postedText(f: Find) {
  const d = postedDays(f);
  if (d == null) return "no date";
  if (d < 1) return "today";
  if (d < 7) return `${d}d ago`;
  if (d < 30) return `${Math.floor(d / 7)}w ago`;
  return `${Math.floor(d / 30)}mo ago`;
}

export const isNewFind = (f: Find, newDays: number) =>
  !f.archived && !f.seen && Date.now() - new Date(f.addedAt).getTime() <= newDays * 864e5;

export const slugOf = (f: Find) =>
  (f.company + " " + f.role).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export const scoreStyle = (s: number) =>
  s >= 5
    ? { bg: "#99220F", ink: "#fff", border: "#99220F" }
    : s === 4
      ? { bg: "#F8A865", ink: "#1D1A0F", border: "#F8A865" }
      : { bg: "#fff", ink: "#1D1A0F", border: "#D8D0C4" };

export const initialsOf = (name: string) =>
  name.trim().split(/\s+/).filter(Boolean).map((w) => w[0]).filter((_, i, a) => i === 0 || i === a.length - 1).join("").toUpperCase() || "?";

export const shortDate = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
