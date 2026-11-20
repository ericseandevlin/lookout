import { slugOf } from "./board";

/** Desktop widths where the board shows the list and the selected find side by side (#1331). Phones keep the drawer. */
export const SPLIT_QUERY = "(min-width: 1280px)";

/**
 * The find an up/down arrow lands on (#1331), walking the board in its shown order.
 * With nothing selected (or the selection filtered out), down picks the first and up the last.
 * At either end the selection stays put.
 */
export function stepSelection(ids: readonly string[], current: string | null, delta: number): string | null {
  if (!ids.length) return null;
  const at = current ? ids.indexOf(current) : -1;
  if (at < 0) return delta < 0 ? ids[ids.length - 1] : ids[0];
  return ids[Math.min(ids.length - 1, Math.max(0, at + delta))];
}

/** The URL hash that names a find, so a reload or shared link opens it; empty for no selection. */
export const hashFor = (f: { company: string; role: string } | null) => (f ? "#" + slugOf(f) : "");

/** The find a URL hash names, if any. Tolerates a missing "#" and percent-encoding. */
export function findForHash<T extends { company: string; role: string }>(hash: string, finds: readonly T[]): T | undefined {
  let s = hash.replace(/^#/, "");
  try {
    s = decodeURIComponent(s);
  } catch {
    // A malformed escape: match on the raw text.
  }
  return s ? finds.find((f) => slugOf(f) === s) : undefined;
}
