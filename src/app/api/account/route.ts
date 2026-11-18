import { eq } from "drizzle-orm";
import { z } from "zod";
import { authed, body, json } from "@/lib/api";
import { destroySession } from "@/lib/auth/session";
import { db, schema } from "@/lib/db";
import { deleteUserFiles } from "@/lib/files";

const Input = z.object({ confirm: z.literal("DELETE") });

/**
 * Deletes the account and everything tied to it (cascades), plus uploaded files, and records the id in
 * account_deletions so a restored backup can delete the account again (#1342).
 */
export const DELETE = authed(async (req, { user }) => {
  await body(req, Input);
  await destroySession();
  await db.transaction(async (tx) => {
    await tx.insert(schema.accountDeletions).values({ userId: user.id }).onConflictDoNothing();
    await tx.delete(schema.users).where(eq(schema.users.id, user.id));
  });
  await deleteUserFiles(user.id);
  return json({ ok: true });
});
