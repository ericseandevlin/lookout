import "server-only";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { decrypt, encrypt } from "@/lib/secrets";
import type { EeoRecord, EeoRun } from "@/lib/db/schema";
import { emptyEeo, sourceLabel, type EeoCategory, type EeoPick, type EeoProfile } from "./eeo";

/** EEO answers are stored encrypted and only ever decrypted here, for this person (#122). */
export async function loadEeo(userId: string): Promise<{ consent: boolean; profile: EeoProfile }> {
  const [p] = await db.select({ eeo: schema.profiles.eeo, consent: schema.profiles.eeoConsent }).from(schema.profiles).where(eq(schema.profiles.userId, userId));
  let profile = emptyEeo();
  if (p?.eeo) {
    try {
      profile = { ...emptyEeo(), ...(JSON.parse(decrypt(p.eeo)) as EeoProfile) };
    } catch {
      // A key change makes old answers unreadable; treat them as gone rather than fail the page.
    }
  }
  return { consent: !!p?.consent, profile };
}

export async function saveEeo(userId: string, patch: { profile?: EeoProfile | null; consent?: boolean }) {
  const set: Partial<typeof schema.profiles.$inferInsert> = {};
  if (patch.profile !== undefined) set.eeo = patch.profile ? encrypt(JSON.stringify(patch.profile)) : null;
  if (patch.consent !== undefined) set.eeoConsent = patch.consent;
  if (Object.keys(set).length) await db.update(schema.profiles).set(set).where(eq(schema.profiles.userId, userId));
}

/** The record kept with a fill or submission: what was shared and from which saved answer. Answers stay encrypted. */
export function eeoRecord(asked: number, profileConsent: boolean, run: EeoRun, picks: EeoPick[]): EeoRecord {
  return {
    on: run.on,
    profileConsent,
    at: new Date().toISOString(),
    asked,
    categories: [...new Set(picks.map((p) => p.category).filter((c): c is EeoCategory => !!c))],
    fields: picks.map((p) => ({ prompt: p.prompt, category: p.category, source: p.source })),
    ...(picks.length ? { answers: encrypt(JSON.stringify(picks.map((p) => p.answer))) } : {}),
  };
}

/** The record as the owner sees it on the application, answers decrypted. Null when there were no EEO questions. */
export function showEeoRecord(rec: EeoRecord | undefined | null) {
  if (!rec) return null;
  let answers: string[] = [];
  try {
    answers = rec.answers ? (JSON.parse(decrypt(rec.answers)) as string[]) : [];
  } catch {
    // Unreadable after a key change: still show which questions were answered and from where.
  }
  return {
    on: rec.on,
    profileConsent: rec.profileConsent,
    at: rec.at,
    asked: rec.asked,
    fields: rec.fields.map((f, n) => ({ prompt: f.prompt, answer: answers[n] ?? null, from: sourceLabel({ source: f.source, category: f.category as EeoCategory | null }) })),
  };
}
