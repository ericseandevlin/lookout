import type { Find, Stage } from "@/lib/types";

export const STAGES: Stage[] = ["Not applied", "Applied", "Interview", "Offer", "Closed", "Ghosted", "Not selected", "Nope"];
export const ACTIVE_STAGES: Stage[] = ["Applied", "Interview", "Offer"];
export const STAGE_STYLE: Record<Stage, { bg: string; ink: string }> = {
  "Not applied": { bg: "#F4F1EC", ink: "#1D1A0F" },
  Applied: { bg: "#FDE7D3", ink: "#7A3A10" },
  Interview: { bg: "#F9DDD7", ink: "#99220F" },
  Offer: { bg: "#E6EDD9", ink: "#35662A" },
  Closed: { bg: "#EEEAE4", ink: "#6B6358" },
  Ghosted: { bg: "#EEEAE4", ink: "#5E574D" },
  "Not selected": { bg: "#EEEAE4", ink: "#5E574D" },
  Nope: { bg: "#EEEAE4", ink: "#5E574D" },
};

export const DAYS: Record<string, string> = {
  Mon: "Monday", Tue: "Tuesday", Wed: "Wednesday", Thu: "Thursday", Fri: "Friday", Sat: "Saturday", Sun: "Sunday",
};

const fmt = (n: number) => "$" + n.toLocaleString("en-US");
export const compText = (f: Find) => (f.comp ? `${fmt(f.comp[0])} – ${fmt(f.comp[1])}` : "No comp posted");

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
