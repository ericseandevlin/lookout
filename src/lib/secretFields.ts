/**
 * Saved secrets in an app_settings row (#274). Pure, so it can be tested without a database.
 * A value that doesn't decrypt (APP_SECRET changed without APP_SECRET_PREVIOUS, or reencrypt
 * reported it unreadable) becomes "" and is reported. It must not fall back to the env key:
 * during a leak response that would quietly bring back the old, leaked key.
 */
export function openSecretFields(saved: Record<string, unknown>, fields: string[], decrypt: (blob: string) => string) {
  const out = { ...saved };
  const unreadable: string[] = [];
  for (const f of fields) {
    const v = out[f];
    if (typeof v !== "string" || !v) continue;
    try {
      out[f] = decrypt(v);
    } catch {
      out[f] = "";
      unreadable.push(f);
    }
  }
  return { saved: out, unreadable };
}

/** What a save stores for one secret field: a new value is encrypted; an empty one keeps the stored blob untouched, readable or not. */
export const nextSecret = (typed: string, storedBlob: unknown, encrypt: (plain: string) => string) =>
  typed ? encrypt(typed) : typeof storedBlob === "string" ? storedBlob : "";
