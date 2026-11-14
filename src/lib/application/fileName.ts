/**
 * File names for the Word files Lookout writes and serves (#1198). Letters and digits in any script stay: "Zoë Müller -
 * Nestlé Resume" kept only ASCII before and reached the employer as "Zo Mller - Nestl Resume".
 */

/** A name safe on disk: letters, digits and marks in any script, spaces, dots, dashes and underscores. Everything else drops. */
export const fileSafe = (s: string) =>
  s
    .normalize("NFC")
    .replace(/\s+/g, " ")
    .replace(/[^\p{L}\p{N}\p{M} ._-]/gu, "")
    .replace(/ {2,}/g, " ")
    .trim();

/** The same name with accents taken off and anything else outside printable ASCII dropped, for old clients ("Zoë" -> "Zoe"). */
const asciiName = (s: string) =>
  s
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[^\x20-\x7e]/g, "")
    .replace(/["\\]/g, "")
    .replace(/\s+/g, " ")
    .trim();

/** An attachment header that keeps the full name (RFC 6266 filename*), with an ASCII filename for clients that need one. */
export function attachment(fileName: string) {
  const ascii = asciiName(fileName);
  const header = `attachment; filename="${ascii}"`;
  return ascii === fileName ? header : `${header}; filename*=UTF-8''${encodeURIComponent(fileName).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)}`;
}
