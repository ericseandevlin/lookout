import { eq } from "drizzle-orm";
import { z } from "zod";
import { authed, body, json } from "@/lib/api";
import { db, schema } from "@/lib/db";

const Input = z.object({ name: z.string().max(120) });

export const PATCH = authed(async (req, { user }) => {
  const { name } = await body(req, Input);
  await db.update(schema.users).set({ name }).where(eq(schema.users.id, user.id));
  return json({ ok: true });
});
