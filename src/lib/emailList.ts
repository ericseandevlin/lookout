// Pasted email lists for bulk invites (#993). Pure, so the Admin page can preview the count before sending.

export const MAX_BULK = 50;

/**
 * Pull addresses out of whatever was pasted: commas, semicolons, new lines, or a mail client's
 * "Name <a@b.co>" form. Lowercased and de-duplicated. Pieces with an @ that aren't addresses come back
 * in `bad`; bare words without an @ are taken as parts of a display name and skipped.
 */
export function parseEmails(text: string) {
  const ok: string[] = [];
  const bad: string[] = [];
  for (const raw of text.split(/[\s,;]+/).filter(Boolean)) {
    const piece = raw.replace(/^[<("']+|[>)"'.]+$/g, "").toLowerCase();
    if (piece.length <= 254 && /^[^\s@<>()"']+@[^\s@<>()"']+\.[a-z]{2,}$/.test(piece)) {
      if (!ok.includes(piece)) ok.push(piece);
    } else if (raw.includes("@")) bad.push(raw);
  }
  return { ok, bad };
}
