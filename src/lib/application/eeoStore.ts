import "server-only";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { decrypt, encrypt } from "@/lib/secrets";
import { emptyEeo, type EeoProfile } from "./eeo";

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
