import "server-only";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { decrypt, encrypt } from "@/lib/secrets";

/** Current pay (#109) is stored encrypted and only ever decrypted here, for this person's own board. */
export async function loadCurrentComp(userId: string): Promise<number | null> {
  const [p] = await db.select({ v: schema.profiles.currentComp }).from(schema.profiles).where(eq(schema.profiles.userId, userId));
  if (!p?.v) return null;
  try {
    const n = Number(decrypt(p.v));
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    // A key change makes the old value unreadable; treat it as gone rather than fail the board.
    return null;
  }
}

/** Save a whole yearly amount, or null to delete it. */
export async function saveCurrentComp(userId: string, amount: number | null) {
  const currentComp = amount === null ? null : encrypt(String(amount));
  await db
    .insert(schema.profiles)
    .values({ userId, currentComp })
    .onConflictDoUpdate({ target: schema.profiles.userId, set: { currentComp } });
}
