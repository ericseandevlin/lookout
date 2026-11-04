/**
 * Digest links go through Lookout first (#34): /go/<digest>/<find id or "board">. The click is
 * recorded, then the person lands where the link said. The destination always comes from the
 * database, never from the URL, so /go can't be used as an open redirect.
 */

export const goLink = (appUrl: string, digestId: string, target: string | "board") => `${appUrl}/go/${digestId}/${target}`;

/** Where a find's link goes: its posting if that's a web address, else the board. */
export function forwardTo(sourceUrl: string | null | undefined, appUrl: string) {
  try {
    const u = new URL(sourceUrl ?? "");
    if (u.protocol === "https:" || u.protocol === "http:") return u.toString();
  } catch {}
  return `${appUrl}/finds`;
}
